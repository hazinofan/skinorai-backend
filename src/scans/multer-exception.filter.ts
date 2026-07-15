import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';
import multer from 'multer';

@Catch(multer.MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: multer.MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Max file size is 8 MB.'
        : exception.message;

    const badRequest = new BadRequestException(message).getResponse();
    response.status(400).json(badRequest);
  }
}
