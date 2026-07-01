import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { ScanRecordEntity } from './entities/scan-record.entity';
import { UsageService } from './usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ScanRecordEntity])],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
