import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { AiUsageEventEntity } from './entities/ai-usage-event.entity';
import { FaceScanRecordEntity } from './entities/face-scan-record.entity';
import { ProductExtractionEntity } from './entities/product-extraction.entity';
import { ScanRecordEntity } from './entities/scan-record.entity';
import { UsageService } from './usage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      ScanRecordEntity,
      ProductExtractionEntity,
      FaceScanRecordEntity,
      AiUsageEventEntity,
    ]),
  ],
  providers: [UsageService],
  exports: [UsageService, TypeOrmModule],
})
export class UsageModule {}
