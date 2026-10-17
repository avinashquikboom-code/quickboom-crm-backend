import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserAdmin } from '../../common/utils/account.util';

@Injectable()
export class ScheduleAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (isUserAdmin(req.user)) return true;
    const employeeId = req.user?.employee?.id;
    if (!employeeId || req.user.employee.status !== 'ACTIVE') throw new ForbiddenException('Active employee profile required');
    if (req.method !== 'GET') throw new ForbiddenException('Administrator account required');
    if (req.params?.id) {
      const schedule = await this.prisma.monthlySchedule.findFirst({ where: { id: Number(req.params.id), assignedEmployeeId: employeeId, deletedAt: null }, select: { id: true } });
      if (!schedule) throw new ForbiddenException('Schedule must be assigned to you');
    } else {
      req.query.employeeId = String(employeeId);
    }
    return true;
  }
}
