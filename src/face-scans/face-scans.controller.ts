import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { AnalysisService } from '../ai/analysis.service';
import { ChatService } from '../ai/chat.service';
import type { JwtUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MulterExceptionFilter } from '../scans/multer-exception.filter';
import { UsageService } from '../usage/usage.service';
import { AnalyzeFaceScanDto, FaceMessageDto } from './face-scans.dto';

const MAX_MULTER_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_MULTER_BYTES, files: 3 },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
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
};

type AuthenticatedRequest = Request & { user: JwtUser };

@Controller('api/face-scans')
@UseFilters(MulterExceptionFilter)
@UseGuards(JwtAuthGuard)
export class FaceScansController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly chat: ChatService,
    private readonly usage: UsageService,
  ) {}

  @Get()
  listFaceScans(@Req() request: AuthenticatedRequest) {
    return this.usage.listUserFaceScans(request.user.sub);
  }
  @Post('analyze')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'frontImage', maxCount: 1 },
        { name: 'leftImage', maxCount: 1 },
        { name: 'rightImage', maxCount: 1 },
      ],
      uploadOptions,
    ),
  )
  analyzeFace(
    @UploadedFiles()
    files: {
      frontImage?: Express.Multer.File[];
      leftImage?: Express.Multer.File[];
      rightImage?: Express.Multer.File[];
    },
    @Body() dto: AnalyzeFaceScanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const frontImage = files?.frontImage?.[0];
    if (!frontImage)
      throw new BadRequestException('A front-facing photo is required.');
    return this.analysis.analyzeFace({
      userId: request.user.sub,
      frontImage,
      leftImage: files.leftImage?.[0],
      rightImage: files.rightImage?.[0],
      skinGoal: dto.skinGoal,
      consentAccepted: dto.consentAccepted,
    });
  }

  @Get(':id')
  getFaceScan(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.usage.getFaceScan(request.user.sub, id);
  }

  @Post(':faceScanId/messages')
  @UseInterceptors(FileInterceptor('image', uploadOptions))
  sendMessage(
    @Param('faceScanId') faceScanId: string,
    @Body() dto: FaceMessageDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.faceMessage({
      userId: request.user.sub,
      faceScanId,
      message: dto.message.trim(),
      image,
    });
  }
}

