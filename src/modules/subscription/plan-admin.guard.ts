import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isUserAdmin } from '../../common/utils/account.util';
@Injectable()
export class PlanAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!isUserAdmin(context.switchToHttp().getRequest().user))
      throw new ForbiddenException('Administrator required');
    return true;
  }
}
