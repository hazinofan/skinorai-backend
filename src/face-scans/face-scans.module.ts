import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { UsageModule } from '../usage/usage.module';
import { FaceScansController } from './face-scans.controller';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [FaceScansController],
})
export class FaceScansModule {}
