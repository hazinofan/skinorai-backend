import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AnalyzeScanResponseDto } from '../ai/dto/analyze-scan-response.dto';
import { ConversationMessage, ProductExtraction } from '../ai/types/ai.types';
import { UserEntity } from '../auth/entities/user.entity';
import { FaceScanRecordEntity } from './entities/face-scan-record.entity';
import { ProductExtractionEntity } from './entities/product-extraction.entity';
import { ScanRecordEntity } from './entities/scan-record.entity';

export type PlanStatus = 'free' | 'pro';
export type QuotaStatus = {
  planStatus: PlanStatus;
  freeScanLimit: number;
  freeScansUsed: number;
  freeScansRemaining: number;
  freePromptLimit: number;
  promptCount: number;
  promptsRemaining: number;
};

const FREE_SCAN_LIMIT = 3;
const FREE_PROMPT_LIMIT = 1;
const PRO_REMAINING_ALLOWANCE = 999_999;

@Injectable()
export class UsageService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(ScanRecordEntity)
    private readonly scans: Repository<ScanRecordEntity>,
    @InjectRepository(ProductExtractionEntity)
    private readonly extractions: Repository<ProductExtractionEntity>,
    @InjectRepository(FaceScanRecordEntity)
    private readonly faceScans: Repository<FaceScanRecordEntity>,
  ) {}

  async assertCanAnalyze(userId: string): Promise<QuotaStatus> {
    const user = await this.findUserOrThrow(userId);
    this.normalizeUser(user);
    const quota = this.buildQuotaStatus(user);
    if (user.planStatus !== 'pro' && user.freeScansUsed >= FREE_SCAN_LIMIT) {
      this.throwUpgradeRequired('scan-limit', quota);
    }
    return quota;
  }

  async assertPro(userId: string): Promise<UserEntity> {
    const user = await this.findUserOrThrow(userId);
    this.normalizeUser(user);
    if (user.planStatus !== 'pro') {
      throw new HttpException(
        {
          message: 'Face scanning requires the Pro plan.',
          reason: 'face-scan-pro-required',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return user;
  }

  async saveExtraction({
    userId,
    extraction,
    mimeType,
    imageBytes,
    provider,
    model,
    inputTokens,
    outputTokens,
    latencyMs,
  }: {
    userId: string;
    extraction: ProductExtraction;
    mimeType: string;
    imageBytes: number;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }) {
    return this.extractions.save(
      this.extractions.create({
        userId,
        extraction,
        mimeType,
        imageBytes,
        provider,
        model,
        inputTokens,
        outputTokens,
        latencyMs,
      }),
    );
  }

  async getExtractionOwned(
    userId: string,
    extractionId: string,
  ): Promise<ProductExtractionEntity> {
    const record = await this.extractions.findOneBy({
      id: extractionId,
      userId,
    });
    if (!record)
      throw new NotFoundException(
        'Product extraction not found for this user.',
      );
    return record;
  }

  async recordProductScan({
    userId,
    productName,
    skinGoal,
    ingredients,
    extractedProductData,
    trustedProductData,
    fullIngredientListVisible,
    analysisResult,
    analysisProvider,
    analysisModel,
    initialMessage,
  }: {
    userId: string;
    productName: string;
    skinGoal: string;
    ingredients: string[];
    extractedProductData?: unknown;
    trustedProductData?: unknown;
    fullIngredientListVisible: boolean;
    analysisResult: AnalyzeScanResponseDto;
    analysisProvider: string;
    analysisModel: string;
    initialMessage: ConversationMessage;
  }): Promise<{ scan: ScanRecordEntity; quota: QuotaStatus }> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found.');
      this.normalizeUser(user);
      if (user.planStatus !== 'pro' && user.freeScansUsed >= FREE_SCAN_LIMIT) {
        this.throwUpgradeRequired('scan-limit', this.buildQuotaStatus(user));
      }
      if (user.planStatus !== 'pro') {
        user.freeScansUsed += 1;
        await manager.save(UserEntity, user);
      }
      const scan = await manager.save(
        ScanRecordEntity,
        manager.create(ScanRecordEntity, {
          userId,
          productName,
          skinGoal,
          ingredients,
          extractedProductData,
          trustedProductData,
          fullIngredientListVisible,
          analysisResult,
          conversation: [initialMessage],
          promptCount: 0,
          analysisProvider,
          analysisModel,
        }),
      );
      return { scan, quota: this.buildQuotaStatus(user, scan) };
    });
  }

  async getProductScanForChat(
    userId: string,
    scanId: string,
  ): Promise<{ user: UserEntity; scan: ScanRecordEntity }> {
    const [user, scan] = await Promise.all([
      this.findUserOrThrow(userId),
      this.scans.findOneBy({ id: scanId, userId }),
    ]);
    if (!scan) throw new NotFoundException('Scan not found for this user.');
    this.normalizeUser(user);
    if (user.planStatus !== 'pro' && scan.promptCount >= FREE_PROMPT_LIMIT) {
      this.throwUpgradeRequired(
        'prompt-limit',
        this.buildQuotaStatus(user, scan),
      );
    }
    return { user, scan };
  }

  async appendProductConversation(
    userId: string,
    scanId: string,
    messages: ConversationMessage[],
  ) {
    return this.dataSource.transaction(async (manager) => {
      const scan = await manager.findOne(ScanRecordEntity, {
        where: { id: scanId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!scan) throw new NotFoundException('Scan not found for this user.');
      scan.conversation = [
        ...this.normalizeConversation(scan.conversation),
        ...messages,
      ];
      scan.promptCount += 1;
      return manager.save(ScanRecordEntity, scan);
    });
  }

  async consumePrompt({
    userId,
    scanId,
    question,
    answer,
  }: {
    userId: string;
    scanId?: string;
    question: string;
    answer: string;
  }): Promise<QuotaStatus> {
    if (!scanId) {
      return this.getQuota(userId);
    }

    const now = new Date().toISOString();
    const messages: ConversationMessage[] = [
      {
        id: randomUUID(),
        role: 'user',
        content: question,
        createdAt: now,
        provider: 'local-fallback',
        model: 'legacy-scan-chat',
        requestType: 'text_chat',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
      {
        id: randomUUID(),
        role: 'assistant',
        content: answer,
        createdAt: now,
        provider: 'local-fallback',
        model: 'legacy-scan-chat',
        requestType: 'text_chat',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    ];

    const scan = await this.appendProductConversation(userId, scanId, messages);
    const user = await this.findUserOrThrow(userId);
    return this.buildQuotaStatus(user, scan);
  }
  async renameProductConversation(userId: string, scanId: string, title: string) {
    const scan = await this.scans.findOneBy({ id: scanId, userId });
    if (!scan) throw new NotFoundException('Scan not found for this user.');
    scan.customTitle = title.trim();
    return this.scans.save(scan);
  }

  async saveProductSummary(userId: string, scanId: string, summary: string) {
    const scan = await this.scans.findOneBy({ id: scanId, userId });
    if (!scan) throw new NotFoundException('Scan not found for this user.');
    scan.conversationSummary = summary;
    await this.scans.save(scan);
  }

  async createFaceScan({
    userId,
    skinGoal,
    observations,
    guidance,
    imageMimeTypes,
    initialMessage,
  }: {
    userId: string;
    skinGoal?: string;
    observations: unknown;
    guidance: unknown;
    imageMimeTypes: string[];
    initialMessage: ConversationMessage;
  }) {
    return this.faceScans.save(
      this.faceScans.create({
        userId,
        skinGoal: skinGoal ?? null,
        observations,
        guidance,
        conversation: [initialMessage],
        promptCount: 0,
        consentAccepted: true,
        imageMimeTypes,
      }),
    );
  }

  async getFaceScanForChat(
    userId: string,
    faceScanId: string,
  ): Promise<{ user: UserEntity; scan: FaceScanRecordEntity }> {
    const user = await this.assertPro(userId);
    const scan = await this.faceScans.findOneBy({ id: faceScanId, userId });
    if (!scan)
      throw new NotFoundException('Face scan not found for this user.');
    return { user, scan };
  }

  async appendFaceConversation(
    userId: string,
    faceScanId: string,
    messages: ConversationMessage[],
  ) {
    return this.dataSource.transaction(async (manager) => {
      const scan = await manager.findOne(FaceScanRecordEntity, {
        where: { id: faceScanId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!scan)
        throw new NotFoundException('Face scan not found for this user.');
      scan.conversation = [
        ...this.normalizeConversation(scan.conversation),
        ...messages,
      ];
      scan.promptCount += 1;
      return manager.save(FaceScanRecordEntity, scan);
    });
  }

  async renameFaceConversation(userId: string, faceScanId: string, title: string) {
    await this.assertPro(userId);
    const scan = await this.faceScans.findOneBy({ id: faceScanId, userId });
    if (!scan)
      throw new NotFoundException('Face scan not found for this user.');
    scan.customTitle = title.trim();
    return this.faceScans.save(scan);
  }

  async saveFaceSummary(userId: string, faceScanId: string, summary: string) {
    const scan = await this.faceScans.findOneBy({ id: faceScanId, userId });
    if (!scan)
      throw new NotFoundException('Face scan not found for this user.');
    scan.conversationSummary = summary;
    await this.faceScans.save(scan);
  }

  async getQuota(userId: string, scanId?: string): Promise<QuotaStatus> {
    const user = await this.findUserOrThrow(userId);
    const scan = scanId
      ? await this.scans.findOneBy({ id: scanId, userId })
      : undefined;
    return this.buildQuotaStatus(user, scan ?? undefined);
  }

  async getScanConversation(userId: string, scanId: string) {
    const scan = await this.scans.findOneBy({ id: scanId, userId });
    if (!scan) throw new NotFoundException('Scan not found for this user.');
    const analysis = this.asObject(scan.analysisResult);
    return {
      id: scan.id,
      productName: scan.productName,
      customTitle: scan.customTitle,
      skinGoal: scan.skinGoal,
      promptCount: scan.promptCount,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
      analysisSummary: analysis?.summary,
      analysisVerdict: analysis?.verdict,
      ingredients: scan.ingredients ?? [],
      analysisResult: scan.analysisResult,
      conversation: this.normalizeConversation(scan.conversation),
      fullIngredientListVisible: scan.fullIngredientListVisible,
    };
  }

  async listUserScans(userId: string) {
    const scans = await this.scans.find({
      where: { userId },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });
    return scans.map((scan) => {
      const analysis = this.asObject(scan.analysisResult);
      return {
        id: scan.id,
        productName: scan.productName,
        customTitle: scan.customTitle,
        skinGoal: scan.skinGoal,
        promptCount: scan.promptCount,
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
        analysisSummary: analysis?.summary,
        analysisVerdict: analysis?.verdict,
      };
    });
  }


  async listUserFaceScans(userId: string) {
    await this.assertPro(userId);
    const scans = await this.faceScans.find({
      where: { userId },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });
    return scans.map((scan) => {
      const guidance = this.asObject(scan.guidance);
      const observations = this.asObject(scan.observations);
      const firstObservation = Array.isArray(observations?.observations)
        ? observations.observations[0]
        : undefined;
      return {
        id: scan.id,
        skinGoal: scan.skinGoal,
        promptCount: scan.promptCount,
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
        title: scan.customTitle || (scan.skinGoal ? `Analyse visage - ${scan.skinGoal}` : 'Analyse visage'),
        customTitle: scan.customTitle,
        summary:
          typeof guidance?.explanation === 'string'
            ? guidance.explanation
            : typeof firstObservation?.description === 'string'
              ? firstObservation.description
              : 'Analyse visage enregistrée.',
      };
    });
  }

  async getFaceScan(userId: string, id: string) {
    await this.assertPro(userId);
    const scan = await this.faceScans.findOneBy({ id, userId });
    if (!scan)
      throw new NotFoundException('Face scan not found for this user.');
    return {
      id: scan.id,
      skinGoal: scan.skinGoal,
      observations: scan.observations,
      guidance: scan.guidance,
      conversation: this.normalizeConversation(scan.conversation),
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    };
  }

  normalizeConversation(value: unknown): ConversationMessage[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ConversationMessage => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<ConversationMessage>;
      return (
        typeof candidate.id === 'string' &&
        (candidate.role === 'assistant' || candidate.role === 'user') &&
        typeof candidate.content === 'string' &&
        typeof candidate.createdAt === 'string'
      );
    });
  }

  private async findUserOrThrow(userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private normalizeUser(user: UserEntity) {
    user.planStatus = user.planStatus ?? 'free';
    user.freeScansUsed = user.freeScansUsed ?? 0;
  }

  private buildQuotaStatus(
    user: UserEntity,
    scan?: Pick<ScanRecordEntity, 'promptCount'>,
  ): QuotaStatus {
    this.normalizeUser(user);
    const isPro = user.planStatus === 'pro';
    const promptCount = scan?.promptCount ?? 0;
    return {
      planStatus: user.planStatus,
      freeScanLimit: FREE_SCAN_LIMIT,
      freeScansUsed: user.freeScansUsed,
      freeScansRemaining: isPro
        ? PRO_REMAINING_ALLOWANCE
        : Math.max(0, FREE_SCAN_LIMIT - user.freeScansUsed),
      freePromptLimit: FREE_PROMPT_LIMIT,
      promptCount,
      promptsRemaining: isPro
        ? PRO_REMAINING_ALLOWANCE
        : Math.max(0, FREE_PROMPT_LIMIT - promptCount),
    };
  }

  private throwUpgradeRequired(
    reason: 'scan-limit' | 'prompt-limit',
    quota: QuotaStatus,
  ): never {
    throw new HttpException(
      {
        message:
          reason === 'scan-limit'
            ? 'Free scan limit reached. Upgrade to continue scanning.'
            : 'Free product question limit reached. Upgrade to continue asking about this scan.',
        reason,
        quota,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}

