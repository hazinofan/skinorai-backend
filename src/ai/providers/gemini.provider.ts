import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { AiProviderConfigService } from '../config/ai-provider.config';
import { ProviderResult } from '../types/ai.types';
import { AiProviderError } from './provider-error';

export type GeminiImageInput = { buffer: Buffer; mimeType: string };

@Injectable()
export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client?: GoogleGenAI;

  constructor(private readonly config: AiProviderConfigService) {
    if (this.config.geminiApiKey) {
      this.client = new GoogleGenAI({ apiKey: this.config.geminiApiKey });
    }
  }

  async generateJson<T>({
    model,
    prompt,
    images,
    schema,
    jsonSchema,
    maxOutputTokens,
    requestType,
  }: {
    model: string;
    prompt: string;
    images: GeminiImageInput[];
    schema: z.ZodType<T>;
    jsonSchema: unknown;
    maxOutputTokens: number;
    requestType: string;
  }): Promise<ProviderResult<T>> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        message: 'Visual analysis provider is temporarily unavailable.',
        code: 'gemini-not-configured',
      });
    }

    const startedAt = Date.now();
    const generated = await this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.geminiTimeoutMs,
      );
      try {
        const response = await this.client!.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                ...images.map((image) => ({
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.buffer.toString('base64'),
                  },
                })),
              ],
            },
          ],
          config: {
            abortSignal: controller.signal,
            temperature: 0.1,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
            thinkingConfig: {
              includeThoughts: false,
              thinkingLevel: ThinkingLevel.MINIMAL,
            },
          },
        });

        const text = response.text?.trim();
        if (!text) {
          throw new AiProviderError(
            'Gemini returned an empty response.',
            'empty-response',
            true,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new AiProviderError(
            'Gemini returned invalid JSON.',
            'invalid-json',
            true,
          );
        }

        const validated = schema.safeParse(parsed);
        if (!validated.success) {
          throw new AiProviderError(
            'Gemini response failed validation.',
            'schema-validation',
            true,
          );
        }

        return { data: validated.data, usageMetadata: response.usageMetadata };
      } finally {
        clearTimeout(timeout);
      }
    });

    const result: ProviderResult<T> = {
      data: generated.data,
      provider: 'gemini',
      model,
      usage: {
        inputTokens: generated.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: generated.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - startedAt,
      },
    };

    this.logger.log(
      JSON.stringify({
        provider: 'gemini',
        requestType,
        model,
        imageBytes: images.reduce(
          (sum, image) => sum + image.buffer.byteLength,
          0,
        ),
        latencyMs: result.usage.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        success: true,
      }),
    );

    return result;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === 0 && this.isRetryable(error)) continue;
        break;
      }
    }

    this.logger.warn(
      JSON.stringify({
        provider: 'gemini',
        success: false,
        code: this.errorCode(lastError),
      }),
    );
    if (lastError instanceof ServiceUnavailableException) throw lastError;
    throw new AiProviderError(
      'Visual analysis provider request failed.',
      this.errorCode(lastError),
      false,
    );
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
      message.includes('abort') ||
      name.includes('timeout') ||
      name.includes('abort')
    );
  }

  private errorCode(error: unknown) {
    if (error instanceof AiProviderError) return error.code;
    if (error instanceof Error && error.name === 'AbortError') return 'timeout';
    const status = (error as { status?: number })?.status;
    return status ? `http-${status}` : 'provider-error';
  }
}
