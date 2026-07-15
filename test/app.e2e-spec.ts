import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { ScansController } from '../src/scans/scans.controller';
import { FaceScansController } from '../src/face-scans/face-scans.controller';
import { AnalysisService } from '../src/ai/analysis.service';
import { ChatService } from '../src/ai/chat.service';
import { UsageService } from '../src/usage/usage.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

const authenticatedGuard = {
  canActivate(context: {
    switchToHttp(): { getRequest(): Record<string, unknown> };
  }) {
    context.switchToHttp().getRequest().user = {
      sub: 'user-1',
      email: 'user@example.com',
    };
    return true;
  },
};

describe('Canonical AI routes (e2e)', () => {
  let app: INestApplication;
  let png: Buffer;
  const analysis = {
    extractProduct: jest
      .fn()
      .mockResolvedValue({ extractionId: 'extract-1', ingredients: [] }),
    analyzeProduct: jest.fn().mockResolvedValue({ scanId: 'scan-1', score: 8 }),
    analyzeFace: jest
      .fn()
      .mockResolvedValue({ faceScanId: 'face-1', usable: true }),
  };
  const chat = {
    productMessage: jest.fn().mockResolvedValue({ answer: 'product answer' }),
    faceMessage: jest.fn().mockResolvedValue({ answer: 'face answer' }),
  };
  const usage = {
    listUserScans: jest.fn().mockResolvedValue([]),
    getScanConversation: jest.fn().mockResolvedValue({ id: 'scan-1' }),
    getFaceScan: jest.fn().mockResolvedValue({ id: 'face-1' }),
  };

  beforeEach(async () => {
    analysis.extractProduct.mockClear();
    analysis.analyzeProduct.mockClear();
    analysis.analyzeFace.mockClear();
    chat.productMessage.mockClear();
    chat.faceMessage.mockClear();
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    const moduleBuilder = Test.createTestingModule({
      controllers: [ScansController, FaceScansController],
      providers: [
        { provide: AnalysisService, useValue: analysis },
        { provide: ChatService, useValue: chat },
        { provide: UsageService, useValue: usage },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(authenticatedGuard);
    const moduleRef = await moduleBuilder.compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a free product image through POST /api/scans/extract-product', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/scans/extract-product')
      .attach('image', png, { filename: 'label.png', contentType: 'image/png' })
      .expect(201);

    expect(response.body.extractionId).toBe('extract-1');
    expect(analysis.extractProduct).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ mimetype: 'image/png' }),
    );
  });

  it('keeps the backwards-compatible extract-ingredients alias', async () => {
    await request(app.getHttpServer())
      .post('/api/scans/extract-ingredients')
      .attach('file', png, {
        filename: 'label.webp',
        contentType: 'image/webp',
      })
      .expect(201);

    expect(analysis.extractProduct).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ mimetype: 'image/webp' }),
    );
  });

  it('rejects browser-supplied analysisResult and productName fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/scans/analyze')
      .send({
        skinGoal: 'hydration',
        confirmedIngredients: ['Aqua'],
        analysisResult: { score: 10 },
        productName: 'Tampered product',
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('should not exist');
    expect(analysis.analyzeProduct).not.toHaveBeenCalled();
  });

  it('accepts only scanId, message, and an optional image for product chat', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/scans/scan-1/messages')
      .field('message', 'What should I watch for?')
      .attach('image', png, {
        filename: 'product.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(response.body.answer).toBe('product answer');
    expect(chat.productMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        scanId: 'scan-1',
        message: 'What should I watch for?',
        image: expect.objectContaining({ mimetype: 'image/png' }),
      }),
    );
  });

  it('accepts Pro face-scan multipart fields and transformed consent', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/face-scans/analyze')
      .field('consentAccepted', 'true')
      .field('skinGoal', 'hydration')
      .attach('frontImage', png, {
        filename: 'front.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(response.body.faceScanId).toBe('face-1');
    expect(analysis.analyzeFace).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        consentAccepted: true,
        skinGoal: 'hydration',
        frontImage: expect.objectContaining({ mimetype: 'image/png' }),
      }),
    );
  });

  it('rejects unsupported upload MIME types before provider code runs', async () => {
    await request(app.getHttpServer())
      .post('/api/scans/extract-product')
      .attach('image', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(analysis.extractProduct).not.toHaveBeenCalled();
  });
});
