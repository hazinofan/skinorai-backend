import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AiProviderConfigService } from './config/ai-provider.config';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { ImageProcessingService } from '../common/images/image-processing.service';
import { UsageService } from '../usage/usage.service';
import { ProductsService } from '../products/products.service';
import { OcrService } from '../ocr/ocr.service';
import { AiTelemetryService } from './telemetry.service';
import type {
  FaceObservation,
  ProductExtraction,
  ProviderResult,
} from './types/ai.types';

const usageMetadata = { inputTokens: 12, outputTokens: 8, latencyMs: 55 };
const quota = {
  planStatus: 'free' as const,
  freeScanLimit: 3,
  freeScansUsed: 1,
  freeScansRemaining: 2,
  freePromptLimit: 1,
  promptCount: 0,
  promptsRemaining: 1,
};

const extraction: ProductExtraction = {
  usable: true,
  imageType: 'product_label',
  brand: 'Example',
  productName: 'Hydrating Serum',
  productCategory: 'serum',
  visibleText: 'Ingredients: Water, Glycerin',
  visibleClaims: ['Hydrating'],
  ingredients: ['Water', 'Glycerin'],
  fullIngredientListVisible: true,
  uncertainText: [],
  confidence: 'high',
  warnings: [],
  retakeInstructions: [],
};

const analysisResponse = {
  score: 8.2,
  verdict: 'good_choice' as const,
  verdictLabel: 'Bon choix',
  summary: 'Une formule simple et hydratante.',
  positives: [
    { ingredient: 'Glycerin', reason: 'Humectant.', tag: 'Hydratation' },
  ],
  watchouts: [],
  recommendations: ['Introduire progressivement.'],
  nextStep: 'Tester localement.',
  followUpQuestions: ['Comment l’utiliser ?'],
  disclaimer: 'Information cosmétique, pas un diagnostic.',
};

const faceObservation: FaceObservation = {
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
      area: 'cheeks',
      concern: 'visible_redness',
      description:
        'A mild reddish appearance is visible and may be affected by lighting.',
      confidence: 'medium',
    },
  ],
  limitations: ['Camera processing may affect appearance.'],
  retakeInstructions: [],
  professionalReviewSuggested: false,
};

const faceGuidance = {
  explanation: 'A gentle routine may help support comfort.',
  priorities: ['Use a gentle cleanser.'],
  routineCategories: [
    { step: 'Moisturizer', guidance: 'Choose a fragrance-free option.' },
  ],
  potentiallyUsefulIngredients: ['Panthenol'],
  introduceCautiously: ['Strong exfoliants'],
  followUpQuestions: ['What is your current routine?'],
  disclaimer: 'Cosmetic guidance only, not a medical diagnosis.',
};

