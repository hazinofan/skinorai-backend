import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiProviderConfigService } from './config/ai-provider.config';
import { AiUsageEventEntity } from '../usage/entities/ai-usage-event.entity';
import {
  AiProviderName,
  AiRequestType,
  AiUsageMetadata,
} from './types/ai.types';

@Injectable()
export class AiTelemetryService {
  constructor(
    @InjectRepository(AiUsageEventEntity)
    private readonly events: Repository<AiUsageEventEntity>,
    private readonly config: AiProviderConfigService,
  ) {}

  async assertChatRateLimit(userId: string, isPro: boolean): Promise<void> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const minuteCount = await this.events
      .createQueryBuilder('event')
      .where('event.user_id = :userId', { userId })
      .andWhere('event.success = :success', { success: true })
      .andWhere('event.created_at >= :oneMinuteAgo', { oneMinuteAgo })
      .andWhere('event.request_type IN (:...types)', {
        types: ['text_chat', 'product_image_chat', 'face_chat'],
      })
      .andWhere('event.provider = :provider', { provider: 'deepseek' })
      .getCount();
    if (minuteCount >= 10)
      this.throwRateLimit(
        'chat-minute-limit',
        'Maximum 10 AI requests per minute.',
      );

    if (isPro) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const rows = await this.events
        .createQueryBuilder('event')
        .where('event.user_id = :userId', { userId })
        .andWhere('event.success = :success', { success: true })
        .andWhere('event.created_at >= :start', { start })
        .andWhere('event.request_type IN (:...types)', {
          types: ['text_chat', 'product_image_chat', 'face_chat'],
        })
        .andWhere('event.provider = :provider', { provider: 'deepseek' })
        .getCount();
      if (rows >= this.config.proChatDailyLimit)
        this.throwRateLimit(
          'pro-chat-daily-limit',
          'Daily Pro chat limit reached.',
        );
    }
  }

  async assertFaceScanRateLimit(userId: string): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const count = await this.events
      .createQueryBuilder('event')
      .where('event.user_id = :userId', { userId })
      .andWhere('event.success = :success', { success: true })
      .andWhere('event.created_at >= :start', { start })
      .andWhere('event.request_type = :requestType', {
        requestType: 'face_scan',
      })
      .andWhere('event.provider = :provider', { provider: 'gemini' })
      .getCount();
    if (count >= this.config.faceScanDailyLimit)
      this.throwRateLimit(
        'face-scan-daily-limit',
        'Daily face scan limit reached.',
      );
  }

  async record({
    userId,
    scanId,
    faceScanId,
    provider,
    model,
    requestType,
    usage,
    success = true,
    errorCode,
  }: {
    userId: string;
    scanId?: string | null;
    faceScanId?: string | null;
    provider: AiProviderName;
    model: string;
    requestType: AiRequestType;
    usage: AiUsageMetadata;
    success?: boolean;
    errorCode?: string | null;
  }): Promise<void> {
    const priceKey =
      provider === 'deepseek'
        ? 'deepseek'
        : requestType === 'face_scan' || requestType === 'face_chat'
          ? 'gemini-face'
          : 'gemini-product';
    const estimated =
      (usage.inputTokens * this.config.inputPrice(priceKey) +
        usage.outputTokens * this.config.outputPrice(priceKey)) /
      1_000_000;
    await this.events.save(
      this.events.create({
        userId,
        scanId,
        faceScanId,
        provider,
        model,
        requestType,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostUsd: estimated.toFixed(8),
        latencyMs: usage.latencyMs,
        success,
        errorCode: errorCode ?? null,
      }),
    );
  }

  private throwRateLimit(reason: string, message: string): never {
    throw new HttpException({ message, reason }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
