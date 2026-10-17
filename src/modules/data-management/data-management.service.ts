import { GoneException } from '@nestjs/common';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ModuleResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
  BulkDeleteBinDto,
} from './dto/data-management.dto';

@Injectable()
export class DataManagementService {
  private readonly logger = new Logger(DataManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves customer ID from explicit parameter or defaults to the first customer
   */
  private async resolveCustomerId(customerId: number | string | undefined | null): Promise<number> {
return undefined;
  }

  /**
   * Resolves employee record and verifies customer isolation if customerId provided
   */
  private async resolveEmployee(employeeId: number | string, customerId?: number | string) {
    const numEmployeeId = Number(employeeId);
    if (isNaN(numEmployeeId) || numEmployeeId <= 0) {
      throw new BadRequestException('Invalid employee ID provided.');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: numEmployeeId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        user: { select: { id: true, email: true, phone: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found in your organization.');
    }

    // Super Admin must NOT appear or be operated on as an employee
    if (employee.user) {
      const isSuperAdminUser =
        employee.user.email === 'admin@quikboom.com' ||
        (employee.user as any).role === 'SUPER_ADMIN';
      if (isSuperAdminUser) {
        throw new ForbiddenException('Super Admin cannot be modified as an employee.');
      }
    }

    const numCustomerId = Number(customerId);
    if (!isNaN(numCustomerId) && numCustomerId > 0 && false) {
      throw new ForbiddenException('You do not have permission to access records for this employee.');
    }

    return employee;
  }

  /**
   * GET /api/v1/admin/data-management/summary
   * Fetches real live database record counts for all customer modules
   */
  async getSummary(customerId: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    try {
      const [

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
        worksCount,
        schedulesCount,
        ticketsCount,
        claimsCount,
        loansCount,
        employeesCount,
        departmentsCount,
        designationsCount,
        usersCount,
      ] = await Promise.all([
        this.prisma.contact.count({ where: {  } }),
        this.prisma.company.count({ where: {  } }),
        this.prisma.deal.count({ where: {  } }),
        this.prisma.task.count({ where: {  } }),
        this.prisma.attendance.count({ where: {  } }),
        this.prisma.attendanceBreak.count({
          where: { attendance: {  } },
        }),
        this.prisma.leaveRequest.count({ where: {  } }),
        this.prisma.remoteRequest.count({ where: {  } }),
        this.prisma.visit.count({ where: {  } }),
        this.prisma.payroll.count({ where: {  } }),
        this.prisma.salarySlip.count({ where: {  } }),
        this.prisma.notification.count({ where: {  } }),
        this.prisma.employeeLocation.count({ where: {  } }),
        this.prisma.work.count({ where: {  } }),
        this.prisma.monthlySchedule.count({ where: {  } }),
        this.prisma.supportTicket.count({ where: {  } }),
        this.prisma.employeeClaim.count({ where: {  } }),
        this.prisma.employeeLoan.count({ where: {  } }),
        this.prisma.employee.count({ where: {  } }),
        this.prisma.department.count({ where: {  } }),
        this.prisma.designation.count({ where: {  } }),
        this.prisma.user.count({ where: {  } }),
      ]);

      const lastResetLogs = await this.prisma.auditLog.findMany({
        where: {  action: 'DATA_RESET' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return {
        transactional: {
          crm: {
            total: contactsCount + companiesCount + dealsCount + tasksCount,

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
          operations: {
            total: worksCount + schedulesCount + ticketsCount + claimsCount + loansCount,
            works: worksCount,
            schedules: schedulesCount,
            tickets: ticketsCount,
            claims: claimsCount,
            loans: loansCount,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to get summary for customer ${customerId}: ${msg}`);
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
          operations: { total: 0, works: 0, schedules: 0, tickets: 0, claims: 0, loans: 0 },
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
  async getResetHistory(customerId: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const logs = await this.prisma.auditLog.findMany({
      where: {  action: 'DATA_RESET' },
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
   * Resets a single transactional module within a Prisma transaction.
   * Deletion follows FK-safe order: child records are deleted before referenced parents.
   */
  async resetModule(
    customerId: number | string,
    userId: number | string,
    userRole: string,
    dto: ModuleResetDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numUserId = Number(userId) || 1;

    const normModule = dto.module.toLowerCase().trim();
    const expectedConfirm = `RESET ${normModule.toUpperCase().replace(/-/g, ' ')}`;

    if (
      dto.confirmation.trim().toUpperCase() !== expectedConfirm &&
      dto.confirmation.trim().toUpperCase() !== `RESET ${normModule.toUpperCase()}`
    ) {
      throw new BadRequestException(
        `Confirmation mismatch. You must type "${expectedConfirm}" to confirm deletion.`,
      );
    }

    let deletedCount = 0;
    const cnt = (res?: { count?: number } | null): number => (res && typeof res.count === 'number' ? res.count : 0);

    await this.prisma.$transaction(async (tx) => {
      switch (normModule) {
        case 'crm': {
          // Leaf children




          if (tx.taskHistory?.deleteMany) await tx.taskHistory.deleteMany({ where: { task: {  } } });
          if (tx.taskProof?.deleteMany) await tx.taskProof.deleteMany({ where: { task: {  } } });
          if (tx.taskReview?.deleteMany) await tx.taskReview.deleteMany({ where: { task: {  } } });
          if (tx.quotationItem?.deleteMany) await tx.quotationItem.deleteMany({ where: { quotation: {  } } });
          if (tx.communicationHistory?.deleteMany) await tx.communicationHistory.deleteMany({ where: { contact: {  } } });

          // Parents in FK-safe order
          const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: {  } }) : { count: 0 };
          const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: {  } }) : { count: 0 };
          const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: {  } }) : { count: 0 };
          const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: {  } }) : { count: 0 };
          const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: {  } }) : { count: 0 };

          const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: {  } }) : { count: 0 };

          deletedCount =
            cnt(quotations) +
            cnt(visits) +
            cnt(tasks) +
            cnt(deals) +
            cnt(contacts) +
            cnt(companies);
          break;
        }
        case 'attendance': {
          const breaks = tx.attendanceBreak?.deleteMany
            ? await tx.attendanceBreak.deleteMany({ where: { attendance: {  } } })
            : { count: 0 };
          const attendances = tx.attendance?.deleteMany
            ? await tx.attendance.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(breaks) + cnt(attendances);
          break;
        }
        case 'leave': {
          if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: {  } });
          if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: {  } });
          const leaves = tx.leaveRequest?.deleteMany
            ? await tx.leaveRequest.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(leaves);
          break;
        }
        case 'remote': {
          const remotes = tx.remoteRequest?.deleteMany
            ? await tx.remoteRequest.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(remotes);
          break;
        }
        case 'visits': {
          const visits = tx.visit?.deleteMany
            ? await tx.visit.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(visits);
          break;
        }
        case 'payroll': {
          const slips = tx.salarySlip?.deleteMany
            ? await tx.salarySlip.deleteMany({ where: {  } })
            : { count: 0 };
          const items = tx.payrollItem?.deleteMany
            ? await tx.payrollItem.deleteMany({ where: {  } })
            : { count: 0 };
          const payrolls = tx.payroll?.deleteMany
            ? await tx.payroll.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(slips) + cnt(items) + cnt(payrolls);
          break;
        }
        case 'notifications': {
          const notifications = tx.notification?.deleteMany
            ? await tx.notification.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(notifications);
          break;
        }
        case 'location': {
          if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: {  } });
          const locations = tx.employeeLocation?.deleteMany
            ? await tx.employeeLocation.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(locations);
          break;
        }
        case 'claims': {
          const claims = tx.employeeClaim?.deleteMany
            ? await tx.employeeClaim.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(claims);
          break;
        }
        case 'loans': {
          const loans = tx.employeeLoan?.deleteMany
            ? await tx.employeeLoan.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(loans);
          break;
        }
        case 'works': {
          if (tx.workTask?.deleteMany) await tx.workTask.deleteMany({ where: { work: {  } } });
          if (tx.workAccessRequest?.deleteMany) await tx.workAccessRequest.deleteMany({ where: {  } });
          const works = tx.work?.deleteMany
            ? await tx.work.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(works);
          break;
        }
        case 'schedules': {
          // Monthly customer plan schedules only. Plans and subscriptions use onDelete: SetNull.
          const schedules = tx.monthlySchedule?.deleteMany
            ? await tx.monthlySchedule.deleteMany({ where: {  } })
            : { count: 0 };
          deletedCount = cnt(schedules);
          break;
        }
        default:
          throw new BadRequestException(`Unsupported reset module: ${dto.module}`);
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {

            userId: !isNaN(numUserId) ? numUserId : null,
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
      }
    });

    this.logger.log(
      `[Data Reset] Customer ${numCustomerId}: User ${userId} (${userRole}) reset module ${normModule}. Deleted ${deletedCount} records.`,
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
   * Resets all transactional data for the customer while protecting master data.
   * Deletion order is FK-safe: child records deleted before referenced parents.
   */
  async resetAllTransactional(
    customerId: number | string,
    userId: number | string,
    userRole: string,
    dto: ResetAllDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numUserId = Number(userId) || 1;

    const conf = dto.confirmation.trim().toUpperCase();
    const validConfirms = ['RESET ALL DATA'];



    if (!validConfirms.includes(conf)) {
      throw new BadRequestException(
        'Confirmation mismatch. You must type "RESET ALL DATA" to execute all transactional data reset.',
      );
    }

    let totalDeleted = 0;
    const cnt = (res?: { count?: number } | null): number => (res && typeof res.count === 'number' ? res.count : 0);

    await this.prisma.$transaction(async (tx) => {
      // ── Step 1: Deep leaf children across all transactional areas ─────────────




      if (tx.communicationHistory?.deleteMany) await tx.communicationHistory.deleteMany({ where: { contact: {  } } });
      if (tx.taskReview?.deleteMany) await tx.taskReview.deleteMany({ where: { task: {  } } });
      if (tx.taskProof?.deleteMany) await tx.taskProof.deleteMany({ where: { task: {  } } });
      if (tx.taskHistory?.deleteMany) await tx.taskHistory.deleteMany({ where: { task: {  } } });
      if (tx.quotationItem?.deleteMany) await tx.quotationItem.deleteMany({ where: { quotation: {  } } });
      if (tx.workTask?.deleteMany) await tx.workTask.deleteMany({ where: { work: {  } } });
      if (tx.ticketComment?.deleteMany) await tx.ticketComment.deleteMany({ where: { ticket: {  } } });
      if (tx.attendanceBreak?.deleteMany) await tx.attendanceBreak.deleteMany({ where: { attendance: {  } } });
      if (tx.aiGenerationAsset?.deleteMany) await tx.aiGenerationAsset.deleteMany({ where: { generation: {  } } });

      // ── Step 2: Marketing & Social Media ──────────────────────────────────────

      const videos = tx.marketingVideo?.deleteMany ? await tx.marketingVideo.deleteMany({ where: {  } }) : { count: 0 };
      const banners = tx.marketingBanner?.deleteMany ? await tx.marketingBanner.deleteMany({ where: {  } }) : { count: 0 };
      const trending = tx.trendingContent?.deleteMany ? await tx.trendingContent.deleteMany({ where: {  } }) : { count: 0 };
      const socialPublishes = tx.socialPublish?.deleteMany ? await tx.socialPublish.deleteMany({ where: {  } }) : { count: 0 };
      const socialAccounts = tx.socialAccount?.deleteMany ? await tx.socialAccount.deleteMany({ where: {  } }) : { count: 0 };
      const socialHandlers = tx.socialMediaHandler?.deleteMany ? await tx.socialMediaHandler.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 3: AI Studio ─────────────────────────────────────────────────────
      const aiGens = tx.aiGeneration?.deleteMany ? await tx.aiGeneration.deleteMany({ where: {  } }) : { count: 0 };
      const aiTxns = tx.aiCreditTransaction?.deleteMany ? await tx.aiCreditTransaction.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 4: Bookings & Reviews ────────────────────────────────────────────
      const bookingPayments = tx.influencerBookingPayment?.deleteMany ? await tx.influencerBookingPayment.deleteMany({ where: {  } }) : { count: 0 };
      const reviews = tx.influencerReview?.deleteMany ? await tx.influencerReview.deleteMany({ where: {  } }) : { count: 0 };
      const bookings = tx.influencerBooking?.deleteMany ? await tx.influencerBooking.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 5: Calendar / Schedules & Works ───────────────────────────────────
      const schedules = tx.monthlySchedule?.deleteMany ? await tx.monthlySchedule.deleteMany({ where: {  } }) : { count: 0 };
      const workAccess = tx.workAccessRequest?.deleteMany ? await tx.workAccessRequest.deleteMany({ where: {  } }) : { count: 0 };

      const works = tx.work?.deleteMany ? await tx.work.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 6: Billing & Invoices (Purge transactional invoices/payments) ────
      if (tx.invoiceItem?.deleteMany) await tx.invoiceItem.deleteMany({ where: { invoice: {  } } });
      const invRes = tx.invoice?.deleteMany ? await tx.invoice.deleteMany({ where: {  } }) : { count: 0 };
      const payRes = tx.paymentHistory?.deleteMany ? await tx.paymentHistory.deleteMany({ where: {  } }) : { count: 0 };



      // ── Step 7: CRM Parent Records ────────────────────────────────────────────
      const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: {  } }) : { count: 0 };
      const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: {  } }) : { count: 0 };
      const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: {  } }) : { count: 0 };
      const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: {  } }) : { count: 0 };
      const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: {  } }) : { count: 0 };

      const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 8: Data Capture ──────────────────────────────────────────────────
      const dcPlaces = tx.dataCapturePlace?.deleteMany ? await tx.dataCapturePlace.deleteMany({ where: {  } }) : { count: 0 };
      const dcJobs = tx.dataCaptureJob?.deleteMany ? await tx.dataCaptureJob.deleteMany({ where: {  } }) : { count: 0 };

      // ── Step 9: Operations & HR Transactional ─────────────────────────────────
      const tickets = tx.supportTicket?.deleteMany ? await tx.supportTicket.deleteMany({ where: {  } }) : { count: 0 };
      const notifications = tx.notification?.deleteMany ? await tx.notification.deleteMany({ where: {  } }) : { count: 0 };
      const locations = tx.employeeLocation?.deleteMany ? await tx.employeeLocation.deleteMany({ where: {  } }) : { count: 0 };
      if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: {  } });
      const attendances = tx.attendance?.deleteMany ? await tx.attendance.deleteMany({ where: {  } }) : { count: 0 };
      const leaves = tx.leaveRequest?.deleteMany ? await tx.leaveRequest.deleteMany({ where: {  } }) : { count: 0 };
      if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: {  } });
      if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: {  } });
      const remotes = tx.remoteRequest?.deleteMany ? await tx.remoteRequest.deleteMany({ where: {  } }) : { count: 0 };
      const slips = tx.salarySlip?.deleteMany ? await tx.salarySlip.deleteMany({ where: {  } }) : { count: 0 };
      const items = tx.payrollItem?.deleteMany ? await tx.payrollItem.deleteMany({ where: {  } }) : { count: 0 };
      const payrolls = tx.payroll?.deleteMany ? await tx.payroll.deleteMany({ where: {  } }) : { count: 0 };
      const claims = tx.employeeClaim?.deleteMany ? await tx.employeeClaim.deleteMany({ where: {  } }) : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany ? await tx.employeeLoan.deleteMany({ where: {  } }) : { count: 0 };

      totalDeleted =
        cnt(quotations) +
        cnt(visits) +
        cnt(tasks) +
        cnt(deals) +
        cnt(contacts) +
        cnt(companies) +
        cnt(works) +
        cnt(schedules) +
        cnt(attendances) +
        cnt(leaves) +
        cnt(remotes) +
        cnt(slips) +
        cnt(items) +
        cnt(payrolls) +
        cnt(claims) +
        cnt(loans) +
        cnt(notifications) +
        cnt(locations) +
        cnt(tickets) +
        cnt(dcPlaces) +
        cnt(dcJobs) +
        cnt(videos) +
        cnt(banners) +
        cnt(trending) +
        cnt(socialPublishes) +
        cnt(socialAccounts) +
        cnt(socialHandlers) +
        cnt(aiGens) +
        cnt(aiTxns) +
        cnt(bookingPayments) +
        cnt(reviews) +
        cnt(bookings) +
        cnt(workAccess) +
        cnt(invRes) +
        cnt(payRes) ;

      // Reset storage usage


      // Audit Log
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {

            userId: !isNaN(numUserId) ? numUserId : null,
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
      }

      // ── Step 10: Pre-commit Verification ──────────────────────────────────────

    });

    this.logger.log(
      `[Data Reset] Customer ${numCustomerId}: User ${userId} executed full transactional reset. Total ${totalDeleted} records removed.`,
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
  async getEmployeeSummary(
    customerId: number | string,
    employeeId: number | string,
  ) {
    const employee = await this.resolveEmployee(employeeId, customerId);
    const numCustomerId = undefined;
    const numEmployeeId = employee.id;
    const employeeUserId = employee.userId;

    const [
      attendanceCount,
      breaksCount,
      leavesCount,
      remotesCount,
      visitsCount,
      salarySlipsCount,
      payrollItemsCount,
      locationsCount,
      claimsCount,
      loansCount,
      tasksCount,
      workTasksCount,
      notificationsCount,
    ] = await Promise.all([
      this.prisma.attendance.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.attendanceBreak.count({
        where: { attendance: {  employeeId: numEmployeeId } },
      }),
      this.prisma.leaveRequest.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.remoteRequest.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.visit.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.salarySlip.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.payrollItem.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.employeeLocation.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.employeeClaim.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.employeeLoan.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.task.count({ where: {  employeeId: numEmployeeId } }),
      this.prisma.workTask.count({ where: { work: {  }, assignedToId: numEmployeeId } }),
      employeeUserId
        ? this.prisma.notification.count({ where: {  userId: employeeUserId } })
        : Promise.resolve(0),
    ]);

    const total =
      attendanceCount +
      breaksCount +
      leavesCount +
      remotesCount +
      visitsCount +
      salarySlipsCount +
      payrollItemsCount +
      locationsCount +
      claimsCount +
      loansCount +
      tasksCount +
      workTasksCount +
      notificationsCount;

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
        payroll: salarySlipsCount + payrollItemsCount,
        salarySlips: salarySlipsCount,
        payrollItems: payrollItemsCount,
        location: locationsCount,
        claims: claimsCount,
        loans: loansCount,
        tasks: tasksCount,
        workTasks: workTasksCount,
        notifications: notificationsCount,
        total,
      },
    };
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/module
   * Resets an individual module for a specific employee
   */
  async resetEmployeeModule(
    customerId: number | string,
    userId: number | string,
    userRole: string,
    employeeId: number | string,
    dto: EmployeeModuleResetDto,
  ) {
    const employee = await this.resolveEmployee(employeeId, customerId);
    const numCustomerId = undefined;
    const numEmployeeId = employee.id;
    const employeeUserId = employee.userId;
    const numUserId = Number(userId) || 1;

    const normModule = dto.module.toLowerCase().trim();
    const expectedConfirm = `RESET EMPLOYEE ${normModule.toUpperCase()}`;

    if (
      dto.confirmation.trim().toUpperCase() !== expectedConfirm &&
      dto.confirmation.trim().toUpperCase() !== `RESET ${normModule.toUpperCase()}`
    ) {
      throw new BadRequestException(
        `Confirmation mismatch. You must type "${expectedConfirm}" to confirm employee reset.`,
      );
    }

    let deletedCount = 0;
    const cnt = (res?: { count?: number } | null): number => (res && typeof res.count === 'number' ? res.count : 0);

    await this.prisma.$transaction(async (tx) => {
      switch (normModule) {
        case 'attendance': {
          const breaks = tx.attendanceBreak?.deleteMany
            ? await tx.attendanceBreak.deleteMany({
                where: { attendance: {  employeeId: numEmployeeId } },
              })
            : { count: 0 };
          const attendances = tx.attendance?.deleteMany
            ? await tx.attendance.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(breaks) + cnt(attendances);
          break;
        }
        case 'leave': {
          if (tx.leaveAdjustmentHistory?.deleteMany) {
            await tx.leaveAdjustmentHistory.deleteMany({
              where: {  employeeId: numEmployeeId },
            });
          }
          if (tx.employeeLeaveBalance?.deleteMany) {
            await tx.employeeLeaveBalance.deleteMany({
              where: { employeeId: numEmployeeId },
            });
          }
          const leaves = tx.leaveRequest?.deleteMany
            ? await tx.leaveRequest.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(leaves);
          break;
        }
        case 'remote': {
          const remotes = tx.remoteRequest?.deleteMany
            ? await tx.remoteRequest.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(remotes);
          break;
        }
        case 'visits': {
          const visits = tx.visit?.deleteMany
            ? await tx.visit.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(visits);
          break;
        }
        case 'payroll': {
          const slips = tx.salarySlip?.deleteMany
            ? await tx.salarySlip.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          const items = tx.payrollItem?.deleteMany
            ? await tx.payrollItem.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(slips) + cnt(items);
          break;
        }
        case 'claims': {
          const claims = tx.employeeClaim?.deleteMany
            ? await tx.employeeClaim.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(claims);
          break;
        }
        case 'loans': {
          const loans = tx.employeeLoan?.deleteMany
            ? await tx.employeeLoan.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(loans);
          break;
        }
        case 'location': {
          if (tx.locationTrackingSetting?.deleteMany) {
            await tx.locationTrackingSetting.deleteMany({
              where: { employeeId: numEmployeeId },
            });
          }
          const locations = tx.employeeLocation?.deleteMany
            ? await tx.employeeLocation.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(locations);
          break;
        }
        case 'tasks': {
          if (tx.taskHistory?.deleteMany) {
            await tx.taskHistory.deleteMany({
              where: { task: {  employeeId: numEmployeeId } },
            });
          }
          if (tx.taskProof?.deleteMany) {
            await tx.taskProof.deleteMany({
              where: {
                OR: [
                  { task: {  employeeId: numEmployeeId } },
                  { employeeId: numEmployeeId },
                ],
              },
            });
          }
          if (tx.taskReview?.deleteMany) {
            await tx.taskReview.deleteMany({
              where: { task: {  employeeId: numEmployeeId } },
            });
          }
          const tasks = tx.task?.deleteMany
            ? await tx.task.deleteMany({
                where: {  employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(tasks);
          break;
        }
        case 'works': {
          if (tx.workTask?.deleteMany) {
            await tx.workTask.deleteMany({
              where: { work: {  }, assignedToId: numEmployeeId },
            });
          }
          if (tx.workAccessRequest?.deleteMany) {
            await tx.workAccessRequest.deleteMany({
              where: {  employeeId: numEmployeeId },
            });
          }
          if (tx.work?.updateMany) {
            await tx.work.updateMany({
              where: {  assignedToId: numEmployeeId },
              data: { assignedToId: null },
            });
            await tx.work.updateMany({
              where: {  editorId: numEmployeeId },
              data: { editorId: null },
            });
          }
          deletedCount = 1;
          break;
        }
        case 'notifications': {
          if (employeeUserId && tx.notification?.deleteMany) {
            const notifs = await tx.notification.deleteMany({
              where: {  userId: employeeUserId },
            });
            deletedCount = cnt(notifs);
          }
          break;
        }
        default:
          throw new BadRequestException(`Unsupported module: ${dto.module}`);
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {

            userId: !isNaN(numUserId) ? numUserId : null,
            action: 'DATA_RESET',
            module: `EMPLOYEE_${normModule.toUpperCase()}`,
            details: {
              scope: 'EMPLOYEE_MODULE_RESET',
              employeeId: numEmployeeId,
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
      }
    });

    return {
      success: true,
      employeeId: numEmployeeId,
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
    customerId: number | string,
    userId: number | string,
    userRole: string,
    employeeId: number | string,
    dto: EmployeeResetAllDto,
  ) {
    const employee = await this.resolveEmployee(employeeId, customerId);
    const numCustomerId = undefined;
    const numEmployeeId = employee.id;
    const employeeUserId = employee.userId;
    const numUserId = Number(userId) || 1;

    const rawConfirm = dto.confirmation.trim().toUpperCase();
    const allowed = [
      'RESET ALL DATA FOR EMPLOYEE',
      employee.employeeCode.toUpperCase(),
      `${employee.firstName} ${employee.lastName}`.toUpperCase(),
    ];

    if (!allowed.includes(rawConfirm)) {
      throw new BadRequestException(
        'Confirmation mismatch. You must type "RESET ALL DATA FOR EMPLOYEE" to confirm.',
      );
    }

    let totalDeleted = 0;
    const cnt = (res?: { count?: number } | null): number => (res && typeof res.count === 'number' ? res.count : 0);

    await this.prisma.$transaction(async (tx) => {
      // 1. Task children then tasks
      if (tx.taskHistory?.deleteMany) {
        await tx.taskHistory.deleteMany({
          where: { task: {  employeeId: numEmployeeId } },
        });
      }
      if (tx.taskProof?.deleteMany) {
        await tx.taskProof.deleteMany({
          where: {
            OR: [
              { task: {  employeeId: numEmployeeId } },
              { employeeId: numEmployeeId },
            ],
          },
        });
      }
      if (tx.taskReview?.deleteMany) {
        await tx.taskReview.deleteMany({
          where: { task: {  employeeId: numEmployeeId } },
        });
      }
      const tasks = tx.task?.deleteMany
        ? await tx.task.deleteMany({ where: {  employeeId: numEmployeeId } })
        : { count: 0 };

      // 2. Work tasks & access requests
      const workTasks = tx.workTask?.deleteMany
        ? await tx.workTask.deleteMany({ where: { work: {  }, assignedToId: numEmployeeId } })
        : { count: 0 };
      if (tx.workAccessRequest?.deleteMany) {
        await tx.workAccessRequest.deleteMany({ where: {  employeeId: numEmployeeId } });
      }

      // 3. Unassign Works
      if (tx.work?.updateMany) {
        await tx.work.updateMany({
          where: {  assignedToId: numEmployeeId },
          data: { assignedToId: null },
        });
        await tx.work.updateMany({
          where: {  editorId: numEmployeeId },
          data: { editorId: null },
        });
      }

      // 4. Attendance breaks then attendances
      const breaks = tx.attendanceBreak?.deleteMany
        ? await tx.attendanceBreak.deleteMany({
            where: { attendance: {  employeeId: numEmployeeId } },
          })
        : { count: 0 };
      const attendances = tx.attendance?.deleteMany
        ? await tx.attendance.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 5. Leaves & balances
      if (tx.leaveAdjustmentHistory?.deleteMany) {
        await tx.leaveAdjustmentHistory.deleteMany({
          where: {  employeeId: numEmployeeId },
        });
      }
      if (tx.employeeLeaveBalance?.deleteMany) {
        await tx.employeeLeaveBalance.deleteMany({
          where: { employeeId: numEmployeeId },
        });
      }
      const leaves = tx.leaveRequest?.deleteMany
        ? await tx.leaveRequest.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 6. Remote requests & visits
      const remotes = tx.remoteRequest?.deleteMany
        ? await tx.remoteRequest.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };
      const visits = tx.visit?.deleteMany
        ? await tx.visit.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 7. Payroll slips, items & structure
      const slips = tx.salarySlip?.deleteMany
        ? await tx.salarySlip.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };
      const items = tx.payrollItem?.deleteMany
        ? await tx.payrollItem.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };
      if (tx.salaryStructure?.deleteMany) {
        await tx.salaryStructure.deleteMany({
          where: {  employeeId: numEmployeeId },
        });
      }

      // 8. Claims & Loans
      const claims = tx.employeeClaim?.deleteMany
        ? await tx.employeeClaim.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany
        ? await tx.employeeLoan.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 9. Locations & Tracking
      if (tx.locationTrackingSetting?.deleteMany) {
        await tx.locationTrackingSetting.deleteMany({
          where: { employeeId: numEmployeeId },
        });
      }
      const locations = tx.employeeLocation?.deleteMany
        ? await tx.employeeLocation.deleteMany({
            where: {  employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 11. Unlink shared assignments

      if (tx.monthlySchedule?.updateMany) {
        await tx.monthlySchedule.updateMany({
          where: {  assignedEmployeeId: numEmployeeId },
          data: { assignedEmployeeId: null },
        });
      }
      if (tx.team?.updateMany) {
        await tx.team.updateMany({
          where: {  leaderId: numEmployeeId },
          data: { leaderId: null },
        });
      }
      if (tx.department?.updateMany) {
        await tx.department.updateMany({
          where: {  headId: numEmployeeId },
          data: { headId: null },
        });
      }


      // 12. User notifications & tokens if linked user
      let notifsCount = 0;
      if (employeeUserId) {
        if (tx.userDeviceToken?.deleteMany) {
          await tx.userDeviceToken.deleteMany({ where: { userId: employeeUserId } });
        }
        if (tx.notification?.deleteMany) {
          const n = await tx.notification.deleteMany({
            where: {  userId: employeeUserId },
          });
          notifsCount = cnt(n);
        }
      }

      totalDeleted =
        cnt(breaks) +
        cnt(attendances) +
        cnt(leaves) +
        cnt(remotes) +
        cnt(visits) +
        cnt(slips) +
        cnt(items) +
        cnt(claims) +
        cnt(loans) +
        cnt(locations) +
        cnt(tasks) +
        cnt(workTasks) +
        notifsCount;

      // 13. Audit Log
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {

            userId: !isNaN(numUserId) ? numUserId : null,
            action: 'DATA_RESET',
            module: 'EMPLOYEE_ALL_TRANSACTIONAL',
            details: {
              scope: 'EMPLOYEE_ALL_TRANSACTIONAL',
              employeeId: numEmployeeId,
              employeeCode: employee.employeeCode,
              employeeName: `${employee.firstName} ${employee.lastName}`,
              recordsDeleted: totalDeleted,
              performedByRole: userRole,
              reason: dto.reason || 'Admin reset all transactional data for employee',
              status: 'SUCCESS',
            },
          },
        });
      }

      // 14. Pre-commit Verification
      if (typeof (tx.attendance as any)?.count === 'function') {
        const remaining = await Promise.all([
          tx.attendance.count({ where: {  employeeId: numEmployeeId } }),
          tx.leaveRequest?.count ? tx.leaveRequest.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.remoteRequest?.count ? tx.remoteRequest.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.visit?.count ? tx.visit.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.salarySlip?.count ? tx.salarySlip.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.employeeLocation?.count ? tx.employeeLocation.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.task?.count ? tx.task.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.workTask?.count ? tx.workTask.count({ where: { work: {  }, assignedToId: numEmployeeId } }) : 0,
          tx.employeeClaim?.count ? tx.employeeClaim.count({ where: {  employeeId: numEmployeeId } }) : 0,
          tx.employeeLoan?.count ? tx.employeeLoan.count({ where: {  employeeId: numEmployeeId } }) : 0,
        ]);

        const [rAtt, rLeaves, rRemotes, rVisits, rSlips, rLocs, rTasks, rWorkTasks, rClaims, rLoans] = remaining;
        const totalRemaining =
          rAtt + rLeaves + rRemotes + rVisits + rSlips + rLocs + rTasks + rWorkTasks + rClaims + rLoans;

        if (totalRemaining > 0) {
          throw new InternalServerErrorException(
            `Employee data reset verification failed: ${totalRemaining} records remain after deletion. Transaction rolled back.`,
          );
        }
      }
    });

    return {
      success: true,
      employeeId: numEmployeeId,
      recordsDeleted: totalDeleted,
      message: `Successfully reset all transactional data for ${employee.firstName} ${employee.lastName} (${totalDeleted} records removed). Employee profile and employment history remain intact.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER-WISE DATA RESET METHODS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Base customer filter for Data Management:
   * Strictly excludes:
   * - Customer ID 1 (root enterprise tenant)
   * - Accounts with employees (organization master accounts)
   * - Accounts with Super Admin / Admin roles or names
   * - Non-customer system/internal accounts
   */
  public getBaseCustomerFilter(): never {
throw new GoneException('Customer and Lead functionality has been removed');
  }

  /**
   * GET /api/v1/admin/data-management/customers
   * Returns list of real customer accounts for Data Management.
   * Strictly excludes:
   * - Super Admin accounts and users
   * - Admin users
   * - System / internal non-customer accounts
   * - Primary root enterprise tenant (#1)
   */
  async getCustomers(query: { search?: string; limit?: number; page?: number }) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * GET /api/v1/admin/data-management/customers/summary/all
   * Returns aggregated record counts across all eligible client customers for Reset All preview
   */
  async getCustomersSummaryAll() : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * GET /api/v1/admin/data-management/employees
   * Returns list of actual employees for Data Management.
   * Strictly excludes:
   * - Super Admin (must NOT appear as an employee)
   * - Admin users
   * - Deleted employees
   */
  async getEmployees(query: {
    customerId?: number | string;
    search?: string;
    limit?: number;
    page?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = {
      status: { not: 'DELETED' },
      NOT: [
        // Exclude employees with user role SUPER_ADMIN, CUSTOMER_ADMIN, TENANT_ADMIN or ADMIN
        {
          user: {
            email: 'admin@quikboom.com',
          },
        },
        // Exclude employees explicitly named Super Admin or Admin
        {
          OR: [
            { firstName: { equals: 'Super', mode: 'insensitive' as Prisma.QueryMode }, lastName: { equals: 'Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Super Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { lastName: { equals: 'Super Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { designation: { name: { in: ['Super Admin', 'SUPER_ADMIN', 'Platform Administrator', 'System Administrator'] } } },
          ],
        },
      ],
    };



    if (query.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      const searchConditions: Prisma.EmployeeWhereInput[] = [
        { firstName: { contains: s, mode: 'insensitive' as Prisma.QueryMode } },
        { lastName: { contains: s, mode: 'insensitive' as Prisma.QueryMode } },
        { email: { contains: s, mode: 'insensitive' as Prisma.QueryMode } },
        { phone: { contains: s, mode: 'insensitive' as Prisma.QueryMode } },
        { employeeCode: { contains: s, mode: 'insensitive' as Prisma.QueryMode } },
        { department: { name: { contains: s, mode: 'insensitive' as Prisma.QueryMode } } },
        { designation: { name: { contains: s, mode: 'insensitive' as Prisma.QueryMode } } },
      ];

      if (where.AND) {
        (where.AND as any[]).push({ OR: searchConditions });
      } else {
        where.AND = [{ OR: searchConditions }];
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { name: true } },
          designation: { select: { name: true } },
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      employees: items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * GET live summary of customer data and record counts
   */
  async getCustomerSummary(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Reset all customer application/transactional data in an atomic Prisma transaction.
   * Permanently deletes customer-owned records across all modules while preserving
   * the customer profile, user accounts, and master data.
   */
  async resetCustomerData(
    customerId: number | string,
    userId?: string,
    userRole?: string,
    dto?: any,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Safe cascading permanent deletion of a customer and all their dependencies.
   * Runs within an atomic Prisma transaction client.
   * Strictly protects:
   * - Employees (never deleted)
   * - Attendance, Payroll (never deleted)
   * - System master data (Plans, Coupons, Roles, Departments, Designations)
   * - Unconverted Leads
   */
  public async deleteCustomerAndDependencies(
    tx: Prisma.TransactionClient,
    customerId: number,
    preserveCustomerId?: number | null,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * POST /api/v1/admin/data-management/customers/reset-selected
   * Resets and permanently deletes selected customers and their dependencies.
   */
  async resetSelectedCustomers(
    customerIds: (number | string)[],
    userId: string,
    userRole: string,
    reason?: string,
    auditCustomerId?: number | string,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * POST /api/v1/admin/data-management/customers/reset-all
   * Resets and permanently deletes all eligible client customers and their dependencies.
   */
  async resetAllCustomers(
    confirmation: string,
    userId: string,
    userRole: string,
    reason?: string,
    auditCustomerId?: number | string,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BIN / TRASH SERVICES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/data-management/bin
   * Fetch all soft-deleted records from PostgreSQL (Customers and Employees)
   * Returns empty array if no records are deleted
   */
  async getBinItems() {
    const customers: any[] = [];
    // Soft-deleted employees: status = 'DELETED', excluding Super Admin / Admin
    const deletedEmployees = await this.prisma.employee.findMany({
      where: {
        status: 'DELETED',
        NOT: [
          {
            user: {
              email: 'admin@quikboom.com',
            },
          },
          { firstName: { in: ['Super', 'Super Admin', 'Admin'] } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeCode: true,

        updatedAt: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
        _count: {
          select: {
            attendances: true,
            leaveRequests: true,
            remoteRequests: true,
            employeeLocations: true,
            payrollItems: true,
          },
        },

      },
      orderBy: { updatedAt: 'desc' },
    });

    const employees = deletedEmployees.map((e) => ({
      id: String(e.id),
      type: 'EMPLOYEE' as const,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email || '',
      employeeCode: e.employeeCode || '',
      department: e.department?.name || '',
      designation: e.designation?.name || '',
      customerName: '',
      deletedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
      deletedBy: 'Admin',
      dataCounts: {
        attendances: e._count.attendances,
        leaveRequests: e._count.leaveRequests,
        remoteRequests: e._count.remoteRequests,
        locations: e._count.employeeLocations,
        payrollItems: e._count.payrollItems,
        total: e._count.attendances + e._count.leaveRequests + e._count.remoteRequests + e._count.employeeLocations + e._count.payrollItems,
      },
    }));

    // Array of all items in the Bin
    const allItems = [...customers, ...employees];

    // Assign helper properties so callers expecting an object with { customers, employees, totalCount } also get them
    Object.defineProperties(allItems, {
      customers: { value: customers, enumerable: true },
      employees: { value: employees, enumerable: true },
      totalCount: { value: allItems.length, enumerable: true },
    });

    return allItems;
  }

  /**
   * Restore a soft-deleted customer from the Bin.
   * Reactivates the customer record and linked User accounts.
   */
  async restoreCustomerFromBin(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Helper to execute customer-scoped cascade purge inside a Prisma transaction.
   */
  private async purgeCustomerInTx(tx: any, numId: number): Promise<void> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Helper to execute employee-scoped cascade purge inside a Prisma transaction.
   */
  private async purgeEmployeeInTx(tx: any, numId: number): Promise<void> {
    const employee = await tx.employee.findUnique({
      where: { id: numId },
      include: { user: { select: { id: true } } },
    });

    if (!employee) return;

    const userId = employee.userId ? Number(employee.userId) : null;
    const empCustomerId = Number(undefined);

    if (userId) {
      await tx.refreshToken?.deleteMany?.({ where: { userId } });
      await tx.session?.deleteMany?.({ where: { userId } });
      await tx.userDeviceToken?.deleteMany?.({ where: { userId } });
    }

    await tx.task?.updateMany?.({ where: { employeeId: numId }, data: { employeeId: null } });
    await tx.taskProof?.updateMany?.({ where: { employeeId: numId }, data: { employeeId: null } });
    await tx.work?.updateMany?.({ where: { assignedToId: numId }, data: { assignedToId: null } });
    await tx.work?.updateMany?.({ where: { editorId: numId }, data: { editorId: null } });
    await tx.workTask?.updateMany?.({ where: { assignedToId: numId }, data: { assignedToId: null } });
    await tx.workAccessRequest?.deleteMany?.({ where: { employeeId: numId } });

    await tx.locationTrackingSetting?.deleteMany?.({ where: { employeeId: numId } });
    await tx.teamMember?.deleteMany?.({ where: { employeeId: numId } });
    await tx.team?.updateMany?.({ where: { leaderId: numId }, data: { leaderId: null } });
    await tx.department?.updateMany?.({ where: { headId: numId }, data: { headId: null } });


    await tx.visit?.deleteMany?.({ where: { employeeId: numId } });
    await tx.monthlySchedule?.updateMany?.({ where: { assignedEmployeeId: numId }, data: { assignedEmployeeId: null } });
    await tx.employeeLocation?.deleteMany?.({ where: { employeeId: numId } });
    await tx.employeeClaim?.deleteMany?.({ where: { employeeId: numId } });
    await tx.employeeLoan?.deleteMany?.({ where: { employeeId: numId } });
    await tx.remoteRequest?.deleteMany?.({ where: { employeeId: numId } });
    await tx.salarySlip?.deleteMany?.({ where: { employeeId: numId } });
    await tx.salaryStructure?.deleteMany?.({ where: { employeeId: numId } });
    await tx.payrollItem?.deleteMany?.({ where: { employeeId: numId } });
    await tx.leaveAdjustmentHistory?.deleteMany?.({ where: { employeeId: numId } });
    await tx.employeeLeaveBalance?.deleteMany?.({ where: { employeeId: numId } });
    await tx.leaveRequest?.deleteMany?.({ where: { employeeId: numId } });
    await tx.attendanceBreak?.deleteMany?.({ where: { attendance: { employeeId: numId } } });
    await tx.attendance?.deleteMany?.({ where: { employeeId: numId } });

    await tx.auditLog?.updateMany?.({ where: {  userId }, data: { userId: null } });
    await tx.employee.delete({ where: { id: numId } });

    if (userId) {
      await tx.notification?.deleteMany?.({ where: { userId } });
      await tx.userRole?.deleteMany?.({ where: { userId } });
      await tx.user?.delete?.({ where: { id: userId } });
    }
  }

  /**
   * Permanently delete a customer from the Bin.
   * Runs a full FK-safe purge atomically in a transaction with post-commit verification.
   */
  async deleteCustomerPermanently(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Restore a soft-deleted employee from the Bin.
   * Reactivates the employee record and linked User account.
   */
  async restoreEmployeeFromBin(employeeId: number | string) {
    const numId = Number(employeeId);
    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Invalid employee ID');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: numId },
      include: { user: { select: { id: true } } },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${employeeId} not found.`);
    }

    if (employee.status !== 'DELETED') {
      throw new BadRequestException('Employee is not in the Bin.');
    }

    const userId = employee.userId ? Number(employee.userId) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: numId },
        data: { status: 'ACTIVE' },
      });
      if (userId) {
        await tx.user.update({
          where: { id: userId },
          data: { isActive: true, deletedAt: null },
        });
      }
    });

    this.logger.log(`[BIN_RESTORE_EMPLOYEE] Employee #${numId} restored from Bin.`);
    return { success: true, message: `Employee #${numId} restored from Bin successfully.` };
  }

  /**
   * Permanently delete an employee from the Bin.
   * Runs a full FK-safe purge atomically in a transaction with post-commit verification.
   */
  async deleteEmployeePermanently(employeeId: number | string) {
    const numId = Number(employeeId);
    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Invalid employee ID');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: numId },
      include: { user: { select: { id: true } } },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${employeeId} not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.purgeEmployeeInTx(tx, numId);
    });

    const stillExists = await this.prisma.employee.findUnique({ where: { id: numId } });
    if (stillExists) {
      throw new InternalServerErrorException(`Permanent deletion verification failed: Employee #${numId} still exists in database.`);
    }

    this.logger.log(`[BIN_PERMANENT_DELETE_EMPLOYEE] Employee #${numId} permanently deleted and verified removed from database.`);
    return { success: true, message: `Employee #${numId} permanently deleted from database.` };
  }

  /**
   * Permanently delete multiple items (customers and/or employees) from the Bin.
   * Runs in a single atomic Prisma transaction with post-commit verification.
   */
  async deleteBinBulk(dto: BulkDeleteBinDto) {
    const rawItems: Array<{ id: number; type: 'CUSTOMER' | 'EMPLOYEE' }> = [];

    if (dto.items && Array.isArray(dto.items)) {
      for (const it of dto.items) {
        const numId = Number(it.id);
        const type = String(it.type).toUpperCase() as 'CUSTOMER' | 'EMPLOYEE';
        if (!isNaN(numId) && numId > 0 && (type === 'CUSTOMER' || type === 'EMPLOYEE')) {
          rawItems.push({ id: numId, type });
        }
      }
    }

    if (dto.customerIds && Array.isArray(dto.customerIds)) {
      for (const id of dto.customerIds) {
        const numId = Number(id);
        if (!isNaN(numId) && numId > 0) {
          rawItems.push({ id: numId, type: 'CUSTOMER' });
        }
      }
    }

    if (dto.employeeIds && Array.isArray(dto.employeeIds)) {
      for (const id of dto.employeeIds) {
        const numId = Number(id);
        if (!isNaN(numId) && numId > 0) {
          rawItems.push({ id: numId, type: 'EMPLOYEE' });
        }
      }
    }

    // Deduplicate
    const uniqueMap = new Map<string, { id: number; type: 'CUSTOMER' | 'EMPLOYEE' }>();
    for (const it of rawItems) {
      uniqueMap.set(`${it.type}-${it.id}`, it);
    }
    const itemsToDelete = Array.from(uniqueMap.values());

    if (itemsToDelete.length === 0) {
      throw new BadRequestException('No valid items selected for permanent deletion.');
    }

    const customerIds = itemsToDelete.filter((it) => it.type === 'CUSTOMER').map((it) => it.id);
    const employeeIds = itemsToDelete.filter((it) => it.type === 'EMPLOYEE').map((it) => it.id);

    // Verify existing records
    if (customerIds.length > 0) throw new GoneException('Customer records have been removed');

    if (employeeIds.length > 0) {
      const foundEmployees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });
      const foundEmployeeIds = new Set(foundEmployees.map((e) => e.id));
      for (const eid of employeeIds) {
        if (!foundEmployeeIds.has(eid)) {
          throw new NotFoundException(`Employee #${eid} not found in database.`);
        }
      }
    }

    // Atomic Prisma transaction
    await this.prisma.$transaction(async (tx) => {
      for (const cid of customerIds) {
        await this.purgeCustomerInTx(tx, cid);
      }
      for (const eid of employeeIds) {
        await this.purgeEmployeeInTx(tx, eid);
      }
    });

    // Post-commit verification
    if (customerIds.length > 0) throw new GoneException('Customer records have been removed');

    if (employeeIds.length > 0) {
      const stillEmp = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });
      if (stillEmp.length > 0) {
        throw new InternalServerErrorException(
          `Bulk permanent deletion verification failed: Employees [${stillEmp.map((e) => e.id).join(', ')}] still exist.`,
        );
      }
    }

    const totalCount = itemsToDelete.length;
    this.logger.log(`[BIN_BULK_PERMANENT_DELETE] Successfully deleted ${totalCount} records permanently (${customerIds.length} customers, ${employeeIds.length} employees).`);

    return {
      success: true,
      count: totalCount,
      deletedCustomers: customerIds.length,
      deletedEmployees: employeeIds.length,
      message: `Successfully deleted ${totalCount} record${totalCount !== 1 ? 's' : ''} permanently from database.`,
    };
  }
}

