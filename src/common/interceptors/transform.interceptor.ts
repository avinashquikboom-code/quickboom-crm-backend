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
          const pagination = data.pagination ?? (data.meta ? {
            page: data.meta.page ?? data.page,
            limit: data.meta.limit ?? data.meta.pageSize ?? data.limit,
            total: data.meta.total ?? data.total,
            totalPages: data.meta.totalPages ?? data.totalPages,
          } : (data.total !== undefined ? {
            page: data.page,
            limit: data.limit,
            total: data.total,
            totalPages: data.totalPages,
          } : undefined));
          const meta = data.meta ?? pagination;

          return {
            statusCode: response.statusCode,
            success: typeof data.success === 'boolean' ? data.success : true,
            message: data.message || 'Operation completed successfully',
            data: data.data,
            items: data.items ?? (Array.isArray(data.data) ? data.data : undefined),
            counts: data.counts,
            summary: data.summary,
            balances: data.balances,
            pagination,
            meta,
            page: data.page ?? pagination?.page,
            limit: data.limit ?? pagination?.limit,
            total: data.total ?? pagination?.total,
            totalPages: data.totalPages ?? pagination?.totalPages,
            // Preserve sibling subscription fields. Wrapping `{ data }` must not
            // drop upcomingPlan / currentPlan or Flutter cannot see a purchased plan
            // whose startDate is still in the future.
            upcomingPlan: data.upcomingPlan,
            currentPlan: data.currentPlan,
            effectivePlan: data.effectivePlan,
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
