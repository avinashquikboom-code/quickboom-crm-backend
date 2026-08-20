import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ModuleResetDto,
  MultipleModulesResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
} from './dto/data-management.dto';

@Injectable()
export class DataManagementService {
  private readonly logger = new Logger(DataManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/v1/admin/data-management/summary
   * Fetches real live database record counts for all customer modules
   */
  async getSummary(customerId: string) {
    try {
      const [
        leadsCount,
        contactsCount,
        companiesCount,
        dealsCount,
        tasksCount,
        attendanceCount,
        breaksCount,
        leaveRequestsCount,
        remoteRequestsCount,
        visitsCount,
        payrollsCount,
        salarySlipsCount,
        notificationsCount,
        locationsCount,
        employeesCount,
        departmentsCount,
        designationsCount,
        usersCount,
      ] = await Promise.all([
        this.prisma.lead.count({ where: { customerId } }),
        this.prisma.contact.count({ where: { customerId } }),
        this.prisma.company.count({ where: { customerId } }),
        this.prisma.deal.count({ where: { customerId } }),
        this.prisma.task.count({ where: { customerId } }),
        this.prisma.attendance.count({ where: { customerId } }),
        this.prisma.attendanceBreak.count({
          where: { attendance: { customerId } },
        }),
        this.prisma.leaveRequest.count({ where: { customerId } }),
        this.prisma.remoteRequest.count({ where: { customerId } }),
        this.prisma.visit.count({ where: { customerId } }),
        this.prisma.payroll.count({ where: { customerId } }),
        this.prisma.salarySlip.count({ where: { customerId } }),
        this.prisma.notification.count({ where: { customerId } }),
        this.prisma.employeeLocation.count({ where: { customerId } }),
        this.prisma.employee.count({ where: { customerId } }),
        this.prisma.department.count({ where: { customerId } }),
        this.prisma.designation.count({ where: { customerId } }),
        this.prisma.user.count({ where: { customerId } }),
      ]);

      const lastResetLogs = await this.prisma.auditLog.findMany({
        where: { customerId, action: 'DATA_RESET' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return {
        transactional: {
          crm: {
            total: leadsCount + contactsCount + companiesCount + dealsCount + tasksCount,
            leads: leadsCount,
            contacts: contactsCount,
            companies: companiesCount,
            deals: dealsCount,
            tasks: tasksCount,
          },
          attendance: {
            total: attendanceCount + breaksCount,
            attendances: attendanceCount,
            breaks: breaksCount,
          },
          leave: {
            leaveRequests: leaveRequestsCount,
          },
          remote: {
            remoteRequests: remoteRequestsCount,
          },
          visits: {
            visits: visitsCount,
          },
          payroll: {
            total: payrollsCount + salarySlipsCount,
            payrolls: payrollsCount,
            salarySlips: salarySlipsCount,
          },
          notifications: {
            notifications: notificationsCount,
          },
          location: {
            locationLogs: locationsCount,
          },
        },
        masterDataProtected: {
          employees: employeesCount,
          departments: departmentsCount,
          designations: designationsCount,
          users: usersCount,
        },
        lastReset: lastResetLogs[0]?.createdAt || null,
      };
    } catch (err: any) {
      this.logger.error(`Failed to get summary for customer ${customerId}: ${err.message}`);
      // Fallback response if database table not yet populated
      return {
        transactional: {
          crm: { total: 0, leads: 0, contacts: 0, companies: 0, deals: 0, tasks: 0 },
          attendance: { total: 0, attendances: 0, breaks: 0 },
          leave: { leaveRequests: 0 },
          remote: { remoteRequests: 0 },
          visits: { visits: 0 },
          payroll: { total: 0, payrolls: 0, salarySlips: 0 },
          notifications: { notifications: 0 },
          location: { locationLogs: 0 },
        },
        masterDataProtected: {
          employees: 0,
          departments: 0,
          designations: 0,
          users: 0,
        },
        lastReset: null,
      };
    }
  }

  /**
   * GET /api/v1/admin/data-management/history
   * Retrieves data reset audit log history for the customer
   */
  async getResetHistory(customerId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { customerId, action: 'DATA_RESET' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return logs.map((log) => ({
      id: log.id,
      module: log.module,
      details: log.details,
      performedBy: log.user
        ? `${log.user.firstName} ${log.user.lastName}`
        : 'System Admin',
      performedByEmail: log.user?.email || 'N/A',
      timestamp: log.createdAt,
      ipAddress: log.ipAddress || '127.0.0.1',
    }));
  }

  /**
   * POST /api/v1/admin/data-management/reset/module
   * Resets a single transactional module within a Prisma transaction
   */
  async resetModule(
    customerId: string,
    userId: string,
    userRole: string,
    dto: ModuleResetDto,
  ) {
    const normModule = dto.module.toLowerCase().trim();
    const expectedConfirm = `RESET ${normModule.toUpperCase().replace(/-/g, ' ')}`;

    if (dto.confirmation.trim().toUpperCase() !== expectedConfirm) {
      throw new BadRequestException(
        `Confirmation mismatch. You must type "${expectedConfirm}" to confirm deletion.`,
      );
    }

    let deletedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      switch (normModule) {
        case 'crm': {
          // Relational deletion order: Notes -> Reminders -> Timeline -> Tasks -> Deals -> Contacts -> Leads -> Companies
          await tx.leadNote.deleteMany({ where: { lead: { customerId } } });
          await tx.leadReminder.deleteMany({ where: { lead: { customerId } } });
          await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId } } });
          const tasks = await tx.task.deleteMany({ where: { customerId } });
          const deals = await tx.deal.deleteMany({ where: { customerId } });
          const contacts = await tx.contact.deleteMany({ where: { customerId } });
          const leads = await tx.lead.deleteMany({ where: { customerId } });
          const companies = await tx.company.deleteMany({ where: { customerId } });
          deletedCount = tasks.count + deals.count + contacts.count + leads.count + companies.count;
          break;
        }
        case 'attendance': {
          // Breaks -> Attendances
          const breaks = await tx.attendanceBreak.deleteMany({
            where: { attendance: { customerId } },
          });
          const attendances = await tx.attendance.deleteMany({ where: { customerId } });
          deletedCount = breaks.count + attendances.count;
          break;
        }
        case 'leave': {
          const leaves = await tx.leaveRequest.deleteMany({ where: { customerId } });
          deletedCount = leaves.count;
          break;
        }
        case 'remote': {
          const remotes = await tx.remoteRequest.deleteMany({ where: { customerId } });
          deletedCount = remotes.count;
          break;
        }
        case 'visits': {
          const visits = await tx.visit.deleteMany({ where: { customerId } });
          deletedCount = visits.count;
          break;
        }
        case 'payroll': {
          // SalarySlips -> PayrollItems -> Payrolls
          const slips = await tx.salarySlip.deleteMany({ where: { customerId } });
          const items = await tx.payrollItem.deleteMany({ where: { customerId } });
          const payrolls = await tx.payroll.deleteMany({ where: { customerId } });
          deletedCount = slips.count + items.count + payrolls.count;
          break;
        }
        case 'notifications': {
          const notifications = await tx.notification.deleteMany({ where: { customerId } });
          deletedCount = notifications.count;
          break;
        }
        case 'location': {
          const locations = await tx.employeeLocation.deleteMany({ where: { customerId } });
          deletedCount = locations.count;
          break;
        }
        default:
          throw new BadRequestException(`Unsupported reset module: ${dto.module}`);
      }

      // Record in AuditLog
      await tx.auditLog.create({
        data: {
          customerId,
          userId,
          action: 'DATA_RESET',
          module: normModule.toUpperCase(),
          details: {
            scope: 'MODULE_RESET',
            module: normModule.toUpperCase(),
            recordsDeleted: deletedCount,
            performedByRole: userRole,
            reason: dto.reason || 'Admin initiated module data reset',
            status: 'SUCCESS',
          },
        },
      });
    });

