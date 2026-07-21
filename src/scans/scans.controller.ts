import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { AnalyzeScanRequestDto } from '../ai/dto/analyze-scan-request.dto';
import { AnalysisService } from '../ai/analysis.service';
import { ChatService } from '../ai/chat.service';
import type { JwtUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsageService } from '../usage/usage.service';
import { MulterExceptionFilter } from './multer-exception.filter';
import { RenameConversationDto, ScanMessageDto } from './dto';

const MAX_MULTER_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type AuthenticatedRequest = Request & { user: JwtUser };

function imageUpload(field: string) {
  return FileInterceptor(field, {
    storage: memoryStorage(),
    limits: { fileSize: MAX_MULTER_BYTES },
    fileFilter: (_request, file, callback) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        callback(
          new BadRequestException(
            'Unsupported file type. Use JPEG, PNG, or WebP.',
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
  });
}

@Controller('api/scans')
@UseFilters(MulterExceptionFilter)
@UseGuards(JwtAuthGuard)
export class ScansController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly chat: ChatService,
    private readonly usage: UsageService,
  ) {}

  @Get()
  listScans(@Req() request: AuthenticatedRequest) {
    return this.usage.listUserScans(request.user.sub);
  }

  @Get(':id')
  getScanConversation(
    @Param('id') scanId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usage.getScanConversation(request.user.sub, scanId);
  }

  @Patch(':id/title')
  async renameScanConversation(
    @Param('id') scanId: string,
    @Body() dto: RenameConversationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const scan = await this.usage.renameProductConversation(
      request.user.sub,
      scanId,
      dto.title,
    );
    return {
      id: scan.id,
      productName: scan.productName,
      customTitle: scan.customTitle,
      updatedAt: scan.updatedAt,
    };
  }

  @Post('extract-product')
  @UseInterceptors(imageUpload('image'))
  extractProduct(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Image is required.');
    return this.analysis.extractProduct(request.user.sub, file);
  }

  @Post('extract-ingredients')
  @UseInterceptors(imageUpload('file'))
  extractIngredientsAlias(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('File is required.');
    return this.analysis.extractProduct(request.user.sub, file);
  }

  @Post('analyze')
  analyzeScan(
    @Body() dto: AnalyzeScanRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analysis.analyzeProduct(request.user.sub, dto);
  }

  @Post(':scanId/messages')
  @UseInterceptors(imageUpload('image'))
  sendMessage(
    @Param('scanId') scanId: string,
    @Body() dto: ScanMessageDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.productMessage({
      userId: request.user.sub,
      scanId,
      message: dto.message.trim(),
      image,
    });
  }
}
