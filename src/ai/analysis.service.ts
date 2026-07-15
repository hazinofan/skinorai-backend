import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { AnalyzeScanRequestDto } from './dto/analyze-scan-request.dto';
import { AnalyzeScanResponseDto } from './dto/analyze-scan-response.dto';
import { AiProviderConfigService } from './config/ai-provider.config';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { PRODUCT_EXTRACTION_PROMPT } from './prompts/product-extraction.prompt';
import { PRODUCT_ANALYSIS_SYSTEM_PROMPT } from './prompts/product-analysis.prompt';
import { FACE_OBSERVATION_PROMPT } from './prompts/face-observation.prompt';
import { FACE_GUIDANCE_SYSTEM_PROMPT } from './prompts/face-guidance.prompt';
import {
  productExtractionJsonSchema,
  productExtractionSchema,
} from './schemas/product-extraction.schema';
import {
  faceObservationJsonSchema,
  faceObservationSchema,
} from './schemas/face-observation.schema';
import {
  analysisResponseSchema,
  faceGuidanceSchema,
} from './schemas/analysis-response.schema';
import {
  ProductExtraction,
  FaceObservation,
  ProviderResult,
} from './types/ai.types';
import {
  ImageProcessingService,
  ProcessedImage,
} from '../common/images/image-processing.service';
import { UsageService } from '../usage/usage.service';
import { ProductsService } from '../products/products.service';
import { OcrService } from '../ocr/ocr.service';
import { AiTelemetryService } from './telemetry.service';
import { containsDiagnosticWording } from './safety/face-safety';
import { buildConversationMessage } from './message.factory';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly config: AiProviderConfigService,
    private readonly gemini: GeminiProvider,
    private readonly deepseek: DeepSeekProvider,
    private readonly images: ImageProcessingService,
    private readonly usage: UsageService,
    private readonly products: ProductsService,
    private readonly ocr: OcrService,
    private readonly telemetry: AiTelemetryService,
  ) {}

  async extractProduct(userId: string, file: Express.Multer.File) {
    const image = await this.images.process(file);
    let result: ProviderResult<ProductExtraction>;
    try {
      result = await this.gemini.generateJson({
        model: this.config.geminiProductModel,
        prompt: PRODUCT_EXTRACTION_PROMPT,
        images: [{ buffer: image.buffer, mimeType: image.mimeType }],
        schema: productExtractionSchema,
        jsonSchema: productExtractionJsonSchema,
        maxOutputTokens: this.config.geminiProductMaxOutputTokens,
        requestType: 'product_extraction',
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'gemini',
        this.config.geminiProductModel,
        'product_extraction',
        error,
      );
      throw this.safeProviderError(
        error,
        'Product visual extraction is temporarily unavailable.',
      );
    }

    const extraction = await this.maybeApplyVisionFallback(result.data, image);
    const saved = await this.usage.saveExtraction({
      userId,
      extraction,
      mimeType: image.mimeType,
      imageBytes: image.originalBytes,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.usage.latencyMs,
    });
    await this.telemetry.record({
      userId,
      provider: result.provider,
      model: result.model,
      requestType: 'product_extraction',
      usage: result.usage,
    });

    return { extractionId: saved.id, ...extraction };
  }

  async analyzeProduct(
    userId: string,
    dto: AnalyzeScanRequestDto,
  ): Promise<AnalyzeScanResponseDto> {
    await this.usage.assertCanAnalyze(userId);
    const confirmedIngredients = this.normalizeIngredients(
      dto.confirmedIngredients,
    );
    if (!confirmedIngredients.length)
      throw new BadRequestException(
        'At least one confirmed ingredient is required.',
      );

    const extractionRecord = dto.extractionId
      ? await this.usage.getExtractionOwned(userId, dto.extractionId)
      : null;
    const extraction = extractionRecord?.extraction
      ? productExtractionSchema.parse(extractionRecord.extraction)
      : null;
    const trustedProduct = await this.products.findReliableMatch(
      extraction?.brand,
      extraction?.productName,
    );
    const productName =
      trustedProduct?.name || extraction?.productName || 'Produit analysé';
    const fullIngredientListVisible =
      extraction?.fullIngredientListVisible ?? false;

    const promptPayload = {
      skinGoal: dto.skinGoal,
      confirmedIngredients,
      extractedVisibleFacts: extraction
        ? {
            brand: extraction.brand,
            productName: extraction.productName,
            productCategory: extraction.productCategory,
            visibleClaims: extraction.visibleClaims,
            fullIngredientListVisible,
            warnings: extraction.warnings,
          }
        : null,
      trustedDatabaseProduct: trustedProduct,
      analysisScope: fullIngredientListVisible
        ? 'The confirmed list appears complete.'
        : 'The ingredient list is partial. State this clearly and limit conclusions.',
    };

    let analysisResult: AnalyzeScanResponseDto;
    let providerResult: ProviderResult<
      z.infer<typeof analysisResponseSchema>
    > | null = null;
    try {
      providerResult = await this.deepseek.generateJson({
        requestType: 'product_analysis',
        schema: analysisResponseSchema,
        messages: [
          { role: 'system', content: PRODUCT_ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(promptPayload) },
        ],
      });
      analysisResult = providerResult.data;
      await this.telemetry.record({
        userId,
        provider: providerResult.provider,
        model: providerResult.model,
        requestType: 'product_analysis',
        usage: providerResult.usage,
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          provider: 'deepseek',
          requestType: 'product_analysis',
          success: false,
          code: this.errorCode(error),
        }),
      );
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        'product_analysis',
        error,
      );
      analysisResult = this.buildLocalFallback(
        dto.skinGoal,
        confirmedIngredients,
        fullIngredientListVisible,
      );
    }

    const messageResult = providerResult ?? {
      provider: 'local-fallback' as const,
      model: 'deterministic-product-fallback',
      usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      data: analysisResult,
    };
    const initialMessage = buildConversationMessage({
      role: 'assistant',
      content: this.buildInitialAnalysisMessage(productName, analysisResult),
      result: messageResult,
      requestType: 'product_analysis',
    });

    const saved = await this.usage.recordProductScan({
      userId,
      productName,
      skinGoal: dto.skinGoal,
      ingredients: confirmedIngredients,
      extractedProductData: extraction,
      trustedProductData: trustedProduct,
      fullIngredientListVisible,
      analysisResult,
      analysisProvider: messageResult.provider,
      analysisModel: messageResult.model,
      initialMessage,
    });

    return { ...analysisResult, scanId: saved.scan.id, quota: saved.quota };
  }

  async analyzeFace({
    userId,
    frontImage,
    leftImage,
    rightImage,
    skinGoal,
    consentAccepted,
  }: {
    userId: string;
    frontImage: Express.Multer.File;
    leftImage?: Express.Multer.File;
    rightImage?: Express.Multer.File;
    skinGoal?: string;
    consentAccepted: boolean;
  }) {
    await this.usage.assertPro(userId);
    if (!consentAccepted)
      throw new BadRequestException('Explicit consent is required.');
    if (!frontImage)
      throw new BadRequestException('A front-facing photo is required.');
    await this.telemetry.assertFaceScanRateLimit(userId);

    const processed = await Promise.all([
      this.images.process(frontImage),
      ...(leftImage ? [this.images.process(leftImage)] : []),
      ...(rightImage ? [this.images.process(rightImage)] : []),
    ]);

    let observationResult: ProviderResult<FaceObservation>;
    try {
      observationResult = await this.gemini.generateJson({
        model: this.config.geminiFaceModel,
        prompt: `${FACE_OBSERVATION_PROMPT}\nImages are ordered as front, optional left, optional right.`,
        images: processed.map((image) => ({
          buffer: image.buffer,
          mimeType: image.mimeType,
        })),
        schema: faceObservationSchema,
        jsonSchema: faceObservationJsonSchema,
        maxOutputTokens: this.config.geminiFaceMaxOutputTokens,
        requestType: 'face_scan',
      });
      this.assertNonDiagnosticObservation(observationResult.data);
      await this.telemetry.record({
        userId,
        provider: observationResult.provider,
        model: observationResult.model,
        requestType: 'face_scan',
        usage: observationResult.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'gemini',
        this.config.geminiFaceModel,
        'face_scan',
        error,
      );
      throw this.safeProviderError(
        error,
        'Face visual observation is temporarily unavailable.',
      );
    }

    if (!observationResult.data.usable) {
      return {
        usable: false,
        faceScanId: null,
        observations: observationResult.data,
        guidance: null,
        privacy: this.facePrivacyNotice(),
      };
    }

    let guidanceResult: ProviderResult<z.infer<typeof faceGuidanceSchema>>;
    try {
      guidanceResult = await this.deepseek.generateJson({
        requestType: 'face_scan',
        schema: faceGuidanceSchema,
        messages: [
          { role: 'system', content: FACE_GUIDANCE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              skinGoal: skinGoal ?? null,
              observations: observationResult.data,
            }),
          },
        ],
      });
      await this.telemetry.record({
        userId,
        provider: guidanceResult.provider,
        model: guidanceResult.model,
        requestType: 'face_scan',
        usage: guidanceResult.usage,
      });
    } catch (error) {
      await this.recordFailure(
        userId,
        'deepseek',
        this.config.deepseekModel,
        'face_scan',
        error,
      );
      throw this.safeProviderError(
        error,
        'Face guidance is temporarily unavailable.',
      );
    }

    const initialMessage = buildConversationMessage({
      role: 'assistant',
      content: guidanceResult.data.explanation,
      result: guidanceResult,
      requestType: 'face_scan',
      visualContext: observationResult.data,
    });
    const saved = await this.usage.createFaceScan({
      userId,
      skinGoal,
      observations: observationResult.data,
      guidance: guidanceResult.data,
      imageMimeTypes: processed.map((image) => image.mimeType),
      initialMessage,
    });

    return {
      usable: true,
      faceScanId: saved.id,
      observations: observationResult.data,
      guidance: guidanceResult.data,
      privacy: this.facePrivacyNotice(),
    };
  }

  private async maybeApplyVisionFallback(
    extraction: ProductExtraction,
    image: ProcessedImage,
  ) {
    const shouldFallback =
      this.config.visionFallbackEnabled &&
      this.ocr.isConfigured() &&
      extraction.imageType === 'product_label' &&
      (extraction.confidence === 'low' ||
        (!extraction.ingredients.length && extraction.visibleText.length > 0));
    if (!shouldFallback) return extraction;

    try {
      const fallback = await this.ocr.extractIngredientsFromBuffer(
        image.buffer,
        image.mimeType,
      );
      if (!fallback.ingredients.length) return extraction;
      return {
        ...extraction,
        ingredients: fallback.ingredients,
        fullIngredientListVisible: false,
        warnings: [
          ...extraction.warnings,
          'Ingredient text was supplemented by optional Google Vision OCR and must be reviewed.',
        ],
        confidence: 'low' as const,
      };
    } catch {
      return extraction;
    }
  }

  private normalizeIngredients(values: string[]) {
    const seen = new Set<string>();
    return values
      .map((value) => value.trim())
      .filter((value) => {
        if (!value) return false;
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 250);
  }

  private assertNonDiagnosticObservation(observation: FaceObservation) {
    const text = [
      ...observation.observations.map((item) => item.description),
      ...observation.limitations,
      ...observation.retakeInstructions,
    ].join(' ');
    if (containsDiagnosticWording(text)) {
      throw new UnprocessableEntityException({
        message:
          'The visual response contained diagnostic wording and was rejected.',
        code: 'diagnostic-wording-rejected',
      });
    }
  }

  private buildLocalFallback(
    goal: string,
    ingredients: string[],
    fullList: boolean,
  ): AnalyzeScanResponseDto {
    const helpful = [
      'glycerin',
      'hyaluron',
      'niacinamide',
      'panthenol',
      'ceramide',
      'centella',
      'salicy',
    ];
    const caution = [
      'fragrance',
      'parfum',
      'alcohol denat',
      'retinol',
      'glycolic',
    ];
    const positives = ingredients
      .filter((i) => helpful.some((term) => i.toLowerCase().includes(term)))
      .slice(0, 4)
      .map((ingredient) => ({
        ingredient,
        reason: `May support the selected ${goal.replace(/_/g, ' ')} goal.`,
        tag: 'Potentially useful',
      }));
    const watchouts = ingredients
      .filter((i) => caution.some((term) => i.toLowerCase().includes(term)))
      .slice(0, 4)
      .map((ingredient) => ({
        ingredient,
        reason: 'Introduce cautiously and patch test if your skin is reactive.',
        severity: 'medium' as const,
      }));
    const score = Math.max(
      3.5,
      Math.min(9.2, 6.5 + positives.length * 0.6 - watchouts.length * 0.5),
    );
    return {
      score: Number(score.toFixed(1)),
      verdict:
        score >= 8
          ? 'good_choice'
          : watchouts.length > 1
            ? 'use_with_caution'
            : 'good_choice',
      verdictLabel:
        score >= 8 ? 'Bon choix potentiel' : 'À introduire progressivement',
      summary: `${fullList ? 'La liste confirmée' : 'La liste partielle confirmée'} présente ${positives.length} point(s) utile(s) et ${watchouts.length} point(s) à surveiller.`,
      positives,
      watchouts,
      recommendations: [
        'Faites un test localisé.',
        'Introduisez un nouveau produit progressivement.',
        'Utilisez une protection solaire le matin.',
      ],
      nextStep:
        'Commencez quelques fois par semaine et observez la tolérance de votre peau.',
      followUpQuestions: [
        'Comment l’intégrer à ma routine ?',
        'Quels ingrédients dois-je surveiller ?',
        'Puis-je l’utiliser matin et soir ?',
      ],
      disclaimer: `Analyse ${fullList ? 'basée sur la liste confirmée' : 'partielle car la liste complète n’était pas visible'}. Ceci n’est pas un diagnostic médical.`,
    };
  }

  private buildInitialAnalysisMessage(
    productName: string,
    result: AnalyzeScanResponseDto,
  ) {
    return [
      `${productName}: ${result.summary}`,
      result.positives.length
        ? `Points forts: ${result.positives.map((item) => item.ingredient).join(', ')}.`
        : null,
      result.watchouts.length
        ? `À surveiller: ${result.watchouts.map((item) => item.ingredient).join(', ')}.`
        : null,
      `Prochaine étape: ${result.nextStep}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private facePrivacyNotice() {
    return {
      processedForAnalysis: true,
      rawPhotosStored: false,
      nonDiagnostic: true,
      cameraAndLightingMayAffectResults: true,
    };
  }

  private safeProviderError(error: unknown, message: string) {
    if (error instanceof HttpException) return error;
    return new HttpException(
      { message, code: this.errorCode(error) },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async recordFailure(
    userId: string,
    provider: 'gemini' | 'deepseek',
    model: string,
    requestType: 'product_extraction' | 'product_analysis' | 'face_scan',
    error: unknown,
  ) {
    await this.telemetry
      .record({
        userId,
        provider,
        model,
        requestType,
        usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        success: false,
        errorCode: this.errorCode(error),
      })
      .catch(() => undefined);
  }

  private errorCode(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    )
      return (error as { code: string }).code;
    return 'provider-error';
  }
}
