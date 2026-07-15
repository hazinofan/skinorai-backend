import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { UsageModule } from '../usage/usage.module';
import { ScansController } from './scans.controller';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [ScansController],
})
export class ScansModule {}
