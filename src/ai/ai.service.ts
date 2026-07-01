import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AnalyzeScanRequestDto,
  SkinGoal,
} from './dto/analyze-scan-request.dto';
import {
  AnalyzeScanResponseDto,
  ScanVerdict,
  WatchoutSeverity,
} from './dto/analyze-scan-response.dto';

const SUPPORTED_SKIN_GOALS: SkinGoal[] = [
  'hydration',
  'acne',
  'barrier_repair',
  'redness',
  'oily_skin',
  'morning_routine',
  'sensitive_skin',
];

const VERDICTS: ScanVerdict[] = [
  'excellent_match',
  'good_choice',
  'use_with_caution',
  'not_ideal',
];

const SEVERITIES: WatchoutSeverity[] = ['low', 'medium', 'high'];
const DEFAULT_OPENAI_TIMEOUT_MS = 15000;
const DEFAULT_OPENAI_MAX_RETRIES = 0;
const DEFAULT_OPENAI_ANALYSIS_MODEL = 'gpt-4.1-mini';
const MAX_PROMPT_INGREDIENTS_TEXT_LENGTH = 1800;

const GOAL_DETAILS: Record<
  SkinGoal,
  {
    label: string;
    keywords: string[];
    recommendations: string[];
    questions: string[];
  }
> = {
  hydration: {
    label: 'hydratation',
    keywords: ['glycerin', 'hyaluron', 'panthenol', 'betaine', 'urea', 'aloe'],
    recommendations: [
      'Appliquez sur peau legerement humide.',
      'Scellez avec une creme hydratante si la peau tire.',
      'Gardez une protection solaire le matin.',
    ],
    questions: [
      'Puis-je l utiliser avec du retinol ?',
      'Est-ce adapte a une peau deshydratee ?',
      'A quelle frequence commencer ?',
    ],
  },
  acne: {
    label: 'imperfections',
    keywords: ['salicy', 'niacinamide', 'zinc', 'sulfur', 'azela', 'tea tree'],
    recommendations: [
      'Introduisez le produit progressivement.',
      'Evitez de multiplier les actifs irritants le meme soir.',
      'Hydratez pour soutenir la barriere cutanee.',
    ],
    questions: [
      'Ce produit aide-t-il contre les boutons ?',
      'Puis-je l utiliser avec un exfoliant ?',
      'Quels ingredients surveiller ?',
    ],
  },
  barrier_repair: {
    label: 'barriere cutanee',
    keywords: [
      'ceramide',
      'panthenol',
      'squalane',
      'cholesterol',
      'centella',
      'oat',
    ],
    recommendations: [
      'Gardez une routine simple quelques jours.',
      'Evitez les exfoliants forts si la peau est reactive.',
      'Appliquez avec des gestes doux.',
    ],
    questions: [
      'Est-ce adapte apres une irritation ?',
      'Peut-il reparer la barriere ?',
      'Avec quoi le combiner ?',
    ],
  },
  redness: {
    label: 'rougeurs',
    keywords: [
      'allantoin',
      'centella',
      'panthenol',
      'bisabolol',
      'aloe',
      'oat',
    ],
    recommendations: [
      'Testez d abord sur une petite zone.',
      'Evitez l eau tres chaude apres application.',
      'Associez-le a une routine douce.',
    ],
    questions: [
      'Convient-il a une peau sensible ?',
      'Peut-il aggraver les rougeurs ?',
      'Quand faire un test localise ?',
    ],
  },
  oily_skin: {
    label: 'peau grasse',
    keywords: [
      'niacinamide',
      'zinc',
      'salicy',
      'green tea',
      'clay',
      'tea tree',
    ],
    recommendations: [
      'Appliquez en fine couche.',
      'Ne sautez pas l hydratation.',
      'Surveillez le fini sur la zone T.',
    ],
    questions: [
      'Risque-t-il de boucher les pores ?',
      'Aide-t-il contre la brillance ?',
      'Est-ce trop riche pour moi ?',
    ],
  },
  morning_routine: {
    label: 'routine du matin',
    keywords: [
      'vitamin c',
      'niacinamide',
      'caffeine',
      'green tea',
      'hyaluron',
      'glycerin',
    ],
    recommendations: [
      'Superposez du plus leger au plus riche.',
      'Terminez par une protection solaire.',
      'Verifiez que la texture ne peluche pas.',
    ],
    questions: [
      'Se combine-t-il avec la vitamine C ?',
      'Est-ce bien avant le SPF ?',
      'Puis-je l utiliser chaque matin ?',
    ],
  },
  sensitive_skin: {
    label: 'peau sensible',
    keywords: [
      'allantoin',
      'panthenol',
      'centella',
      'oat',
      'bisabolol',
      'ceramide',
    ],
    recommendations: [
      'Faites un test localise avant usage regulier.',
      'Evitez de le combiner avec trop d actifs.',
      'Espacez les applications si la peau picote.',
    ],
    questions: [
      'Quels ingredients sont sensibles ?',
      'Comment faire un test localise ?',
      'Puis-je l utiliser tous les jours ?',
    ],
  },
};

