import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsageService } from '../usage/usage.service';
import { AnalyzeScanDto } from './dto/analyze-scan.dto';
import { ChatScanDto } from './dto/chat-scan.dto';
import { ScanService } from './scan.service';

type AuthenticatedRequest = Request & { user: JwtUser };

@Controller('scan')
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly usageService: UsageService,
  ) {}

  @Post('analyze')
  analyzeScan(@Body() analyzeScanDto: AnalyzeScanDto) {
    return this.scanService.analyzeScan(analyzeScanDto);
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  async answerQuestion(
    @Body() chatScanDto: ChatScanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const response = this.scanService.answerQuestion(chatScanDto);
    const quota = await this.usageService.consumePrompt({
      userId: request.user.sub,
      scanId: chatScanDto.scanId,
      question: chatScanDto.question?.trim() || 'Question sur ce produit',
      answer: response.answer,
    });

    return { ...response, quota };
  }
}

