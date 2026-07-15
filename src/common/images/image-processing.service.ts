import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { AiProviderConfigService } from '../../ai/config/ai-provider.config';

export type ProcessedImage = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  originalBytes: number;
};

@Injectable()
export class ImageProcessingService {
  constructor(private readonly config: AiProviderConfigService) {}

  async process(file: Express.Multer.File): Promise<ProcessedImage> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Image file is required.');
    const maxBytes = this.config.maxImageSizeMb * 1024 * 1024;
    if (file.size > maxBytes || file.buffer.byteLength > maxBytes) {
      throw new PayloadTooLargeException(
        `Image is too large. Maximum size is ${this.config.maxImageSizeMb} MB.`,
      );
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, { failOn: 'error' }).metadata();
    } catch {
      throw new BadRequestException('Invalid or corrupted image file.');
    }

    if (
      !metadata.format ||
      !['jpeg', 'png', 'webp'].includes(metadata.format)
    ) {
      throw new BadRequestException(
        'Unsupported image format. Use JPEG, PNG, or WebP.',
      );
    }

    const format = metadata.format as 'jpeg' | 'png' | 'webp';
    let pipeline = sharp(file.buffer, { failOn: 'error' }).rotate().resize({
      width: this.config.maxImageLongEdge,
      height: this.config.maxImageLongEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (format === 'jpeg')
      pipeline = pipeline.jpeg({ quality: 84, mozjpeg: true });
    if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
    if (format === 'webp') pipeline = pipeline.webp({ quality: 84 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
      width: info.width,
      height: info.height,
      originalBytes: file.buffer.byteLength,
    };
  }
}
