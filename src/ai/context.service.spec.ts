import { ContextService } from './context.service';
import { AiProviderConfigService } from './config/ai-provider.config';
import { DeepSeekProvider } from './providers/deepseek.provider';
import type { ConversationMessage } from './types/ai.types';

function message(index: number): ConversationMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `content-${index}`,
    createdAt: new Date(2026, 0, index + 1).toISOString(),
    provider: index % 2 === 0 ? 'gemini' : 'deepseek',
    model: 'test-model',
    requestType: 'text_chat',
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  };
}

describe('ContextService', () => {
  function createService() {
    const config = {
      contextMessageLimit: 8,
      summarizeAfterMessages: 12,
      deepseekMaxOutputTokens: 450,
    } as AiProviderConfigService;
    const deepseek = { generateJson: jest.fn() } as unknown as DeepSeekProvider;
    return { service: new ContextService(config, deepseek), deepseek };
  }

  it('builds context from system safety, trusted context, summary, only the latest 8 messages, visual context, and current message', () => {
    const { service } = createService();
    const conversation = Array.from({ length: 14 }, (_, index) =>
      message(index),
    );

    const result = service.buildContext({
      systemPrompt: 'Safety prompt',
      trustedContext: { productName: 'Trusted Serum' },
      conversationSummary: 'Older context summary',
      conversation,
      currentMessage: 'Current question',
      visualContext: { imageType: 'product_label' },
    });

    expect(result[0]).toEqual({ role: 'system', content: 'Safety prompt' });
    expect(result[1].content).toContain('Trusted Serum');
    expect(result[2].content).toContain('Older context summary');
    expect(result.some((item) => item.content === 'content-5')).toBe(false);
    expect(result.some((item) => item.content === 'content-6')).toBe(true);
    expect(result.some((item) => item.content === 'content-13')).toBe(true);
    expect(result.at(-2)?.content).toContain(
      'Visual observations previously extracted by Gemini',
    );
    expect(result.at(-1)).toEqual({
      role: 'user',
      content: 'Current question',
    });
  });

  it('summarizes older messages only after the configured threshold', async () => {
    const { service, deepseek } = createService();
    (deepseek.generateJson as jest.Mock).mockResolvedValue({
      data: { summary: 'Saved summary' },
      provider: 'deepseek',
      model: 'deepseek-test',
      usage: { inputTokens: 20, outputTokens: 5, latencyMs: 10 },
    });

    await expect(
      service.summarizeOlderMessages(
        Array.from({ length: 12 }, (_, index) => message(index)),
      ),
    ).resolves.toBeNull();

    const result = await service.summarizeOlderMessages(
      Array.from({ length: 14 }, (_, index) => message(index)),
      'Existing summary',
    );

    expect(result?.data.summary).toBe('Saved summary');
    const call = (deepseek.generateJson as jest.Mock).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(call.messages[1].content) as {
      existingSummary: string;
      olderMessages: ConversationMessage[];
    };
    expect(payload.existingSummary).toBe('Existing summary');
    expect(payload.olderMessages).toHaveLength(6);
    expect(payload.olderMessages.at(-1)?.content).toBe('content-5');
  });
});
