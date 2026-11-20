import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: any =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse?.message
        ? exceptionResponse.message
        : exception instanceof Error
        ? exception.message
        : 'Internal server error';

    const errorDetails =
      typeof exceptionResponse === 'object' && exceptionResponse?.error
        ? exceptionResponse.error
        : null;

    const code =
      typeof exceptionResponse === 'object' && exceptionResponse?.code
        ? exceptionResponse.code
        : undefined;

    // Check if this is an expected favicon request
    const isFavicon =
      request.url?.includes('favicon.ico') || request.url?.includes('favicon.png');

    if (isFavicon) {
      if (status === HttpStatus.NOT_FOUND) {
        const filename = request.url.includes('.png') ? 'favicon.png' : 'favicon.ico';
        const possiblePaths = [
          join(process.cwd(), 'public', filename),
          join(process.cwd(), 'assets', filename),
          join(process.cwd(), 'uploads', filename),
          join(process.cwd(), filename),
          join(__dirname, '..', '..', 'public', filename),
          join(__dirname, '..', '..', 'assets', filename),
        ];
        for (const filePath of possiblePaths) {
          if (existsSync(filePath)) {
            return response.sendFile(filePath);
          }
        }
        return response.status(HttpStatus.NO_CONTENT).end();
      }
      this.logger.warn(
        `[${request.method}] ${request.url} - Status: ${status} - Error: ${JSON.stringify(message)}`,
      );
      return response.status(status).end();
    }

    this.logger.error(
      `[${request.method}] ${request.url} - Status: ${status} - Error: ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : '',
    );

    response.status(status).json({
      statusCode: status,
      success: false,
      message: Array.isArray(message) ? message[0] : message,
      ...(code ? { code } : {}),
      errors: Array.isArray(message) ? message : message ? [message] : [],
      errorDetails,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
