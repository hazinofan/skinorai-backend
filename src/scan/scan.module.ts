import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { UsageModule } from '../usage/usage.module';
import { ScanService } from './scan.service';

@Module({
  imports: [UsageModule],
  controllers: [ScanController],
  providers: [ScanService],
})
export class ScanModule {}
