import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ResponseFormat<T> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T;
  pagination?: PaginationMeta;
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
        // If data contains pagination or meta or custom data object
        if (data && typeof data === 'object' && 'data' in data) {
          return {
            statusCode: response.statusCode,
            success: typeof data.success === 'boolean' ? data.success : true,
            message: data.message || 'Operation completed successfully',
            data: data.data,
            pagination: data.pagination,
            meta: data.meta,
          };
        }

        return {
          statusCode: response.statusCode,
          success: typeof data?.success === 'boolean' ? data.success : true,
          message: data?.message || 'Operation completed successfully',
          data,
        };
      }),
    );
  }
}
