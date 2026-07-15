import { randomUUID } from 'crypto';
import {
  ConversationAttachment,
  ConversationMessage,
  LibrarySuggestion,
  ProviderResult,
  AiRequestType,
} from './types/ai.types';

export function buildConversationMessage({
  role,
  content,
  result,
  requestType,
  attachment,
  visualContext,
  librarySuggestions,
}: {
  role: 'user' | 'assistant';
  content: string;
  result?: Pick<ProviderResult<unknown>, 'provider' | 'model' | 'usage'>;
  requestType: AiRequestType;
  attachment?: ConversationAttachment;
  visualContext?: Record<string, unknown>;
  librarySuggestions?: LibrarySuggestion;
}): ConversationMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    provider: result?.provider ?? 'local-fallback',
    model: result?.model ?? 'none',
    requestType,
    attachment,
    visualContext,
    librarySuggestions,
    inputTokens: result?.usage.inputTokens ?? 0,
    outputTokens: result?.usage.outputTokens ?? 0,
    latencyMs: result?.usage.latencyMs ?? 0,
  };
}
