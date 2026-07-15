import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OcrModule } from '../ocr/ocr.module';
import { UsageModule } from '../usage/usage.module';
import { ImageProcessingModule } from '../common/images/image-processing.module';
import { AiProviderConfigService } from './config/ai-provider.config';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { AnalysisService } from './analysis.service';
import { ChatService } from './chat.service';
import { ContextService } from './context.service';
import { AiTelemetryService } from './telemetry.service';

@Module({
  imports: [ProductsModule, OcrModule, UsageModule, ImageProcessingModule],
  providers: [
    AiProviderConfigService,
    GeminiProvider,
    DeepSeekProvider,
    AnalysisService,
    ChatService,
    ContextService,
    AiTelemetryService,
  ],
  exports: [AnalysisService, ChatService, ContextService],
})
export class AiModule {}
