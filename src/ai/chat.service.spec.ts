import { HttpException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AiProviderConfigService } from './config/ai-provider.config';
import { ContextService } from './context.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { ImageProcessingService } from '../common/images/image-processing.service';
import { UsageService } from '../usage/usage.service';
import { ProductsService } from '../products/products.service';
import { AiTelemetryService } from './telemetry.service';

const usageMetadata = { inputTokens: 10, outputTokens: 6, latencyMs: 42 };
const quota = {
  planStatus: 'pro' as const,
  freeScanLimit: 3,
  freeScansUsed: 0,
  freeScansRemaining: 999999,
  freePromptLimit: 1,
  promptCount: 1,
  promptsRemaining: 999999,
};

function scanFixture() {
  return {
    id: 'scan-1',
    productName: 'Trusted Serum',
    skinGoal: 'hydration',
    ingredients: ['Aqua', 'Glycerin'],
    extractedProductData: { brand: 'Trusted' },
    trustedProductData: { verifiedFromDatabase: true },
    fullIngredientListVisible: true,
    analysisResult: { summary: 'Trusted saved analysis' },
    conversationSummary: 'The user applies the product at night.',
    conversation: [],
    promptCount: 0,
  };
}

describe('ChatService', () => {
  function createService(planStatus: 'free' | 'pro' = 'pro') {
    const config = {
      geminiProductModel: 'gemini-product-test',
      geminiFaceModel: 'gemini-face-test',
      geminiProductMaxOutputTokens: 500,
      geminiFaceMaxOutputTokens: 800,
      deepseekModel: 'deepseek-test',
    } as AiProviderConfigService;
    const context = {
      buildContext: jest.fn().mockReturnValue([
        { role: 'system', content: 'safe prompt' },
        { role: 'user', content: 'question' },
      ]),
      summarizeOlderMessages: jest.fn().mockResolvedValue(null),
    } as unknown as ContextService;
    const deepseek = {
      generateJson: jest.fn().mockResolvedValue({
        data: { answer: 'Trusted answer', suggestions: ['Next question'] },
        provider: 'deepseek',
        model: 'deepseek-test',
        usage: usageMetadata,
      }),
    } as unknown as DeepSeekProvider;
    const gemini = { generateJson: jest.fn() } as unknown as GeminiProvider;
    const images = {
      process: jest.fn().mockResolvedValue({
        buffer: Buffer.from('processed'),
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalBytes: 100,
      }),
    } as unknown as ImageProcessingService;
    const usage = {
      getProductScanForChat: jest.fn().mockResolvedValue({
        user: { id: 'user-1', planStatus },
        scan: scanFixture(),
      }),
      normalizeConversation: jest.fn((value: unknown) =>
        Array.isArray(value) ? value : [],
      ),
      appendProductConversation: jest
        .fn()
        .mockImplementation((_userId, _scanId, messages) =>
          Promise.resolve({
            id: 'scan-1',
            conversation: messages,
            conversationSummary: null,
          }),
        ),
      getQuota: jest.fn().mockResolvedValue({ ...quota, planStatus }),
      saveProductSummary: jest.fn(),
      getFaceScanForChat: jest.fn().mockResolvedValue({
        user: { id: 'user-1', planStatus: 'pro' },
        scan: {
          id: 'face-1',
          skinGoal: 'hydration',
          observations: { usable: true },
          guidance: { explanation: 'saved' },
          conversation: [],
          conversationSummary: null,
        },
      }),
      appendFaceConversation: jest
        .fn()
        .mockImplementation((_userId, _faceId, messages) =>
          Promise.resolve({
            id: 'face-1',
            conversation: messages,
            conversationSummary: null,
          }),
        ),
      saveFaceSummary: jest.fn(),
    } as unknown as UsageService;
    const products = {
      suggestProducts: jest.fn().mockResolvedValue([
        {
          id: 'product-1',
          slug: 'trusted-hydrator',
          name: 'Trusted Hydrator',
          brand: 'Trusted',
          imagePath: '/public/products/trusted.svg',
          productType: 'moisturizer',
          matchScore: 91,
          matchReasons: ['Cible hydratation'],
        },
      ]),
    } as unknown as ProductsService;
    const telemetry = {
      assertChatRateLimit: jest.fn().mockResolvedValue(undefined),
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AiTelemetryService;

    const service = new ChatService(
      config,
      context,
      deepseek,
      gemini,
      images,
      usage,
      products,
      telemetry,
    );
    return {
      service,
      config,
      context,
      deepseek,
      gemini,
      images,
      usage,
      products,
      telemetry,
    };
  }

  it('rejects access to another user scan before calling any provider', async () => {
    const { service, usage, deepseek, gemini } = createService();
    (usage.getProductScanForChat as jest.Mock).mockRejectedValue(
      new NotFoundException('Scan not found for this user.'),
    );

    await expect(
      service.productMessage({
        userId: 'user-2',
        scanId: 'scan-owned-by-user-1',
        message: 'Can I use it?',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deepseek.generateJson).not.toHaveBeenCalled();
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('routes text-only product chat directly to DeepSeek using trusted saved context', async () => {
    const { service, context, deepseek, gemini, usage } = createService();

    const result = await service.productMessage({
      userId: 'user-1',
      scanId: 'scan-1',
      message: 'Can I use it in the morning?',
    });

    expect(gemini.generateJson).not.toHaveBeenCalled();
    expect(deepseek.generateJson).toHaveBeenCalledTimes(1);
    expect(context.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedContext: expect.objectContaining({
          productName: 'Trusted Serum',
          confirmedIngredients: 'Aqua, Glycerin',
          summary: 'Trusted saved analysis',
          ingredientList: 'complete',
        }),
        currentMessage: 'Can I use it in the morning?',
        visualContext: undefined,
      }),
    );
    expect(usage.appendProductConversation).toHaveBeenCalledWith(
      'user-1',
      'scan-1',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', requestType: 'text_chat' }),
        expect.objectContaining({
          role: 'assistant',
          provider: 'deepseek',
          model: 'deepseek-test',
          inputTokens: 10,
          outputTokens: 6,
          latencyMs: 42,
        }),
      ]),
    );
    expect(result.answer).toBe('Trusted answer');
  });

  it('routes a product image through Gemini first and then DeepSeek', async () => {
    const { service, context, deepseek, gemini, images, usage } =
      createService();
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: {
        imageType: 'product_label',
        visibleText: 'Directions: apply nightly',
        observations: ['A product label is visible.'],
        confidence: 'high',
        warnings: [],
      },
      provider: 'gemini',
      model: 'gemini-product-test',
      usage: usageMetadata,
    });

    await service.productMessage({
      userId: 'user-1',
      scanId: 'scan-1',
      message: 'What does this label add?',
      image: {
        buffer: Buffer.from('image'),
        size: 5,
        mimetype: 'image/png',
      } as Express.Multer.File,
    });

    expect(images.process).toHaveBeenCalledTimes(1);
    expect(gemini.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'product_image_chat',
      }),
    );
    expect(context.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        visualContext: expect.objectContaining({ imageType: 'product_label' }),
      }),
    );
    expect(deepseek.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'product_image_chat',
      }),
    );
    expect(usage.appendProductConversation).toHaveBeenCalledWith(
      'user-1',
      'scan-1',
      expect.arrayContaining([
        expect.objectContaining({
          attachment: expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
          visualContext: expect.objectContaining({
            imageType: 'product_label',
          }),
        }),
      ]),
    );
  });

  it('returns HTTP 402 when a Free user attaches a face to product chat', async () => {
    const { service, gemini, deepseek } = createService('free');
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: {
        imageType: 'face',
        visibleText: '',
        observations: [],
        confidence: 'high',
        warnings: [],
      },
      provider: 'gemini',
      model: 'gemini-product-test',
      usage: usageMetadata,
    });

    await expect(
      service.productMessage({
        userId: 'user-1',
        scanId: 'scan-1',
        message: 'Analyze this photo',
        image: {
          buffer: Buffer.from('face'),
          size: 4,
          mimetype: 'image/png',
        } as Express.Multer.File,
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(deepseek.generateJson).not.toHaveBeenCalled();
  });

  it('routes a new face-chat image through Gemini and then DeepSeek', async () => {
    const { service, gemini, deepseek, context, usage } = createService('pro');
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: {
        usable: true,
        imageType: 'face',
        quality: {
          lighting: 'good',
          focus: 'good',
          faceCoverage: 'complete',
          filterOrHeavyMakeupSuspected: false,
        },
        observations: [
          {
            area: 'general',
            concern: 'apparent_dryness',
            description: 'Dry-looking areas appear visible.',
            confidence: 'medium',
          },
        ],
        limitations: ['Lighting may affect appearance.'],
        retakeInstructions: [],
        professionalReviewSuggested: false,
      },
      provider: 'gemini',
      model: 'gemini-face-test',
      usage: usageMetadata,
    });

    const result = await service.faceMessage({
      userId: 'user-1',
      faceScanId: 'face-1',
      message: 'Has anything changed?',
      image: {
        buffer: Buffer.from('face'),
        size: 4,
        mimetype: 'image/png',
      } as Express.Multer.File,
    });

    expect(gemini.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 'face_chat' }),
    );
    expect(context.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        visualContext: expect.objectContaining({ imageType: 'face' }),
      }),
    );
    expect(deepseek.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 'face_chat' }),
    );
    expect(usage.appendFaceConversation).toHaveBeenCalled();
    expect(result.answer).toBe('Trusted answer');
  });

  it('returns a controlled 503 error and records failed provider metadata', async () => {
    const { service, deepseek, telemetry } = createService();
    (deepseek.generateJson as jest.Mock).mockRejectedValue(
      new Error('network secret details'),
    );

    let thrown: unknown;
    try {
      await service.productMessage({
        userId: 'user-1',
        scanId: 'scan-1',
        message: 'Question',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(503);
    expect((thrown as HttpException).getResponse()).toEqual(
      expect.objectContaining({
        message: 'Chat is temporarily unavailable.',
      }),
    );
    expect(
      JSON.stringify((thrown as HttpException).getResponse()),
    ).not.toContain('network secret details');
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deepseek',
        success: false,
        requestType: 'text_chat',
      }),
    );
  });
});
