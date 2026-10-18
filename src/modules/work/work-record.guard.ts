import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserAdmin } from '../../common/utils/account.util';

@Injectable()
export class WorkRecordGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (isUserAdmin(req.user)) return true;
    if (req.user?.accountType === 'CUSTOMER' && context.getHandler().name === 'getCustomerCalendar') {
      // CustomerService.authorize and the calendar company predicate enforce ownership.
      return true;
    }
    const employeeId = req.user?.employee?.id;
    if (!employeeId || req.user.employee.status !== 'ACTIVE') throw new ForbiddenException('Active employee profile required');
    const workId = req.params?.id ?? req.body?.activityScheduleId;
    if (workId) {
      if (['assignTeam', 'reviewWork', 'approveWork', 'requestRework', 'cancelWork', 'remove'].includes(context.getHandler().name)) throw new ForbiddenException('Administrator account required');
      const work = await this.prisma.work.findFirst({ where: { id: Number(workId), OR: [
        { assignedToId: employeeId }, { editorId: employeeId }, { tasks: { some: { assignedToId: employeeId } } },
        { team: { isActive: true, OR: [{ leaderId: employeeId }, { members: { some: { employeeId } } }] } },
      ] }, select: { id: true } });
      if (!work) throw new ForbiddenException('Work must be assigned to you or your team');
    }
    return true;
  }
}