    this.logger.log(
      `[Data Reset] Customer ${customerId}: User ${userId} (${userRole}) reset module ${normModule}. Deleted ${deletedCount} records.`,
    );

    return {
      success: true,
      module: normModule,
      recordsDeleted: deletedCount,
      message: `Successfully reset ${normModule.toUpperCase()} data (${deletedCount} records permanently deleted). Master data remained intact.`,
    };
  }

  /**
   * POST /api/v1/admin/data-management/reset/all
   * Resets all transactional data for the customer while protecting master data
   */
  async resetAllTransactional(
    customerId: string,
    userId: string,
    userRole: string,
    dto: ResetAllDto,
  ) {
    if (dto.confirmation.trim().toUpperCase() !== 'RESET ALL DATA') {
      throw new BadRequestException(
        'Confirmation mismatch. You must type "RESET ALL DATA" to execute all transactional data reset.',
      );
    }

    let totalDeleted = 0;

    await this.prisma.$transaction(async (tx) => {
      // 1. CRM
      await tx.leadNote.deleteMany({ where: { lead: { customerId } } });
      await tx.leadReminder.deleteMany({ where: { lead: { customerId } } });
      await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId } } });
      const tasks = await tx.task.deleteMany({ where: { customerId } });
      const deals = await tx.deal.deleteMany({ where: { customerId } });
      const contacts = await tx.contact.deleteMany({ where: { customerId } });
      const leads = await tx.lead.deleteMany({ where: { customerId } });
      const companies = await tx.company.deleteMany({ where: { customerId } });

      // 2. Attendance & Breaks
      const breaks = await tx.attendanceBreak.deleteMany({
        where: { attendance: { customerId } },
      });
      const attendances = await tx.attendance.deleteMany({ where: { customerId } });

      // 3. Leaves & Remote
      const leaves = await tx.leaveRequest.deleteMany({ where: { customerId } });
      const remotes = await tx.remoteRequest.deleteMany({ where: { customerId } });

      // 4. Visits
      const visits = await tx.visit.deleteMany({ where: { customerId } });

      // 5. Payroll
      const slips = await tx.salarySlip.deleteMany({ where: { customerId } });
      const items = await tx.payrollItem.deleteMany({ where: { customerId } });
      const payrolls = await tx.payroll.deleteMany({ where: { customerId } });

      // 6. Notifications & Locations
      const notifications = await tx.notification.deleteMany({ where: { customerId } });
      const locations = await tx.employeeLocation.deleteMany({ where: { customerId } });

      totalDeleted =
        tasks.count +
        deals.count +
        contacts.count +
        leads.count +
        companies.count +
        breaks.count +
        attendances.count +
        leaves.count +
        remotes.count +
        visits.count +
        slips.count +
        items.count +
        payrolls.count +
        notifications.count +
        locations.count;

      // Audit Log
      await tx.auditLog.create({
        data: {
          customerId,
          userId,
          action: 'DATA_RESET',
          module: 'ALL_TRANSACTIONAL',
          details: {
            scope: 'ALL_TRANSACTIONAL',
            recordsDeleted: totalDeleted,
            performedByRole: userRole,
            reason: dto.reason || 'Admin reset all transactional customer data',
            status: 'SUCCESS',
          },
        },
      });
    });

    this.logger.log(
      `[Data Reset] Customer ${customerId}: User ${userId} executed full transactional reset. Total ${totalDeleted} records removed.`,
    );

    return {
      success: true,
      scope: 'ALL_TRANSACTIONAL',
      recordsDeleted: totalDeleted,
      message: `All transactional data has been permanently reset (${totalDeleted} records deleted). All Employees, Departments, Designations, Roles, and Subscription master data were protected.`,
    };
  }

  /**
   * GET /api/v1/admin/data-management/employees/:employeeId/summary
   * Returns individual employee profile and their isolated transactional data counts
   */
  async getEmployeeSummary(customerId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        user: { select: { email: true, phone: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found in your organization.`);
    }

    const [
      attendanceCount,
      breaksCount,
      leavesCount,
      remotesCount,
      visitsCount,
      salarySlipsCount,
      locationsCount,
    ] = await Promise.all([
      this.prisma.attendance.count({ where: { customerId, employeeId } }),
      this.prisma.attendanceBreak.count({
        where: { attendance: { customerId, employeeId } },
      }),
      this.prisma.leaveRequest.count({ where: { customerId, employeeId } }),
      this.prisma.remoteRequest.count({ where: { customerId, employeeId } }),
      this.prisma.visit.count({ where: { customerId, employeeId } }),
      this.prisma.salarySlip.count({ where: { customerId, employeeId } }),
      this.prisma.employeeLocation.count({ where: { customerId, employeeId } }),
    ]);

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName}`,
        email: employee.email || employee.user?.email || 'N/A',
        phone: employee.phone || employee.user?.phone || 'N/A',
        department: employee.department?.name || 'General',
        designation: employee.designation?.name || 'Staff',
        status: employee.status,
        joiningDate: employee.joiningDate,
      },
      counts: {
        attendance: attendanceCount + breaksCount,
        attendances: attendanceCount,
        breaks: breaksCount,
        leave: leavesCount,
        remote: remotesCount,
        visits: visitsCount,
        payroll: salarySlipsCount,
        location: locationsCount,
        total:
          attendanceCount +
          breaksCount +
          leavesCount +
          remotesCount +
          visitsCount +
          salarySlipsCount +
          locationsCount,
      },
    };
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/module
   * Resets an individual module for a specific employee
   */
  async resetEmployeeModule(
    customerId: string,
    userId: string,
    userRole: string,
    employeeId: string,
    dto: EmployeeModuleResetDto,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found in your organization.`);
    }

    const normModule = dto.module.toLowerCase().trim();
    const expectedConfirm = `RESET EMPLOYEE ${normModule.toUpperCase()}`;

    if (dto.confirmation.trim().toUpperCase() !== expectedConfirm) {
      throw new BadRequestException(
        `Confirmation mismatch. You must type "${expectedConfirm}" to confirm employee reset.`,
      );
    }

    let deletedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      switch (normModule) {
        case 'attendance': {
          const breaks = await tx.attendanceBreak.deleteMany({
            where: { attendance: { customerId, employeeId } },
          });
          const attendances = await tx.attendance.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = breaks.count + attendances.count;
          break;
        }
        case 'leave': {
          const leaves = await tx.leaveRequest.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = leaves.count;
          break;
        }
        case 'remote': {
          const remotes = await tx.remoteRequest.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = remotes.count;
          break;
        }
        case 'visits': {
          const visits = await tx.visit.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = visits.count;
          break;
        }
        case 'payroll': {
          const slips = await tx.salarySlip.deleteMany({
            where: { customerId, employeeId },
          });
          const items = await tx.payrollItem.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = slips.count + items.count;
          break;
        }
        case 'location': {
          const locations = await tx.employeeLocation.deleteMany({
            where: { customerId, employeeId },
          });
          deletedCount = locations.count;
          break;
        }
        default:
          throw new BadRequestException(`Unsupported module: ${dto.module}`);
      }

      await tx.auditLog.create({
        data: {
          customerId,
          userId,
          action: 'DATA_RESET',
          module: `EMPLOYEE_${normModule.toUpperCase()}`,
          details: {
            scope: 'EMPLOYEE_MODULE_RESET',
            employeeId,
            employeeCode: employee.employeeCode,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            module: normModule.toUpperCase(),
            recordsDeleted: deletedCount,
            performedByRole: userRole,
            reason: dto.reason || 'Admin reset employee module data',
            status: 'SUCCESS',
          },
        },
      });
    });

    return {
      success: true,
      employeeId,
      module: normModule,
      recordsDeleted: deletedCount,
      message: `Reset ${normModule.toUpperCase()} records for employee ${employee.firstName} ${employee.lastName} (${deletedCount} records deleted). Profile was preserved.`,
    };
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/all
   * Resets all transactional data for an employee while preserving employee master profile
   */
  async resetEmployeeAllTransactional(
    customerId: string,
    userId: string,
    userRole: string,
    employeeId: string,
    dto: EmployeeResetAllDto,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found in your organization.`);
    }

    if (dto.confirmation.trim().toUpperCase() !== 'RESET ALL DATA FOR EMPLOYEE') {
      throw new BadRequestException(
        'Confirmation mismatch. You must type "RESET ALL DATA FOR EMPLOYEE" to confirm.',
      );
    }

    let totalDeleted = 0;

    await this.prisma.$transaction(async (tx) => {
      const breaks = await tx.attendanceBreak.deleteMany({
        where: { attendance: { customerId, employeeId } },
      });
      const attendances = await tx.attendance.deleteMany({
        where: { customerId, employeeId },
      });
      const leaves = await tx.leaveRequest.deleteMany({
        where: { customerId, employeeId },
      });
      const remotes = await tx.remoteRequest.deleteMany({
        where: { customerId, employeeId },
      });
      const visits = await tx.visit.deleteMany({
        where: { customerId, employeeId },
      });
      const slips = await tx.salarySlip.deleteMany({
        where: { customerId, employeeId },
      });
      const items = await tx.payrollItem.deleteMany({
        where: { customerId, employeeId },
      });
      const locations = await tx.employeeLocation.deleteMany({
        where: { customerId, employeeId },
      });

      totalDeleted =
        breaks.count +
        attendances.count +
        leaves.count +
        remotes.count +
        visits.count +
        slips.count +
        items.count +
        locations.count;

      await tx.auditLog.create({
        data: {
          customerId,
          userId,
          action: 'DATA_RESET',
          module: 'EMPLOYEE_ALL_TRANSACTIONAL',
          details: {
            scope: 'EMPLOYEE_ALL_TRANSACTIONAL',
            employeeId,
            employeeCode: employee.employeeCode,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            recordsDeleted: totalDeleted,
            performedByRole: userRole,
            reason: dto.reason || 'Admin reset all transactional data for employee',
            status: 'SUCCESS',
          },
        },
      });
    });

    return {
      success: true,
      employeeId,
      recordsDeleted: totalDeleted,
      message: `Successfully reset all transactional data for ${employee.firstName} ${employee.lastName} (${totalDeleted} records removed). Employee profile and employment history remain intact.`,
    };
  }
}
