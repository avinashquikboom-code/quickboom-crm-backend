import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'otp',
  'secret',
  'authorization',
  'apikey',
  'paymentsecret',
];

function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveData);

  const copy: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      copy[key] = '***REDACTED***';
    } else if (typeof value === 'object') {
      copy[key] = redactSensitiveData(value);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();
    const { method, url, query, params, body, headers } = request;
    const startTime = Date.now();

    const user = (request as any).user;
    const customerId = headers['x-customer-id'] || (user?.customerId ? user.customerId : undefined);
    const userId = user?.id;

    // Structured Request Log
    const reqLog = [
      `[API_REQUEST] ${method} ${url}`,
      customerId ? `Customer ID: ${customerId}` : '',
      userId ? `User ID: ${userId}` : '',
      Object.keys(query || {}).length > 0 ? `Query: ${JSON.stringify(query)}` : '',
      Object.keys(params || {}).length > 0 ? `Params: ${JSON.stringify(params)}` : '',
      body && Object.keys(body).length > 0 ? `Body: ${JSON.stringify(redactSensitiveData(body))}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    this.logger.log(reqLog);

    return next.handle().pipe(
      tap({
        next: (data: any) => {
          const duration = Date.now() - startTime;
          let recordsCount: number | undefined;

          if (Array.isArray(data)) {
            recordsCount = data.length;
          } else if (data && typeof data === 'object') {
            if (Array.isArray(data.data)) {
              recordsCount = data.data.length;
            } else if (Array.isArray(data.services)) {
              recordsCount = data.services.length;
            }
          }

          const resLog = [
            `[API_RESPONSE] ${method} ${url} → ${response.statusCode} (${duration}ms)`,
            recordsCount !== undefined ? `Records: ${recordsCount}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          this.logger.log(resLog);
        },
        error: (err: any) => {
          const duration = Date.now() - startTime;
          const status = err?.status || response.statusCode || 500;
          this.logger.error(
            `[API_ERROR] ${method} ${url} → ${status} (${duration}ms) | Message: ${err.message}`,
            err.stack,
          );
        },
      }),
    );
  }
}
