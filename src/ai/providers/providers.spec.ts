import { z } from 'zod';
import { AiProviderConfigService } from '../config/ai-provider.config';
import { DeepSeekProvider } from './deepseek.provider';
import { GeminiProvider } from './gemini.provider';

const responseSchema = z.object({ answer: z.string() }).strict();

describe('AI providers', () => {
  it('retries one empty Gemini response, validates JSON, and never includes thoughts', async () => {
    const config = {
      geminiApiKey: '',
      geminiTimeoutMs: 2_000,
    } as AiProviderConfigService;
    const generateContent = jest
      .fn()
      .mockResolvedValueOnce({ text: '', usageMetadata: undefined })
      .mockResolvedValueOnce({
        text: JSON.stringify({ answer: 'visible text only' }),
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
      });
    const provider = new GeminiProvider(config);
    Object.defineProperty(provider, 'client', {
      value: { models: { generateContent } },
      configurable: true,
    });

    const result = await provider.generateJson({
      model: 'gemini-test',
      prompt: 'Extract visible text.',
      images: [{ buffer: Buffer.from('image'), mimeType: 'image/png' }],
      schema: responseSchema,
      jsonSchema: { type: 'object' },
      maxOutputTokens: 100,
      requestType: 'product_extraction',
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    const request = generateContent.mock.calls[1][0] as {
      config: { thinkingConfig: { includeThoughts: boolean } };
    };
    expect(request.config.thinkingConfig.includeThoughts).toBe(false);
    expect(result.data.answer).toBe('visible text only');
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(4);
  });

  it('retries one empty DeepSeek response and explicitly disables thinking', async () => {
    const config = {
      deepseekApiKey: '',
      deepseekModel: 'deepseek-test',
      deepseekMaxOutputTokens: 450,
    } as AiProviderConfigService;
    const create = jest
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
      .mockResolvedValueOnce({
        choices: [
          {
            message: { content: JSON.stringify({ answer: 'concise answer' }) },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 7 },
      });
    const provider = new DeepSeekProvider(config);
    Object.defineProperty(provider, 'client', {
      value: { chat: { completions: { create } } },
      configurable: true,
    });

    const result = await provider.generateJson({
      messages: [{ role: 'user', content: 'Question' }],
      schema: responseSchema,
      requestType: 'text_chat',
    });

    expect(create).toHaveBeenCalledTimes(2);
    const request = create.mock.calls[1][0] as {
      model: string;
      extra_body: { thinking: { type: string } };
      max_tokens: number;
    };
    expect(request.model).toBe('deepseek-test');
    expect(request.extra_body.thinking.type).toBe('disabled');
    expect(request.max_tokens).toBe(950);
    expect(result.data.answer).toBe('concise answer');
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(7);
  });
});