const WATCHOUT_RULES = [
  {
    terms: ['parfum', 'fragrance'],
    severity: 'medium' as const,
    reason: 'Peut sensibiliser certaines peaux reactives.',
  },
  {
    terms: ['alcohol denat', 'denat', 'sd alcohol'],
    severity: 'medium' as const,
    reason: 'Peut etre dessechant selon la tolerance.',
  },
  {
    terms: ['essential oil', 'limonene', 'linalool', 'citral', 'geraniol'],
    severity: 'medium' as const,
    reason: 'A surveiller si votre peau reagit facilement.',
  },
  {
    terms: ['retinol', 'retinal', 'tretinoin'],
    severity: 'high' as const,
    reason: 'Actif puissant pouvant irriter si mal introduit.',
  },
  {
    terms: ['glycolic', 'lactic acid', 'salicylic acid', 'mandelic'],
    severity: 'low' as const,
    reason: 'Exfoliant utile mais a introduire progressivement.',
  },
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'score',
    'verdict',
    'verdictLabel',
    'summary',
    'positives',
    'watchouts',
    'recommendations',
    'nextStep',
    'followUpQuestions',
    'disclaimer',
  ],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 10 },
    verdict: { type: 'string', enum: VERDICTS },
    verdictLabel: { type: 'string' },
    summary: { type: 'string', maxLength: 280 },
    positives: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ingredient', 'reason', 'tag'],
        properties: {
          ingredient: { type: 'string' },
          reason: { type: 'string' },
          tag: { type: 'string' },
        },
      },
    },
    watchouts: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ingredient', 'reason', 'severity'],
        properties: {
          ingredient: { type: 'string' },
          reason: { type: 'string' },
          severity: { type: 'string', enum: SEVERITIES },
        },
      },
    },
    recommendations: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string' },
    },
    nextStep: { type: 'string', maxLength: 220 },
    followUpQuestions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
    },
    disclaimer: { type: 'string' },
  },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client?: OpenAI;
  private readonly model: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_ANALYSIS_MODEL') ??
      DEFAULT_OPENAI_ANALYSIS_MODEL;
    this.requestTimeoutMs = this.getNumberConfig(
      'OPENAI_ANALYSIS_TIMEOUT_MS',
      DEFAULT_OPENAI_TIMEOUT_MS,
    );
    this.maxRetries = this.getNumberConfig(
      'OPENAI_ANALYSIS_MAX_RETRIES',
      DEFAULT_OPENAI_MAX_RETRIES,
    );

    if (!apiKey) {
      return;
    }

    this.client = new OpenAI({
      apiKey,
      timeout: this.requestTimeoutMs,
      maxRetries: this.maxRetries,
    });
  }

  async analyzeScan(
    request: AnalyzeScanRequestDto,
  ): Promise<AnalyzeScanResponseDto> {
    const validatedRequest = this.validateRequest(request);

    if (!this.client) {
      this.logger.warn('OPENAI_API_KEY is missing; using local scan analysis.');
      return this.buildFallbackAnalysis(validatedRequest);
    }

    try {
      const responseText = await this.requestOpenAiAnalysis(validatedRequest);
      const parsedResponse = this.parseAiResponse(responseText);

      return this.validateAiResponse(
        parsedResponse,
        validatedRequest.ingredients,
      );
    } catch (error) {
      this.logger.warn(
        `OpenAI scan analysis failed; using local fallback. ${this.formatOpenAiError(error)}`,
      );
      return this.buildFallbackAnalysis(validatedRequest);
    }
  }

  private validateRequest(
    request: AnalyzeScanRequestDto,
  ): AnalyzeScanRequestDto {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException('Request body is required.');
    }

    if (!SUPPORTED_SKIN_GOALS.includes(request.skinGoal)) {
      throw new BadRequestException('Unsupported or missing skinGoal.');
    }

    if (
      !Array.isArray(request.ingredients) ||
      request.ingredients.length === 0
    ) {
      throw new BadRequestException('ingredients must be a non-empty array.');
    }

    if (request.ingredients.length > 150) {
      throw new BadRequestException('ingredients cannot exceed 150 items.');
    }

    const ingredients = request.ingredients.map((ingredient) => {
      if (typeof ingredient !== 'string' || !ingredient.trim()) {
        throw new BadRequestException('Each ingredient must be a string.');
      }

      const trimmedIngredient = this.cleanIngredientName(ingredient);

      if (trimmedIngredient.length > 120) {
        throw new BadRequestException(
          'Each ingredient must be 120 characters or fewer.',
        );
      }

      return trimmedIngredient;
    });

    if (request.ingredientsText && request.ingredientsText.length > 8000) {
      throw new BadRequestException(
        'ingredientsText must be 8000 characters or fewer.',
      );
    }

    if (request.productName && request.productName.length > 120) {
      throw new BadRequestException(
        'productName must be 120 characters or fewer.',
      );
    }

    if (request.productCategory && request.productCategory.length > 80) {
      throw new BadRequestException(
        'productCategory must be 80 characters or fewer.',
      );
    }

    return {
      ...request,
      productName: request.productName?.trim(),
      productCategory: request.productCategory?.trim(),
      ingredients,
      ingredientsText: request.ingredientsText?.trim(),
    };
  }

  private async requestOpenAiAnalysis(
    request: AnalyzeScanRequestDto,
  ): Promise<string> {
    const client = this.client;

    if (!client) {
      throw new InternalServerErrorException(
        'OpenAI API key is not configured.',
      );
    }

    const response = await client.responses.create(
      {
        model: this.model,
        input: [
          {
            role: 'system',
            content:
              'You are SkinorAI, a skincare ingredient analysis assistant. Return ONLY JSON that matches the schema. Write concise French UI text. This is informational, not medical advice.',
          },
          {
            role: 'user',
            content: this.buildAnalysisPrompt(request),
          },
        ],
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'skinorai_scan_analysis',
            strict: true,
            schema: ANALYSIS_SCHEMA,
          },
        },
        max_output_tokens: 900,
        temperature: 0.2,
      },
      {
        timeout: this.requestTimeoutMs,
        maxRetries: this.maxRetries,
      },
    );

    const outputText = response.output_text;

    if (!outputText) {
      throw new Error('OpenAI response did not include output text.');
    }

    return outputText;
  }

  private buildAnalysisPrompt(request: AnalyzeScanRequestDto): string {
    return [
      `Selected skin goal: ${request.skinGoal}`,
      `Product name: ${request.productName || 'unknown'}`,
      `Product category: ${request.productCategory || 'unknown'}`,
      `Confirmed ingredients: ${request.ingredients.join(', ')}`,
      request.ingredientsText
        ? `Original confirmed ingredient text: ${this.truncateText(
            request.ingredientsText,
            MAX_PROMPT_INGREDIENTS_TEXT_LENGTH,
          )}`
        : '',
      '',
      'Analyze only the listed ingredients. Do not invent ingredients.',
      'Consider known skincare roles, likely benefits, irritants, sensitizers, fragrance, drying alcohols, acids, retinoids, and goal fit.',
      'Use cautious language like "peut", "possible", "peut aider".',
      'Do not diagnose conditions, recommend prescription medicine, or tell users to stop medical treatment.',
      'Suggest patch testing when relevant.',
      'Keep all strings short because the frontend cards are compact.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private parseAiResponse(responseText: string): unknown {
    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw new UnprocessableEntityException(
        'AI response could not be parsed as JSON.',
      );
    }
  }

  private buildFallbackAnalysis(
    request: AnalyzeScanRequestDto,
  ): AnalyzeScanResponseDto {
    const goal = GOAL_DETAILS[request.skinGoal];
    const positives = request.ingredients
      .filter((ingredient) => this.isGoalMatch(ingredient, request.skinGoal))
      .slice(0, 5)
      .map((ingredient) => ({
        ingredient,
        reason: `Peut soutenir un objectif ${goal.label}.`,
        tag: 'Point positif',
      }));
    const watchouts = request.ingredients
      .map((ingredient) => this.buildWatchout(ingredient))
      .filter((watchout): watchout is NonNullable<typeof watchout> =>
        Boolean(watchout),
      )
      .slice(0, 5);
    const score = this.calculateFallbackScore(positives.length, watchouts);
    const verdict = this.toVerdict(score, watchouts);

    return {
      score,
      verdict,
      verdictLabel: this.toVerdictLabel(verdict),
      summary:
        watchouts.length > 0
          ? `Analyse rapide: formule interessante pour ${goal.label}, avec ${watchouts.length} ingredient${watchouts.length > 1 ? 's' : ''} a surveiller.`
          : `Analyse rapide: formule globalement coherente pour ${goal.label}, sans gros signal irritant evident.`,
      positives:
        positives.length > 0
          ? positives
          : request.ingredients.slice(0, 3).map((ingredient) => ({
              ingredient,
              reason: 'Ingredient compatible avec une routine simple.',
              tag: 'Compatible',
            })),
      watchouts,
      recommendations: goal.recommendations,
      nextStep:
        watchouts.length > 0
          ? 'Commencez par un test localise puis espacez les applications si la peau picote.'
          : 'Introduisez le produit progressivement et observez le confort de votre peau.',
      followUpQuestions: goal.questions,
      disclaimer:
        'Analyse informative, non medicale. Consultez un professionnel en cas de doute.',
    };
  }

  private isGoalMatch(ingredient: string, skinGoal: SkinGoal): boolean {
    const normalizedIngredient = ingredient.toLowerCase();
    return GOAL_DETAILS[skinGoal].keywords.some((keyword) =>
      normalizedIngredient.includes(keyword),
    );
  }

  private buildWatchout(ingredient: string) {
    const normalizedIngredient = ingredient.toLowerCase();
    const rule = WATCHOUT_RULES.find((candidate) =>
      candidate.terms.some((term) => normalizedIngredient.includes(term)),
    );

    if (!rule) {
      return null;
    }

    return {
      ingredient,
      reason: rule.reason,
      severity: rule.severity,
    };
  }

  private calculateFallbackScore(
    positiveCount: number,
    watchouts: AnalyzeScanResponseDto['watchouts'],
  ): number {
    const penalty = watchouts.reduce((total, watchout) => {
      const severityPenalty =
        watchout.severity === 'high'
          ? 1.2
          : watchout.severity === 'medium'
            ? 0.8
            : 0.4;

      return total + severityPenalty;
    }, 0);
    const rawScore = 7 + positiveCount * 0.45 - penalty;

    return Number(Math.min(9.5, Math.max(4.5, rawScore)).toFixed(1));
  }

  private toVerdict(
    score: number,
    watchouts: AnalyzeScanResponseDto['watchouts'],
  ): ScanVerdict {
    if (watchouts.some((watchout) => watchout.severity === 'high')) {
      return score >= 6.8 ? 'use_with_caution' : 'not_ideal';
    }

    if (score >= 8.5) {
      return 'excellent_match';
    }

    if (score >= 6.5) {
      return watchouts.length > 2 ? 'use_with_caution' : 'good_choice';
    }

    if (score >= 6) {
      return 'use_with_caution';
    }

    return 'not_ideal';
  }

  private cleanIngredientName(value: string): string {
    return value
      .trim()
      .replace(/[.;,]+$/g, '')
      .trim();
  }

  private toVerdictLabel(verdict: ScanVerdict): string {
    const labels: Record<ScanVerdict, string> = {
      excellent_match: 'Excellent match',
      good_choice: 'Bon choix',
      use_with_caution: 'A utiliser avec prudence',
      not_ideal: 'Pas ideal',
    };

    return labels[verdict];
  }

  private truncateText(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private getNumberConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));

    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private formatOpenAiError(error: unknown): string {
    if (!this.isRecord(error)) {
      return 'Unknown error.';
    }

    const status = typeof error.status === 'number' ? error.status : undefined;
    const code = typeof error.code === 'string' ? error.code : undefined;
    const type = typeof error.type === 'string' ? error.type : undefined;
    const message =
      typeof error.message === 'string' ? error.message : 'Unknown error.';

    return JSON.stringify({ status, code, type, message });
  }

  private validateAiResponse(
    value: unknown,
    allowedIngredients: string[],
  ): AnalyzeScanResponseDto {
    if (!this.isRecord(value)) {
      throw new UnprocessableEntityException('AI response is not an object.');
    }

    const positives = this.validatePositives(
      value.positives,
      allowedIngredients,
    );
    const watchouts = this.validateWatchouts(
      value.watchouts,
      allowedIngredients,
    );
    const recommendations = this.validateStringArray(
      value.recommendations,
      'recommendations',
      4,
    );
    const followUpQuestions = this.validateStringArray(
      value.followUpQuestions,
      'followUpQuestions',
      3,
      3,
    );

    if (
      typeof value.score !== 'number' ||
      value.score < 0 ||
      value.score > 10
    ) {
      throw new UnprocessableEntityException('AI score is invalid.');
    }

    if (!this.isScanVerdict(value.verdict)) {
      throw new UnprocessableEntityException('AI verdict is invalid.');
    }

    const verdictLabel = this.validateString(
      value.verdictLabel,
      'verdictLabel',
    );
    const summary = this.validateString(value.summary, 'summary', 280);
    const nextStep = this.validateString(value.nextStep, 'nextStep', 220);
    const disclaimer = this.validateString(value.disclaimer, 'disclaimer');

    return {
      score: Number(value.score.toFixed(1)),
      verdict: value.verdict,
      verdictLabel,
      summary,
      positives,
      watchouts,
      recommendations,
      nextStep,
      followUpQuestions,
      disclaimer,
    };
  }

  private validatePositives(
    value: unknown,
    allowedIngredients: string[],
  ): AnalyzeScanResponseDto['positives'] {
    if (!Array.isArray(value) || value.length > 5) {
      throw new UnprocessableEntityException('AI positives are invalid.');
    }

    return value.map((item) => {
      if (!this.isRecord(item)) {
        throw new UnprocessableEntityException('AI positive item is invalid.');
      }

      const ingredient = this.validateListedIngredient(
        item.ingredient,
        allowedIngredients,
      );

      return {
        ingredient,
        reason: this.validateString(item.reason, 'positive.reason'),
        tag: this.validateString(item.tag, 'positive.tag'),
      };
    });
  }

  private validateWatchouts(
    value: unknown,
    allowedIngredients: string[],
  ): AnalyzeScanResponseDto['watchouts'] {
    if (!Array.isArray(value) || value.length > 5) {
      throw new UnprocessableEntityException('AI watchouts are invalid.');
    }

    return value.map((item) => {
      if (!this.isRecord(item)) {
        throw new UnprocessableEntityException('AI watchout item is invalid.');
      }

      const ingredient = this.validateListedIngredient(
        item.ingredient,
        allowedIngredients,
      );

      if (!this.isWatchoutSeverity(item.severity)) {
        throw new UnprocessableEntityException(
          'AI watchout severity is invalid.',
        );
      }

      return {
        ingredient,
        reason: this.validateString(item.reason, 'watchout.reason'),
        severity: item.severity,
      };
    });
  }

  private validateListedIngredient(
    value: unknown,
    allowedIngredients: string[],
  ) {
    const ingredient = this.validateString(value, 'ingredient');
    const normalizedIngredient = ingredient.toLowerCase();
    const exists = allowedIngredients.some(
      (allowedIngredient) =>
        allowedIngredient.toLowerCase() === normalizedIngredient,
    );

    if (!exists) {
      throw new UnprocessableEntityException(
        `AI referenced an ingredient that was not provided: ${ingredient}`,
      );
    }

    return ingredient;
  }

  private validateStringArray(
    value: unknown,
    fieldName: string,
    maxLength: number,
    exactLength?: number,
  ): string[] {
    if (!Array.isArray(value) || value.length > maxLength) {
      throw new UnprocessableEntityException(`${fieldName} is invalid.`);
    }

    if (exactLength !== undefined && value.length !== exactLength) {
      throw new UnprocessableEntityException(
        `${fieldName} must contain exactly ${exactLength} items.`,
      );
    }

    return value.map((item) => this.validateString(item, fieldName));
  }

  private validateString(
    value: unknown,
    fieldName: string,
    maxLength?: number,
  ): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new UnprocessableEntityException(`${fieldName} is invalid.`);
    }

    const trimmedValue = value.trim();

    if (maxLength && trimmedValue.length > maxLength) {
      throw new UnprocessableEntityException(`${fieldName} is too long.`);
    }

    return trimmedValue;
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private isScanVerdict(value: unknown): value is ScanVerdict {
    return typeof value === 'string' && VERDICTS.includes(value as ScanVerdict);
  }

  private isWatchoutSeverity(value: unknown): value is WatchoutSeverity {
    return (
      typeof value === 'string' &&
      SEVERITIES.includes(value as WatchoutSeverity)
    );
  }
}
