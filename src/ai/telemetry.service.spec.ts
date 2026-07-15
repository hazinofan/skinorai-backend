import { HttpException } from '@nestjs/common';
import { AiTelemetryService } from './telemetry.service';
import { AiProviderConfigService } from './config/ai-provider.config';
import { AiUsageEventEntity } from '../usage/entities/ai-usage-event.entity';
import type { Repository } from 'typeorm';

function queryBuilderReturning(count: number) {
  const builder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    getCount: jest.fn().mockResolvedValue(count),
  };
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  return builder;
}

describe('AiTelemetryService', () => {
  function createService() {
    const repository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<AiUsageEventEntity>;
    const config = {
      proChatDailyLimit: 100,
      faceScanDailyLimit: 5,
      inputPrice: jest.fn((key: string) => (key === 'deepseek' ? 0.2 : 0.1)),
      outputPrice: jest.fn((key: string) => (key === 'deepseek' ? 0.4 : 0.3)),
    } as unknown as AiProviderConfigService;
    return {
      service: new AiTelemetryService(repository, config),
      repository,
      config,
    };
  }

  it('records token counts, latency, success and an environment-priced cost event', async () => {
    const { service, repository } = createService();

    await service.record({
      userId: 'user-1',
      scanId: 'scan-1',
      provider: 'deepseek',
      model: 'deepseek-test',
      requestType: 'text_chat',
      usage: { inputTokens: 1_000_000, outputTokens: 500_000, latencyMs: 321 },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        scanId: 'scan-1',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        latencyMs: 321,
        success: true,
        estimatedCostUsd: '0.40000000',
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('counts only final DeepSeek chat responses for request rate limiting', async () => {
    const { service, repository } = createService();
    const minuteBuilder = queryBuilderReturning(9);
    const dayBuilder = queryBuilderReturning(99);
    (repository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(minuteBuilder)
      .mockReturnValueOnce(dayBuilder);

    await expect(
      service.assertChatRateLimit('user-1', true),
    ).resolves.toBeUndefined();

    expect(minuteBuilder.andWhere).toHaveBeenCalledWith(
      'event.provider = :provider',
      { provider: 'deepseek' },
    );
    expect(dayBuilder.andWhere).toHaveBeenCalledWith(
      'event.provider = :provider',
      { provider: 'deepseek' },
    );
  });

  it('returns HTTP 429 when the ten-per-minute chat limit is reached', async () => {
    const { service, repository } = createService();
    (repository.createQueryBuilder as jest.Mock).mockReturnValue(
      queryBuilderReturning(10),
    );

    let thrown: unknown;
    try {
      await service.assertChatRateLimit('user-1', false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
    expect((thrown as HttpException).getResponse()).toEqual(
      expect.objectContaining({ reason: 'chat-minute-limit' }),
    );
  });

  it('counts one successful Gemini observation per face scan for the daily limit', async () => {
    const { service, repository } = createService();
    const builder = queryBuilderReturning(4);
    (repository.createQueryBuilder as jest.Mock).mockReturnValue(builder);

    await expect(
      service.assertFaceScanRateLimit('user-1'),
    ).resolves.toBeUndefined();
    expect(builder.andWhere).toHaveBeenCalledWith(
      'event.provider = :provider',
      { provider: 'gemini' },
    );
  });
});
