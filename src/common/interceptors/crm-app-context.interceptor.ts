import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCrmAppEmployee, isCrmAppHeader } from '../crm/crm-app-access';

/** Applies only when the CRM app identifies itself. Other QB Suite apps omit this header. */
@Injectable()
export class CrmAppContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    if (!isCrmAppHeader(request?.headers?.['x-app']) || !request?.user) {
      return next.handle();
    }
    try {
      await assertCrmAppEmployee(this.prisma, request.user);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException('Access Denied. The CRM application is available only to BPO and Visitor employees. Please contact your administrator.');
    }
    return next.handle();
  }
}
