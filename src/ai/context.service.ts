import { Injectable } from '@nestjs/common';
import { AiProviderConfigService } from './config/ai-provider.config';
import { summaryResponseSchema } from './schemas/analysis-response.schema';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { SUMMARY_SYSTEM_PROMPT } from './prompts/summary.prompt';
import { ConversationMessage, ProviderResult } from './types/ai.types';

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class ContextService {
  constructor(
    private readonly config: AiProviderConfigService,
    private readonly deepseek: DeepSeekProvider,
  ) {}

  buildContext({
    systemPrompt,
    trustedContext,
    conversationSummary,
    conversation,
    currentMessage,
    visualContext,
  }: {
    systemPrompt: string;
    trustedContext: unknown;
    conversationSummary?: string | null;
    conversation: ConversationMessage[];
    currentMessage: string;
    visualContext?: unknown;
  }): ModelMessage[] {
    const recent = conversation.slice(-this.config.contextMessageLimit);
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'system',
        content: `Trusted saved context:\n${this.formatContext(trustedContext)}`,
      },
    ];

    if (conversationSummary?.trim()) {
      messages.push({
        role: 'system',
        content: `Saved conversation summary:\n${conversationSummary.trim()}`,
      });
    }

    for (const message of recent) {
      messages.push({ role: message.role, content: message.content });
    }

    if (visualContext) {
      messages.push({
        role: 'system',
        content:
          'The current user message includes an image attachment. Answer the image-related question from the Gemini visual observations below first. Use saved scan facts only as secondary context, and say clearly if the image does not show enough detail.',
      });
      messages.push({
        role: 'system',
        content: `Visual observations previously extracted by Gemini:\n${this.formatContext(visualContext)}`,
      });
    }

    messages.push({ role: 'user', content: currentMessage });
    return messages;
  }

  private formatContext(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  async summarizeOlderMessages(
    conversation: ConversationMessage[],
    existingSummary?: string | null,
  ): Promise<ProviderResult<{ summary: string }> | null> {
    if (conversation.length <= this.config.summarizeAfterMessages) return null;
    const older = conversation.slice(0, -this.config.contextMessageLimit);
    if (!older.length) return null;

    return this.deepseek.generateJson({
      requestType: 'summary',
      schema: summaryResponseSchema,
      maxOutputTokens: Math.min(350, this.config.deepseekMaxOutputTokens),
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            existingSummary: existingSummary ?? null,
            olderMessages: older.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        },
      ],
    });
  }
}
