import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import { ScheduleStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Mobile-specific schedule endpoint.
 * Returns schedules ONLY for the authenticated employee, filtered by their
 * role-based work-module permissions. No client-side filtering required.
 */
@ApiTags('Mobile - Employee Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('mobile/schedules')
export class MobileScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Map a plan name / work type string to the Flutter work-module permission key.
   * Used to filter schedules visible to the employee based on their granted modules.
   */
  private mapPlanToWorkModuleKeys(planName?: string | null): string[] {
    if (!planName) return [];
    const lower = planName.toLowerCase();

    const mapping: Array<[string[], string]> = [
      [['video', 'edit', 'editing'], 'video_edit'],
      [['post', 'graphic', 'creative'], 'post_design'],
      [['story'], 'story_design'],
      [['reel', 'shoot'], 'reel_shoot'],
      [['social media management', 'smm'], 'video_edit'], // SMM covers all
      [['lead', 'crm', 'sales'], 'leads'],
      [['content', 'writing'], 'post_design'],
      [['ads', 'meta', 'google'], 'post_design'],
    ];

    const matched = new Set<string>();
    for (const [keywords, key] of mapping) {
      if (keywords.some((kw) => lower.includes(kw))) {
        matched.add(key);
      }
    }

    // If nothing matched, treat as general (accessible to all)
    return matched.size > 0 ? Array.from(matched) : ['all'];
  }

  @Get('my')
  @ApiOperation({ summary: 'Get schedules assigned to the authenticated employee (permission-filtered)' })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getMySchedules(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: ScheduleStatus,
  ) {
    const numCustomerId = Number(customerId);

    // Step 1: Resolve authenticated employee
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    if (!employee) {
      return { items: [], data: [], total: 0, message: 'Employee profile not found.' };
    }

    // Step 2: Fetch the employee's granted work module permissions for this tenant
    const rolePerms = await this.prisma.roleWorkPermission.findMany({
      where: {
        customerId: numCustomerId || employee.customerId,
        roleName: (employee as any).role || 'Employee',
        isEnabled: true,
      },
    });

    const grantedModules = rolePerms.map((p) => p.workModule);

    // Step 3: Fetch schedules directly assigned to this employee
    const where: any = {
      deletedAt: null,
      assignedEmployeeId: employee.id,
      customerId: numCustomerId || employee.customerId,
    };

    if (status && (status as string) !== 'ALL') {
      where.status = status;
    }

    if (month && year) {
      where.month = Number(month);
      where.year = Number(year);
    } else if (from || to) {
      where.startDate = {};
      if (from) where.startDate.gte = new Date(from);
      if (to) where.startDate.lte = new Date(to);
    }

    const allAssignedSchedules = await this.prisma.monthlySchedule.findMany({
      where,
      orderBy: { startDate: 'asc' },
      include: {
        customer: { select: { id: true, name: true } },
        plan: { select: { id: true, name: true, code: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Step 4: Permission-based filtering
    // If employee has no explicit role permissions, show all assigned schedules (fallback safe)
    const hasRolePerms = grantedModules.length > 0;

    const filtered = allAssignedSchedules.filter((schedule) => {
      if (!hasRolePerms) return true; // No restrictions configured — show all

      const planName = schedule.plan?.name || schedule.title || '';
      const scheduleModules = this.mapPlanToWorkModuleKeys(planName);

      // If schedule maps to 'all' (generic plan), show to all employees
      if (scheduleModules.includes('all')) return true;

      // Otherwise check if employee has at least one matching permission
      return scheduleModules.some((mod) => grantedModules.includes(mod));
    });

    const mapped = filtered.map((item) => ({
      id: item.id,
      title: item.title || `${item.customer?.name || 'Customer'} - ${item.plan?.name || 'Plan'}`,
      customerId: item.customerId,
      customerName: item.customer?.name || 'Customer',
      planName: item.plan?.name || null,
      planCode: item.plan?.code || null,
      status: item.status,
      startDate: item.startDate,
      endDate: item.endDate,
      month: item.month,
      year: item.year,
      notes: item.notes,
      assignedEmployee: item.assignedEmployee
        ? `${item.assignedEmployee.firstName || ''} ${item.assignedEmployee.lastName || ''}`.trim()
        : 'Me',
    }));

    return {
      items: mapped,
      data: mapped,
      total: mapped.length,
      employeeId: employee.id,
      grantedModules,
    };
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Get calendar view of employee-specific schedules' })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getMyCalendar(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.getMySchedules(user, customerId, month, year, from, to);
  }
}
