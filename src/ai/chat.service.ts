import {
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { AiProviderConfigService } from './config/ai-provider.config';
import { ContextService } from './context.service';
import { buildConversationMessage } from './message.factory';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { FACE_CHAT_SYSTEM_PROMPT } from './prompts/face-guidance.prompt';
import { FACE_OBSERVATION_PROMPT } from './prompts/face-observation.prompt';
import { PRODUCT_IMAGE_CHAT_PROMPT } from './prompts/product-extraction.prompt';
import { PRODUCT_CHAT_SYSTEM_PROMPT } from './prompts/product-chat.prompt';
import { chatResponseSchema } from './schemas/analysis-response.schema';
import { faceObservationSchema } from './schemas/face-observation.schema';
import {
  productImageChatContextJsonSchema,
  productImageChatContextSchema,
} from './schemas/product-extraction.schema';
import {
  FaceObservation,
  ProductImageChatContext,
  ProviderResult,
  LibrarySuggestion,
} from './types/ai.types';
import { ImageProcessingService } from '../common/images/image-processing.service';
import { UsageService } from '../usage/usage.service';
import { ProductsService } from '../products/products.service';
import { AiTelemetryService } from './telemetry.service';
import { containsDiagnosticWording } from './safety/face-safety';

@Injectable()
export class ChatService {
  constructor(
    private readonly config: AiProviderConfigService,
    private readonly context: ContextService,
    private readonly deepseek: DeepSeekProvider,
    private readonly gemini: GeminiProvider,
    private readonly images: ImageProcessingService,
    private readonly usage: UsageService,
    private readonly products: ProductsService,
    private readonly telemetry: AiTelemetryService,
  ) {}

  async productMessage({
    userId,
    scanId,
    message,
    image,
  }: {
    userId: string;
    scanId: string;
    message: string;
    image?: Express.Multer.File;
  }) {
    const { user, scan } = await this.usage.getProductScanForChat(
      userId,
      scanId,
    );
    await this.telemetry.assertChatRateLimit(userId, user.planStatus === 'pro');

    let visualResult: ProviderResult<ProductImageChatContext> | null = null;
    let attachment: { type: 'image'; mimeType: string; url?: string } | undefined;
    if (image) {
      const processed = await this.images.process(image);
      attachment = {
        type: 'image',
        mimeType: processed.mimeType,
        url: await this.saveChatAttachment(processed.buffer, processed.mimeType),
      };
      try {
        visualResult = await this.gemini.generateJson({
          model: this.config.geminiProductModel,
          prompt: PRODUCT_IMAGE_CHAT_PROMPT,
          images: [{ buffer: processed.buffer, mimeType: processed.mimeType }],
          schema: productImageChatContextSchema,
          jsonSchema: productImageChatContextJsonSchema,
          maxOutputTokens: Math.min(
            350,
            this.config.geminiProductMaxOutputTokens,
          ),
          requestType: 'product_image_chat',
        });
        await this.telemetry.record({
          userId,
          scanId,
          provider: visualResult.provider,
          model: visualResult.model,
          requestType: 'product_image_chat',
          usage: visualResult.usage,
        });
      } catch (error) {
        await this.recordFailure(
          userId,
          'gemini',
          this.config.geminiProductModel,
          'product_image_chat',
          error,
          scanId,
        );
        throw this.safeProviderError(
          error,
          'Image understanding is temporarily unavailable.',
        );
      }

      if (visualResult.data.imageType === 'face' && user.planStatus !== 'pro') {
        throw new HttpException(
          {
            message: 'Face image analysis requires the Pro plan.',
            reason: 'face-scan-pro-required',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    const conversation = this.usage.normalizeConversation(scan.conversation);
    const productRequestType = image
      ? ('product_image_chat' as const)
      : ('text_chat' as const);
    let deepseekResult: ProviderResult<z.infer<typeof chatResponseSchema>>;
    try {
      deepseekResult = await this.deepseek.generateJson({
        requestType: productRequestType,
        schema: chatResponseSchema,
        maxOutputTokens: productRequestType === 'product_image_chat' ? 1800 : this.config.deepseekMaxOutputTokens,
        messages: this.context.buildContext({
          systemPrompt: PRODUCT_CHAT_SYSTEM_PROMPT,
          trustedContext: this.buildCompactProductChatContext(scan, productRequestType === 'product_image_chat'),
          conversationSummary: scan.conversationSummary,
          conversation,
          currentMessage: message,
          visualContext: visualResult?.data,
        }),
      });
      await this.telemetry.record({
        userId,
        scanId,
        provider: deepseekResult.provider,
        model: deepseekResult.model,
        requestType: productRequestType,
        usage: deepseekResult.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        productRequestType,
        error,
        scanId,
      );
      throw this.safeProviderError(error, 'Chat is temporarily unavailable.');
    }

    const requestType = productRequestType;
    const librarySuggestions = await this.buildLibrarySuggestions({
      userMessage: message,
      answer: deepseekResult.data.answer,
      skinGoal: scan.skinGoal,
    });
    const userMessage = buildConversationMessage({
      role: 'user',
      content: message,
      result: visualResult ?? undefined,
      requestType,
      attachment,
      visualContext: visualResult?.data,
    });
    const assistantMessage = buildConversationMessage({
      role: 'assistant',
      content: deepseekResult.data.answer,
      result: deepseekResult,
      requestType,
      librarySuggestions,
    });
    const saved = await this.usage.appendProductConversation(userId, scanId, [
      userMessage,
      assistantMessage,
    ]);
    await this.maybeSummarizeProduct(
      userId,
      saved.id,
      saved.conversationSummary,
      this.usage.normalizeConversation(saved.conversation),
    );
    const quota = await this.usage.getQuota(userId, scanId);

    return {
      answer: deepseekResult.data.answer,
      suggestions: deepseekResult.data.suggestions,
      librarySuggestions,
      quota,
      messages: [userMessage, assistantMessage],
    };
  }

  async faceMessage({
    userId,
    faceScanId,
    message,
    image,
  }: {
    userId: string;
    faceScanId: string;
    message: string;
    image?: Express.Multer.File;
  }) {
    const { user, scan } = await this.usage.getFaceScanForChat(
      userId,
      faceScanId,
    );
    await this.telemetry.assertChatRateLimit(userId, user.planStatus === 'pro');

    let visualResult: ProviderResult<FaceObservation> | null = null;
    let attachment: { type: 'image'; mimeType: string; url?: string } | undefined;
    if (image) {
      const processed = await this.images.process(image);
      attachment = {
        type: 'image',
        mimeType: processed.mimeType,
        url: await this.saveChatAttachment(processed.buffer, processed.mimeType),
      };
      try {
        visualResult = await this.gemini.generateJson({
          model: this.config.geminiFaceModel,
          prompt: FACE_OBSERVATION_PROMPT,
          images: [{ buffer: processed.buffer, mimeType: processed.mimeType }],
          schema: faceObservationSchema,
          jsonSchema: undefined,
          maxOutputTokens: this.config.geminiFaceMaxOutputTokens,
          requestType: 'face_chat',
        });
        this.assertNonDiagnostic(visualResult.data);
        await this.telemetry.record({
          userId,
          faceScanId,
          provider: visualResult.provider,
          model: visualResult.model,
          requestType: 'face_chat',
          usage: visualResult.usage,
        });
      } catch (error) {
        await this.recordFailure(
          userId,
          'gemini',
          this.config.geminiFaceModel,
          'face_chat',
          error,
          undefined,
          faceScanId,
        );
        throw this.safeProviderError(
          error,
          'Face image understanding is temporarily unavailable.',
        );
      }
    }

    const conversation = this.usage.normalizeConversation(scan.conversation);
    let deepseekResult: ProviderResult<z.infer<typeof chatResponseSchema>>;
    try {
      deepseekResult = await this.deepseek.generateJson({
        requestType: 'face_chat',
        schema: chatResponseSchema,
        maxOutputTokens: Math.max(this.config.deepseekMaxOutputTokens, 900),
        messages: this.context.buildContext({
          systemPrompt: FACE_CHAT_SYSTEM_PROMPT,
          trustedContext: {
            skinGoal: scan.skinGoal,
            observations: scan.observations,
            guidance: scan.guidance,
          },
          conversationSummary: scan.conversationSummary,
          conversation,
          currentMessage: message,
          visualContext: visualResult?.data,
        }),
      });
      await this.telemetry.record({
        userId,
        faceScanId,
        provider: deepseekResult.provider,
        model: deepseekResult.model,
        requestType: 'face_chat',
        usage: deepseekResult.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        'face_chat',
        error,
        undefined,
        faceScanId,
      );
      throw this.safeProviderError(
        error,
        'Face chat is temporarily unavailable.',
      );
    }

    const userMessage = buildConversationMessage({
      role: 'user',
      content: message,
      result: visualResult ?? undefined,
      requestType: 'face_chat',
      attachment,
      visualContext: visualResult?.data,
    });
    const assistantMessage = buildConversationMessage({
      role: 'assistant',
      content: deepseekResult.data.answer,
      result: deepseekResult,
      requestType: 'face_chat',
    });
    const saved = await this.usage.appendFaceConversation(userId, faceScanId, [
      userMessage,
      assistantMessage,
    ]);
    await this.maybeSummarizeFace(
      userId,
      saved.id,
      saved.conversationSummary,
      this.usage.normalizeConversation(saved.conversation),
    );

    return {
      answer: deepseekResult.data.answer,
      suggestions: deepseekResult.data.suggestions,
      messages: [userMessage, assistantMessage],
    };
  }

  private async saveChatAttachment(buffer: Buffer, mimeType: string) {
    const extension = this.extensionForMimeType(mimeType);
    const publicDir = join(process.cwd(), 'public', 'chat-uploads');
    await mkdir(publicDir, { recursive: true });
    const fileName = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${extension}`;
    await writeFile(join(publicDir, fileName), buffer);
    return `/chat-uploads/${fileName}`;
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    return '.jpg';
  }

  private buildCompactProductChatContext(scan: {
    productName: string;
    skinGoal?: string | null;
    ingredients?: string[] | null;
    fullIngredientListVisible: boolean;
    analysisResult: unknown;
    extractedProductData?: unknown;
    trustedProductData?: unknown;
  }, imageQuestion = false) {
    const analysis = this.compactAnalysisResult(scan.analysisResult);
    const trustedProduct = this.compactTrustedProductData(scan.trustedProductData);
    const extraction = this.compactExtractionData(scan.extractedProductData);

    return {
      productName: scan.productName,
      skinGoal: scan.skinGoal ?? null,
      ingredientList: scan.fullIngredientListVisible ? 'complete' : 'partial',
      confirmedIngredients: (scan.ingredients ?? []).join(', '),
      ...(imageQuestion ? {} : { score: analysis.score, verdict: analysis.verdictLabel || analysis.verdict }),
      summary: imageQuestion ? '' : analysis.summary,
      positives: analysis.positives,
      watchouts: analysis.watchouts,
      recommendations: analysis.recommendations,
      nextStep: analysis.nextStep,
      trustedProduct,
      extractedProduct: extraction,
      instruction: imageQuestion
        ? 'The user attached a new image. Answer the current image question first from Gemini visual observations. Do not mention saved score/rating/verdict unless the user explicitly asks about the saved scan score.'
        : 'Answer only from these compact saved scan facts. If a detail is missing, say it is not available instead of inventing it.',
    };
  }

  private compactAnalysisResult(value: unknown) {
    const source = this.asRecord(value);
    return {
      score: this.asNumber(source.score),
      verdict: this.asString(source.verdict),
      verdictLabel: this.asString(source.verdictLabel),
      summary: this.truncate(this.asString(source.summary), 420),
      positives: this.compactNamedReasonArray(source.positives, 'tag', 5),
      watchouts: this.compactNamedReasonArray(source.watchouts, 'severity', 5),
      recommendations: this.asStringArray(source.recommendations, 5, 180),
      nextStep: this.truncate(this.asString(source.nextStep), 220),
    };
  }

  private compactTrustedProductData(value: unknown) {
    const source = this.asRecord(value);
    if (!Object.keys(source).length) return null;
    return {
      name: this.asString(source.name),
      brand: this.asString(source.brand),
      productType: this.asString(source.productType),
      keyIngredients: this.asStringArray(source.keyIngredients, 6, 80),
      watchoutIngredients: this.asStringArray(source.watchoutIngredients, 6, 80),
      benefits: this.asStringArray(source.benefits, 4, 140),
    };
  }

  private compactExtractionData(value: unknown) {
    const source = this.asRecord(value);
    if (!Object.keys(source).length) return null;
    return {
      brand: this.asString(source.brand),
      productName: this.asString(source.productName),
      productCategory: this.asString(source.productCategory),
      visibleClaims: this.asStringArray(source.visibleClaims, 5, 120),
      warnings: this.asStringArray(source.warnings, 4, 160),
    };
  }

  private compactNamedReasonArray(value: unknown, extraKey: string, limit: number) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map((item) => {
      const source = this.asRecord(item);
      return {
        ingredient: this.truncate(this.asString(source.ingredient), 90),
        reason: this.truncate(this.asString(source.reason), 180),
        [extraKey]: this.truncate(this.asString(source[extraKey]), 60),
      };
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private asStringArray(value: unknown, limit: number, maxLength: number) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, limit)
      .map((item) => this.truncate(item, maxLength));
  }

  private truncate(value: string, maxLength: number) {
    const trimmed = value.trim();
    return trimmed.length > maxLength ? trimmed.slice(0, maxLength - 1) + '...' : trimmed;
  }
  private async buildLibrarySuggestions({
    userMessage,
    answer,
    skinGoal,
  }: {
    userMessage: string;
    answer: string;
    skinGoal?: string | null;
  }): Promise<LibrarySuggestion | undefined> {
    const concern = this.detectSkinConcern([userMessage, answer, skinGoal ?? ''].join(' '));
    if (!concern) return undefined;

    const products = await this.products.suggestProducts(
      {
        goal: concern.productGoal,
        sensitivity: concern.sensitivity,
        sort: 'recommended',
      },
      3,
    );

    return {
      products: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        imagePath: product.imagePath,
        productType: product.productType,
        matchScore: product.matchScore,
        reason:
          product.matchReasons?.[0] ||
          concern.productReason ||
          'S?lectionn? depuis la biblioth?que produits.',
      })),
      ingredients: concern.ingredients,
    };
  }

  private detectSkinConcern(text: string):
    | {
        productGoal:
          | 'hydration'
          | 'acne'
          | 'barrier'
          | 'redness'
          | 'glow'
          | 'anti_age'
          | 'oil_control';
        sensitivity?: 'low' | 'medium' | 'high' | 'all';
        productReason: string;
        ingredients: LibrarySuggestion['ingredients'];
      }
    | null {
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const concerns = [
      {
        pattern: /\b(acne|imperfection|bouton|comedon|pores?|blemish|breakout)\b/,
        productGoal: 'acne' as const,
        productReason: 'Cibl? pour les imperfections.',
        ingredients: [
          { id: 'azelaic-acid', name: 'Azelaic Acid', category: 'Imperfections', reason: 'Aide les imperfections, marques et rougeurs visibles.' },
          { id: 'salicylic-acid', name: 'Salicylic Acid', category: 'Pores', reason: 'BHA utile pour pores obstru?s et exc?s de s?bum.' },
          { id: 'niacinamide', name: 'Niacinamide', category: '?quilibre', reason: 'Soutient la barri?re et aide ? r?guler l?apparence du s?bum.' },
        ],
      },
      {
        pattern: /\b(rougeur|redness|reactive|reactif|irritation|sensible|sensitivity)\b/,
        productGoal: 'redness' as const,
        sensitivity: 'high' as const,
        productReason: 'Option douce pour rougeurs ou peau r?active.',
        ingredients: [
          { id: 'azelaic-acid', name: 'Azelaic Acid', category: 'Rougeurs', reason: 'Souvent int?ressant pour rougeurs visibles et teint irr?gulier.' },
          { id: 'centella-asiatica', name: 'Centella Asiatica', category: 'Apaisant', reason: 'Aide ? calmer l?apparence des peaux r?actives.' },
          { id: 'panthenol', name: 'Panthenol', category: 'R?confort', reason: 'Humectant apaisant pour soutenir le confort cutan?.' },
        ],
      },
      {
        pattern: /\b(seche|dry|deshydrat|dehydrat|tiraille|flaking|squame|hydrate|hydration)\b/,
        productGoal: 'hydration' as const,
        productReason: 'S?lection hydratation et confort.',
        ingredients: [
          { id: 'hyaluronic-acid', name: 'Hyaluronic Acid', category: 'Hydratation', reason: 'Humectant qui aide ? attirer et retenir l?eau.' },
          { id: 'glycerin', name: 'Glycerin', category: 'Hydratation', reason: 'Humectant fiable pour renforcer le confort.' },
          { id: 'ceramides', name: 'Ceramides', category: 'Barri?re', reason: 'Aident ? soutenir la barri?re cutan?e.' },
        ],
      },
      {
        pattern: /\b(barriere|barrier|cica|reparation|abimee|fragilisee|overexfoliat|brulure)\b/,
        productGoal: 'barrier' as const,
        sensitivity: 'high' as const,
        productReason: 'Priorit? r?paration de la barri?re.',
        ingredients: [
          { id: 'ceramides', name: 'Ceramides', category: 'Barri?re', reason: 'Aident ? renforcer la fonction barri?re.' },
          { id: 'panthenol', name: 'Panthenol', category: 'R?confort', reason: 'Aide au confort et ? l?hydratation.' },
          { id: 'centella-asiatica', name: 'Centella Asiatica', category: 'Apaisant', reason: 'Int?ressant dans les routines r?paratrices.' },
        ],
      },
      {
        pattern: /\b(grasse|oily|sebum|seborrhee|brillance|shine)\b/,
        productGoal: 'oil_control' as const,
        productReason: 'Cibl? pour exc?s de s?bum et brillance.',
        ingredients: [
          { id: 'niacinamide', name: 'Niacinamide', category: 'S?bum', reason: 'Aide l?apparence de la brillance et de la barri?re.' },
          { id: 'salicylic-acid', name: 'Salicylic Acid', category: 'Pores', reason: 'BHA utile quand pores et s?bum sont au centre.' },
          { id: 'zinc-pca', name: 'Zinc PCA', category: '?quilibre', reason: 'Souvent utilis? dans les formules pour peaux grasses.' },
        ],
      },
      {
        pattern: /\b(tache|spot|hyperpigment|eclat|glow|terne|bright|marque)\b/,
        productGoal: 'glow' as const,
        productReason: 'Cibl? pour ?clat, marques et teint irr?gulier.',
        ingredients: [
          { id: 'vitamin-c', name: 'Vitamin C', category: '?clat', reason: 'Aide l??clat et l?apparence du teint irr?gulier.' },
          { id: 'azelaic-acid', name: 'Azelaic Acid', category: 'Marques', reason: 'Utile sur marques post-imperfections et rougeurs visibles.' },
          { id: 'niacinamide', name: 'Niacinamide', category: 'Uniformit?', reason: 'Polyvalent pour barri?re, teint et s?bum.' },
        ],
      },
      {
        pattern: /\b(age|anti age|ride|wrinkle|retinol|fermete|firmness)\b/,
        productGoal: 'anti_age' as const,
        productReason: 'Cibl? pour texture, rides visibles et pr?vention.',
        ingredients: [
          { id: 'retinol', name: 'Retinol', category: 'Texture', reason: 'Actif de r?f?rence ? introduire progressivement.' },
          { id: 'peptides', name: 'Peptides', category: 'Soutien', reason: 'Option plus douce pour routines de pr?vention.' },
          { id: 'hyaluronic-acid', name: 'Hyaluronic Acid', category: 'Hydratation', reason: 'Aide ? repulper visuellement par hydratation.' },
        ],
      },
    ];

    const matched = concerns.find((concern) => concern.pattern.test(normalized));
    if (matched) return matched;

    if (normalized.includes('barrier_repair')) return concerns[3];
    if (normalized.includes('oily_skin')) return concerns[4];
    if (normalized.includes('morning_routine')) return null;

    return null;
  }

  private async maybeSummarizeProduct(
    userId: string,
    scanId: string,
    existing: string | null | undefined,
    conversation: ReturnType<UsageService['normalizeConversation']>,
  ) {
    try {
      const result = await this.context.summarizeOlderMessages(
        conversation,
        existing,
      );
      if (!result) return;
      await this.usage.saveProductSummary(userId, scanId, result.data.summary);
      await this.telemetry.record({
        userId,
        scanId,
        provider: result.provider,
        model: result.model,
        requestType: 'summary',
        usage: result.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        'summary',
        error,
        scanId,
      );
    }
  }

  private async maybeSummarizeFace(
    userId: string,
    faceScanId: string,
    existing: string | null | undefined,
    conversation: ReturnType<UsageService['normalizeConversation']>,
  ) {
    try {
      const result = await this.context.summarizeOlderMessages(
        conversation,
        existing,
      );
      if (!result) return;
      await this.usage.saveFaceSummary(userId, faceScanId, result.data.summary);
      await this.telemetry.record({
        userId,
        faceScanId,
        provider: result.provider,
        model: result.model,
        requestType: 'summary',
        usage: result.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        'summary',
        error,
        undefined,
        faceScanId,
      );
    }
  }

  private async recordFailure(
    userId: string,
    provider: 'gemini' | 'deepseek',
    model: string,
    requestType: 'text_chat' | 'product_image_chat' | 'face_chat' | 'summary',
    error: unknown,
    scanId?: string,
    faceScanId?: string,
  ) {
    await this.telemetry
      .record({
        userId,
        scanId,
        faceScanId,
        provider,
        model,
        requestType,
        usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        success: false,
        errorCode: this.errorCode(error),
      })
      .catch(() => undefined);
  }

  private safeProviderError(error: unknown, message: string) {
    if (error instanceof HttpException) return error;
    return new HttpException(
      { message, code: this.errorCode(error) },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private errorCode(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code;
    }
    return 'provider-error';
  }

  private assertNonDiagnostic(observation: FaceObservation) {
    const text = [
      ...observation.observations.map((item) => item.description),
      ...observation.limitations,
    ].join(' ');
    if (containsDiagnosticWording(text)) {
      throw new UnprocessableEntityException({
        message:
          'The visual response contained diagnostic wording and was rejected.',
        code: 'diagnostic-wording-rejected',
      });
    }
  }
}
