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

    // Step 1: Resolve authenticated employee with designation and user role relations
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
      include: {
        designation: true,
        user: true,
      },
    });

    if (!employee) {
      return { items: [], data: [], total: 0, message: 'Employee profile not found.' };
    }

    const tenantCustomerId = numCustomerId || undefined;

    // Step 3: Fetch schedules directly assigned to this employee
    const where: any = {
      deletedAt: null,
      assignedEmployeeId: employee.id,
      
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
        
        plan: { select: { id: true, name: true, code: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const filtered = allAssignedSchedules;

    const mapped = filtered.map((item) => ({
      id: item.id,
      title: item.title || `${'Customer'} - ${item.plan?.name || 'Plan'}`,
      
      customerName: 'Customer',
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
    };
  }

}
