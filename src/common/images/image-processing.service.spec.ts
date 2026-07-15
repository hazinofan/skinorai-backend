import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import { ImageProcessingService } from './image-processing.service';
import { AiProviderConfigService } from '../../ai/config/ai-provider.config';

describe('ImageProcessingService', () => {
  function createService(maxImageSizeMb = 8, maxImageLongEdge = 1600) {
    return new ImageProcessingService({
      maxImageSizeMb,
      maxImageLongEdge,
    } as AiProviderConfigService);
  }

  it('rejects an invalid real image format even when the browser MIME type says PNG', async () => {
    const service = createService();
    const file = {
      buffer: Buffer.from('not-an-image'),
      size: 12,
      mimetype: 'image/png',
    } as Express.Multer.File;

    await expect(service.process(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an oversized image before provider processing', async () => {
    const service = createService(0.000001);
    const file = {
      buffer: Buffer.alloc(100),
      size: 100,
      mimetype: 'image/png',
    } as Express.Multer.File;

    await expect(service.process(file)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('auto-rotates, strips metadata, resizes, and returns a verified supported format in memory', async () => {
    const service = createService(8, 100);
    const source = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await service.process({
      buffer: source,
      size: source.byteLength,
      mimetype: 'application/octet-stream',
    } as Express.Multer.File);

    expect(result.mimeType).toBe('image/jpeg');
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(100);
    expect(result.originalBytes).toBe(source.byteLength);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.orientation).toBeUndefined();
  });
});
