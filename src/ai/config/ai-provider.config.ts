import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiProviderConfigService {
  constructor(private readonly config: ConfigService) {}

  get geminiApiKey() {
    return this.config.get<string>('GEMINI_API_KEY')?.trim() || '';
  }
  get geminiProductModel() {
    return (
      this.config.get<string>('GEMINI_PRODUCT_MODEL') || 'gemini-3.1-flash-lite'
    );
  }
  get geminiFaceModel() {
    return this.config.get<string>('GEMINI_FACE_MODEL') || 'gemini-3.5-flash';
  }
  get geminiProductMaxOutputTokens() {
    return this.number('GEMINI_PRODUCT_MAX_OUTPUT_TOKENS', 500);
  }
  get geminiFaceMaxOutputTokens() {
    return this.number('GEMINI_FACE_MAX_OUTPUT_TOKENS', 800);
  }
  get deepseekApiKey() {
    return this.config.get<string>('DEEPSEEK_API_KEY')?.trim() || '';
  }
  get deepseekBaseUrl() {
    return (
      this.config.get<string>('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com'
    );
  }
  get deepseekModel() {
    return this.config.get<string>('DEEPSEEK_MODEL') || 'deepseek-v4-flash';
  }
  get deepseekMaxOutputTokens() {
    return this.number('DEEPSEEK_MAX_OUTPUT_TOKENS', 450);
  }
  get deepseekTimeoutMs() {
    return this.number('DEEPSEEK_TIMEOUT_MS', 20_000);
  }
  get geminiTimeoutMs() {
    return this.number('GEMINI_TIMEOUT_MS', 20_000);
  }
  get contextMessageLimit() {
    return this.number('CHAT_CONTEXT_MESSAGE_LIMIT', 8);
  }
  get summarizeAfterMessages() {
    return this.number('CHAT_SUMMARY_AFTER_MESSAGES', 12);
  }
  get proChatDailyLimit() {
    return this.number('PRO_CHAT_DAILY_LIMIT', 100);
  }
  get faceScanDailyLimit() {
    return this.number('FACE_SCAN_DAILY_LIMIT', 5);
  }
  get maxImageSizeMb() {
    return this.number('MAX_IMAGE_SIZE_MB', 8);
  }
  get maxImageLongEdge() {
    return this.number('MAX_IMAGE_LONG_EDGE', 1600);
  }
  get visionFallbackEnabled() {
    return this.boolean('ENABLE_VISION_FALLBACK', false);
  }

  inputPrice(provider: 'gemini-product' | 'gemini-face' | 'deepseek') {
    const keys = {
      'gemini-product': 'GEMINI_PRODUCT_INPUT_USD_PER_1M_TOKENS',
      'gemini-face': 'GEMINI_FACE_INPUT_USD_PER_1M_TOKENS',
      deepseek: 'DEEPSEEK_INPUT_USD_PER_1M_TOKENS',
    } as const;
    return this.number(keys[provider], 0);
  }

  outputPrice(provider: 'gemini-product' | 'gemini-face' | 'deepseek') {
    const keys = {
      'gemini-product': 'GEMINI_PRODUCT_OUTPUT_USD_PER_1M_TOKENS',
      'gemini-face': 'GEMINI_FACE_OUTPUT_USD_PER_1M_TOKENS',
      deepseek: 'DEEPSEEK_OUTPUT_USD_PER_1M_TOKENS',
    } as const;
    return this.number(keys[provider], 0);
  }

  private number(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private boolean(key: string, fallback: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value == null) return fallback;
    return value.toLowerCase() === 'true';
  }
}