describe('AnalysisService', () => {
  function createService() {
    const config = {
      geminiProductModel: 'gemini-product-test',
      geminiFaceModel: 'gemini-face-test',
      geminiProductMaxOutputTokens: 500,
      geminiFaceMaxOutputTokens: 800,
      deepseekModel: 'deepseek-test',
      visionFallbackEnabled: false,
    } as AiProviderConfigService;
    const gemini = { generateJson: jest.fn() } as unknown as GeminiProvider;
    const deepseek = { generateJson: jest.fn() } as unknown as DeepSeekProvider;
    const images = {
      process: jest.fn().mockResolvedValue({
        buffer: Buffer.from('processed'),
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalBytes: 128,
      }),
    } as unknown as ImageProcessingService;
    const usage = {
      saveExtraction: jest.fn().mockResolvedValue({ id: 'extraction-1' }),
      assertCanAnalyze: jest.fn().mockResolvedValue(undefined),
      getExtractionOwned: jest.fn().mockResolvedValue({ extraction }),
      recordProductScan: jest
        .fn()
        .mockResolvedValue({ scan: { id: 'scan-1' }, quota }),
      assertPro: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', planStatus: 'pro' }),
      createFaceScan: jest.fn().mockResolvedValue({ id: 'face-1' }),
    } as unknown as UsageService;
    const products = {
      findReliableMatch: jest.fn().mockResolvedValue(null),
    } as unknown as ProductsService;
    const ocr = {
      isConfigured: jest.fn().mockReturnValue(false),
      extractIngredientsFromBuffer: jest.fn(),
    } as unknown as OcrService;
    const telemetry = {
      record: jest.fn().mockResolvedValue(undefined),
      assertFaceScanRateLimit: jest.fn().mockResolvedValue(undefined),
    } as unknown as AiTelemetryService;

    const service = new AnalysisService(
      config,
      gemini,
      deepseek,
      images,
      usage,
      products,
      ocr,
      telemetry,
    );
    return {
      service,
      gemini,
      deepseek,
      images,
      usage,
      products,
      ocr,
      telemetry,
    };
  }

  it('allows a Free user to extract product information and records usage metadata', async () => {
    const { service, gemini, usage, telemetry } = createService();
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: extraction,
      provider: 'gemini',
      model: 'gemini-product-test',
      usage: usageMetadata,
    } satisfies ProviderResult<ProductExtraction>);

    const result = await service.extractProduct('user-1', {
      buffer: Buffer.from('image'),
      size: 5,
      mimetype: 'image/png',
    } as Express.Multer.File);

    expect(result.extractionId).toBe('extraction-1');
    expect(result.ingredients).toEqual(['Water', 'Glycerin']);
    expect(usage.saveExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        inputTokens: 12,
        outputTokens: 8,
        latencyMs: 55,
      }),
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        requestType: 'product_extraction',
        usage: usageMetadata,
      }),
    );
  });

  it('does not invent ingredients when Gemini reports no visible INCI list', async () => {
    const { service, gemini, usage } = createService();
    const frontOnly = {
      ...extraction,
      imageType: 'product_front' as const,
      ingredients: [],
      fullIngredientListVisible: false,
      visibleText: 'Example Hydrating Serum',
    };
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: frontOnly,
      provider: 'gemini',
      model: 'gemini-product-test',
      usage: usageMetadata,
    });

    const result = await service.extractProduct('user-1', {
      buffer: Buffer.from('image'),
      size: 5,
      mimetype: 'image/png',
    } as Express.Multer.File);

    expect(result.ingredients).toEqual([]);
    expect(result.fullIngredientListVisible).toBe(false);
    expect(usage.saveExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        extraction: expect.objectContaining({ ingredients: [] }),
      }),
    );
  });

  it('sends manually confirmed ingredients to DeepSeek instead of trusting an extracted list or frontend analysis', async () => {
    const { service, deepseek, usage } = createService();
    (deepseek.generateJson as jest.Mock).mockResolvedValue({
      data: analysisResponse,
      provider: 'deepseek',
      model: 'deepseek-test',
      usage: usageMetadata,
    });

    await service.analyzeProduct('user-1', {
      skinGoal: 'hydration',
      extractionId: '2ee2fc75-1601-4a15-b458-9a5a7410a8ef',
      confirmedIngredients: ['Aqua', 'Panthenol'],
    });

    const call = (deepseek.generateJson as jest.Mock).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(call.messages[1].content) as {
      confirmedIngredients: string[];
      analysisResult?: unknown;
    };
    expect(payload.confirmedIngredients).toEqual(['Aqua', 'Panthenol']);
    expect(payload.confirmedIngredients).not.toContain('Glycerin');
    expect(payload.analysisResult).toBeUndefined();
    expect(usage.recordProductScan).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: ['Aqua', 'Panthenol'],
      }),
    );
  });

  it('uses the deterministic local fallback when DeepSeek is unavailable', async () => {
    const { service, deepseek, usage } = createService();
    (deepseek.generateJson as jest.Mock).mockRejectedValue(
      new Error('provider down'),
    );

    const result = await service.analyzeProduct('user-1', {
      skinGoal: 'hydration',
      confirmedIngredients: ['Glycerin'],
    });

    expect(result.summary).toContain('liste partielle');
    expect(usage.recordProductScan).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisProvider: 'local-fallback',
        analysisModel: 'deterministic-product-fallback',
      }),
    );
  });

  it('enforces the Pro plan before processing a face scan', async () => {
    const { service, usage, images, gemini } = createService();
    (usage.assertPro as jest.Mock).mockRejectedValue(
      new HttpException({ reason: 'face-scan-pro-required' }, 402),
    );

    await expect(
      service.analyzeFace({
        userId: 'free-user',
        frontImage: {
          buffer: Buffer.from('face'),
          size: 4,
          mimetype: 'image/png',
        } as Express.Multer.File,
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(images.process).not.toHaveBeenCalled();
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('allows a Pro user to run a face scan and saves only structured results', async () => {
    const { service, gemini, deepseek, usage } = createService();
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: faceObservation,
      provider: 'gemini',
      model: 'gemini-face-test',
      usage: usageMetadata,
    });
    (deepseek.generateJson as jest.Mock).mockResolvedValue({
      data: faceGuidance,
      provider: 'deepseek',
      model: 'deepseek-test',
      usage: usageMetadata,
    });

    const result = await service.analyzeFace({
      userId: 'pro-user',
      frontImage: {
        buffer: Buffer.from('face'),
        size: 4,
        mimetype: 'image/png',
      } as Express.Multer.File,
      consentAccepted: true,
      skinGoal: 'hydration',
    });

    expect(result.usable).toBe(true);
    expect(result.faceScanId).toBe('face-1');
    expect(result.privacy.rawPhotosStored).toBe(false);
    expect(usage.createFaceScan).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: faceObservation,
        guidance: faceGuidance,
        imageMimeTypes: ['image/png'],
      }),
    );
    expect(usage.createFaceScan).not.toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.anything(),
      }),
    );
  });

  it('rejects diagnostic wording in Gemini face observations', async () => {
    const { service, gemini, deepseek } = createService();
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: {
        ...faceObservation,
        observations: [
          {
            ...faceObservation.observations[0],
            description: 'This is eczema.',
          },
        ],
      },
      provider: 'gemini',
      model: 'gemini-face-test',
      usage: usageMetadata,
    });

    await expect(
      service.analyzeFace({
        userId: 'pro-user',
        frontImage: {
          buffer: Buffer.from('face'),
          size: 4,
          mimetype: 'image/png',
        } as Express.Multer.File,
        consentAccepted: true,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deepseek.generateJson).not.toHaveBeenCalled();
  });

  it('returns retake instructions without calling DeepSeek for an unusable face photo', async () => {
    const { service, gemini, deepseek, usage } = createService();
    (gemini.generateJson as jest.Mock).mockResolvedValue({
      data: {
        ...faceObservation,
        usable: false,
        imageType: 'unclear',
        observations: [],
        retakeInstructions: ['Use brighter, even lighting.'],
      },
      provider: 'gemini',
      model: 'gemini-face-test',
      usage: usageMetadata,
    });

    const result = await service.analyzeFace({
      userId: 'pro-user',
      frontImage: {
        buffer: Buffer.from('face'),
        size: 4,
        mimetype: 'image/png',
      } as Express.Multer.File,
      consentAccepted: true,
    });

    expect(result.usable).toBe(false);
    expect(result.observations.retakeInstructions).toEqual([
      'Use brighter, even lighting.',
    ]);
    expect(deepseek.generateJson).not.toHaveBeenCalled();
    expect(usage.createFaceScan).not.toHaveBeenCalled();
  });
});
