import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseFormat<T> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T;
  meta?: any;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseFormat<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    const response = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((data) => {
        // If data contains pagination meta object
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          return {
            statusCode: response.statusCode,
            success: true,
            message: 'Operation completed successfully',
            data: data.data,
            meta: data.meta,
          };
        }

        return {
          statusCode: response.statusCode,
          success: true,
          message: 'Operation completed successfully',
          data,
        };
      }),
    );
  }
}
