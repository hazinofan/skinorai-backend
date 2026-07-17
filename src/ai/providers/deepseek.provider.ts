import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import { AiProviderConfigService } from '../config/ai-provider.config';
import { ProviderResult } from '../types/ai.types';
import { AiProviderError } from './provider-error';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class DeepSeekProvider {
  private readonly logger = new Logger(DeepSeekProvider.name);
  private readonly client?: OpenAI;

  constructor(private readonly config: AiProviderConfigService) {
    if (this.config.deepseekApiKey) {
      this.client = new OpenAI({
        apiKey: this.config.deepseekApiKey,
        baseURL: this.config.deepseekBaseUrl,
        timeout: this.config.deepseekTimeoutMs,
        maxRetries: 0,
      });
    }
  }

  async generateJson<T>({
    messages,
    schema,
    requestType,
    maxOutputTokens,
  }: {
    messages: Message[];
    schema: z.ZodType<T>;
    requestType: string;
    maxOutputTokens?: number;
  }): Promise<ProviderResult<T>> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        message: 'AI analysis provider is temporarily unavailable.',
        code: 'deepseek-not-configured',
      });
    }

    const startedAt = Date.now();
    const tokenBudget = maxOutputTokens ?? this.config.deepseekMaxOutputTokens;
    const generated = await this.withRetry(
      async (attempt) => {
        const completion = await this.client!.chat.completions.create({
          model: this.config.deepseekModel,
          messages: attempt === 0 ? messages : this.repairMessages(messages, requestType),
          temperature: attempt === 0 ? 0.2 : 0,
          max_tokens: attempt === 0 ? tokenBudget : Math.min(Math.max(tokenBudget * 2, tokenBudget + 500), 2_000),
          response_format: { type: 'json_object' },
          // DeepSeek-compatible non-thinking mode. Kept in extra_body so models can be swapped by env.
          extra_body: { thinking: { type: 'disabled' } },
        } as never);

        const finishReason = completion.choices[0]?.finish_reason;
        const text = completion.choices[0]?.message?.content?.trim();
        if (!text) {
          this.logger.warn(
            JSON.stringify({
              provider: 'deepseek',
              requestType,
              model: this.config.deepseekModel,
              success: false,
              code: finishReason === 'length' ? 'output-token-budget-exhausted' : 'empty-response',
              attempt: attempt + 1,
              finishReason,
              usage: completion.usage ?? null,
            }),
          );
          throw new AiProviderError(
            'DeepSeek returned an empty response.',
            finishReason === 'length' ? 'output-token-budget-exhausted' : 'empty-response',
            true,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new AiProviderError(
            'DeepSeek returned invalid JSON.',
            'invalid-json',
            true,
          );
        }

        const validated = schema.safeParse(parsed);
        if (!validated.success) {
          this.logger.warn(
            JSON.stringify({
              provider: 'deepseek',
              requestType,
              success: false,
              code: 'schema-validation',
              issues: validated.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                code: issue.code,
                message: issue.message,
              })),
            }),
          );
          throw new AiProviderError(
            'DeepSeek response failed validation.',
            'schema-validation',
            true,
          );
        }

        return { data: validated.data, usage: completion.usage };
      },
      requestType,
    );
    const result: ProviderResult<T> = {
      data: generated.data,
      provider: 'deepseek',
      model: this.config.deepseekModel,
      usage: {
        inputTokens: generated.usage?.prompt_tokens ?? 0,
        outputTokens: generated.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      },
    };

    this.logger.log(
      JSON.stringify({
        provider: 'deepseek',
        requestType,
        model: result.model,
        latencyMs: result.usage.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        success: true,
      }),
    );
    return result;
  }

  private async withRetry<T>(
    operation: (attempt: number) => Promise<T>,
    requestType: string,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && this.isRetryable(error)) continue;
        break;
      }
    }
    this.logger.warn(
      JSON.stringify({
        provider: 'deepseek',
        requestType,
        model: this.config.deepseekModel,
        success: false,
        code: this.errorCode(lastError),
      }),
    );
    if (lastError instanceof ServiceUnavailableException) throw lastError;
    throw new AiProviderError(
      'AI analysis provider request failed.',
      this.errorCode(lastError),
      false,
    );
  }

  private repairMessages(messages: Message[], requestType: string): Message[] {
    return [
      ...messages,
      {
        role: 'system',
        content: this.repairInstruction(requestType),
      },
    ];
  }

  private repairInstruction(requestType: string) {
    if (requestType === 'face_scan') {
      return 'The previous provider response was empty or invalid. Return exactly one compact JSON object now with these keys: {"explanation":"...","priorities":["..."],"routineCategories":[{"step":"...","guidance":"..."}],"potentiallyUsefulIngredients":["..."],"introduceCautiously":["..."],"followUpQuestions":["..."],"disclaimer":"..."}. Keep each array short. Do not return markdown, thoughts, or an empty response.';
    }

    if (requestType === 'product_analysis') {
      return 'The previous provider response was empty or invalid. Return exactly one compact JSON object now with the product analysis keys requested by the original system prompt. Do not return markdown, thoughts, or an empty response.';
    }

    if (requestType === 'summary') {
      return 'The previous provider response was empty or invalid. Return exactly one compact JSON object now: {"summary":"..."}. Do not return markdown, thoughts, or an empty response.';
    }

    return 'The previous provider response was empty or invalid. Return exactly one compact JSON object now: {"answer":"...","suggestions":["..."]}. Do not return markdown, thoughts, or an empty response.';
  }
  private isRetryable(error: unknown) {
    if (error instanceof AiProviderError) return error.retryable;
    const status = (error as { status?: number })?.status;
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const name = error instanceof Error ? error.name.toLowerCase() : '';
    return (
      status === 429 ||
      (typeof status === 'number' && status >= 500) ||
      message.includes('timeout') ||
      message.includes('connection') ||
      name.includes('timeout') ||
      name.includes('connection')
    );
  }

  private errorCode(error: unknown) {
    if (error instanceof AiProviderError) return error.code;
    const status = (error as { status?: number })?.status;
    if (status) return `http-${status}`;
    const name = error instanceof Error ? error.name.toLowerCase() : '';
    return name.includes('timeout') ? 'timeout' : 'provider-error';
  }
}
