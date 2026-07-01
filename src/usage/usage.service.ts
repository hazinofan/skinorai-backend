import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AnalyzeScanRequestDto } from '../ai/dto/analyze-scan-request.dto';
import { AnalyzeScanResponseDto } from '../ai/dto/analyze-scan-response.dto';
import { UserEntity } from '../auth/entities/user.entity';
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

export type ScanConversationListItem = {
  id: string;
  productName: string;
  skinGoal?: string;
  promptCount: number;
  createdAt: Date;
  updatedAt: Date;
  analysisSummary?: string;
  analysisVerdict?: string;
};

export type ScanConversationMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: string;
};

export type ScanConversationDetail = ScanConversationListItem & {
  ingredients: string[];
  analysisResult: unknown;
  conversation: ScanConversationMessage[];
};

const FREE_SCAN_LIMIT = 3;
const FREE_PROMPT_LIMIT = 1;
const PRO_REMAINING_ALLOWANCE = 999_999;

@Injectable()
export class UsageService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ScanRecordEntity)
    private readonly scanRecordsRepository: Repository<ScanRecordEntity>,
  ) {}

  async assertCanAnalyze(userId: string): Promise<QuotaStatus> {
    const user = await this.findUserOrThrow(userId);
    this.normalizeUserQuotaFields(user);
    const quota = this.buildQuotaStatus(user);

    if (user.planStatus !== 'pro' && user.freeScansUsed >= FREE_SCAN_LIMIT) {
      this.throwUpgradeRequired('scan-limit', quota);
    }

    return quota;
  }

  async recordScan({
    userId,
    request,
    analysisResult,
  }: {
    userId: string;
    request: AnalyzeScanRequestDto;
    analysisResult: AnalyzeScanResponseDto;
  }): Promise<{ scanId: string; quota: QuotaStatus }> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      this.normalizeUserQuotaFields(user);

      if (user.planStatus !== 'pro' && user.freeScansUsed >= FREE_SCAN_LIMIT) {
        this.throwUpgradeRequired('scan-limit', this.buildQuotaStatus(user));
      }

      if (user.planStatus !== 'pro') {
        user.freeScansUsed += 1;
        await manager.save(UserEntity, user);
      }

      const scanRecord = manager.create(ScanRecordEntity, {
        userId,
        productName: request.productName?.trim() || 'Produit analyse',
        skinGoal: request.skinGoal,
        ingredients: request.ingredients ?? [],
        analysisResult,
        conversation: [
          this.buildAssistantMessage(
            this.buildInitialAnalysisMessage({
              productName: request.productName?.trim() || 'Produit analyse',
              analysisResult,
            }),
          ),
        ],
        promptCount: 0,
      });
      const savedScan = await manager.save(ScanRecordEntity, scanRecord);

      return {
        scanId: savedScan.id,
        quota: this.buildQuotaStatus(user, savedScan),
      };
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
      throw new BadRequestException('scanId is required to ask about a product.');
    }

    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      this.normalizeUserQuotaFields(user);

      const scanRecord = await manager.findOne(ScanRecordEntity, {
        where: { id: scanId, userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!scanRecord) {
        throw new NotFoundException('Scan not found for this user.');
      }

      if (user.planStatus !== 'pro' && scanRecord.promptCount >= FREE_PROMPT_LIMIT) {
        this.throwUpgradeRequired(
          'prompt-limit',
          this.buildQuotaStatus(user, scanRecord),
        );
      }

      scanRecord.promptCount += 1;
      const existingConversation = this.normalizeConversation(scanRecord.conversation);
      scanRecord.conversation = [
        ...existingConversation,
        this.buildUserMessage(question),
        this.buildAssistantMessage(answer),
      ];
      const savedScan = await manager.save(ScanRecordEntity, scanRecord);

      return this.buildQuotaStatus(user, savedScan);
    });
  }

  async getQuota(userId: string, scanId?: string): Promise<QuotaStatus> {
    const user = await this.findUserOrThrow(userId);
    const scanRecord = scanId
      ? await this.scanRecordsRepository.findOneBy({ id: scanId, userId })
      : undefined;

    return this.buildQuotaStatus(user, scanRecord ?? undefined);
  }

  async getScanConversation(
    userId: string,
    scanId: string,
  ): Promise<ScanConversationDetail> {
    const scanRecord = await this.scanRecordsRepository.findOneBy({ id: scanId, userId });

    if (!scanRecord) {
      throw new NotFoundException('Scan not found for this user.');
    }

    const analysis =
      scanRecord.analysisResult &&
      typeof scanRecord.analysisResult === 'object' &&
      !Array.isArray(scanRecord.analysisResult)
        ? (scanRecord.analysisResult as {
            summary?: string;
            verdict?: string;
          })
        : undefined;

    return {
      id: scanRecord.id,
      productName: scanRecord.productName,
      skinGoal: scanRecord.skinGoal,
      promptCount: scanRecord.promptCount,
      createdAt: scanRecord.createdAt,
      updatedAt: scanRecord.updatedAt,
      analysisSummary: analysis?.summary,
      analysisVerdict: analysis?.verdict,
      ingredients: scanRecord.ingredients ?? [],
      analysisResult: scanRecord.analysisResult,
      conversation: this.normalizeConversation(scanRecord.conversation),
    };
  }

  async listUserScans(userId: string): Promise<ScanConversationListItem[]> {
    const scanRecords = await this.scanRecordsRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });

    return scanRecords.map((scanRecord) => {
      const analysis =
        scanRecord.analysisResult &&
        typeof scanRecord.analysisResult === 'object' &&
        !Array.isArray(scanRecord.analysisResult)
          ? (scanRecord.analysisResult as {
              summary?: string;
              verdict?: string;
            })
          : undefined;

      return {
        id: scanRecord.id,
        productName: scanRecord.productName,
        skinGoal: scanRecord.skinGoal,
        promptCount: scanRecord.promptCount,
        createdAt: scanRecord.createdAt,
        updatedAt: scanRecord.updatedAt,
        analysisSummary: analysis?.summary,
        analysisVerdict: analysis?.verdict,
      };
    });
  }

  private async findUserOrThrow(userId: string): Promise<UserEntity> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  private normalizeConversation(value: unknown): ScanConversationMessage[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ScanConversationMessage => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const candidate = item as Partial<ScanConversationMessage>;
      return (
        typeof candidate.id === 'string' &&
        (candidate.role === 'assistant' || candidate.role === 'user') &&
        typeof candidate.content === 'string' &&
        typeof candidate.createdAt === 'string'
      );
    });
  }

  private buildMessage(
    role: 'assistant' | 'user',
    content: string,
  ): ScanConversationMessage {
    return {
      id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }

  private buildAssistantMessage(content: string): ScanConversationMessage {
    return this.buildMessage('assistant', content);
  }

  private buildUserMessage(content: string): ScanConversationMessage {
    return this.buildMessage('user', content);
  }

  private buildInitialAnalysisMessage({
    productName,
    analysisResult,
  }: {
    productName: string;
    analysisResult: AnalyzeScanResponseDto;
  }): string {
    const positives = analysisResult.positives
      .slice(0, 3)
      .map((item) => item.ingredient)
      .filter(Boolean);
    const watchouts = analysisResult.watchouts
      .slice(0, 3)
      .map((item) => item.ingredient)
      .filter(Boolean);

    return [
      `${productName}: ${analysisResult.summary}`,
      positives.length ? `Points forts: ${positives.join(', ')}.` : null,
      watchouts.length ? `A surveiller: ${watchouts.join(', ')}.` : null,
      analysisResult.nextStep ? `Prochaine etape: ${analysisResult.nextStep}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private normalizeUserQuotaFields(user: UserEntity): void {
    user.planStatus = user.planStatus ?? 'free';
    user.freeScansUsed = user.freeScansUsed ?? 0;
  }

  private buildQuotaStatus(
    user: UserEntity,
    scanRecord?: Pick<ScanRecordEntity, 'promptCount'>,
  ): QuotaStatus {
    const freeScansUsed = user.freeScansUsed ?? 0;
    const promptCount = scanRecord?.promptCount ?? 0;
    const isPro = user.planStatus === 'pro';

    return {
      planStatus: user.planStatus ?? 'free',
      freeScanLimit: FREE_SCAN_LIMIT,
      freeScansUsed,
      freeScansRemaining: isPro
        ? PRO_REMAINING_ALLOWANCE
        : Math.max(0, FREE_SCAN_LIMIT - freeScansUsed),
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
}


