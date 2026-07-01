import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { AiService } from '../ai/ai.service';
import { AnalyzeScanRequestDto } from '../ai/dto/analyze-scan-request.dto';
import { AnalyzeScanResponseDto } from '../ai/dto/analyze-scan-response.dto';
import type { JwtUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExtractIngredientsResponseDto } from '../ocr/dto/extract-ingredients-response.dto';
import { OcrService } from '../ocr/ocr.service';
import { UsageService } from '../usage/usage.service';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type AuthenticatedRequest = Request & { user: JwtUser };

@Controller('api/scans')
@UseFilters(MulterExceptionFilter)
@UseGuards(JwtAuthGuard)
export class ScansController {
  constructor(
    private readonly aiService: AiService,
    private readonly ocrService: OcrService,
    private readonly usageService: UsageService,
  ) {}

  @Get()
  async listScans(@Req() request: AuthenticatedRequest) {
    return this.usageService.listUserScans(request.user.sub);
  }

  @Get(':id')
  async getScanConversation(
    @Param('id') scanId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usageService.getScanConversation(request.user.sub, scanId);
  }

  @Post('analyze')
  async analyzeScan(
    @Body() analyzeScanRequestDto: AnalyzeScanRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AnalyzeScanResponseDto> {
    await this.usageService.assertCanAnalyze(request.user.sub);
    const analysisResult = await this.aiService.analyzeScan(analyzeScanRequestDto);
    const usage = await this.usageService.recordScan({
      userId: request.user.sub,
      request: analyzeScanRequestDto,
      analysisResult,
    });

    return {
      ...analysisResult,
      scanId: usage.scanId,
      quota: usage.quota,
    };
  }

  @Post('extract-ingredients')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
      },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          callback(
            new BadRequestException(
              'Unsupported file type. Use JPEG, PNG, or WEBP.',
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  async extractIngredients(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ExtractIngredientsResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required.');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Use JPEG, PNG, or WEBP.',
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        'File is too large. Max file size is 10 MB.',
      );
    }

    return this.ocrService.extractIngredientsFromImage(file);
  }
}


