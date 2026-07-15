import { Module } from '@nestjs/common';
import { AiProviderConfigService } from '../../ai/config/ai-provider.config';
import { ImageProcessingService } from './image-processing.service';

@Module({
  providers: [AiProviderConfigService, ImageProcessingService],
  exports: [ImageProcessingService],
})
export class ImageProcessingModule {}
