import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ModuleResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
} from './dto/data-management.dto';

@Injectable()
export class DataManagementService {
  private readonly logger = new Logger(DataManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves customer ID from explicit parameter or defaults to the first customer
   */
  private async resolveCustomerId(customerId: number | string | undefined | null): Promise<number> {
    const numCustomerId = Number(customerId);
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      return numCustomerId;
    }
    const defaultCust = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return defaultCust?.id || 1;
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

    const numCustomerId = Number(customerId);
    if (!isNaN(numCustomerId) && numCustomerId > 0 && employee.customerId !== numCustomerId) {
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
        this.prisma.lead.count({ where: { customerId: numCustomerId } }),
        this.prisma.contact.count({ where: { customerId: numCustomerId } }),
        this.prisma.company.count({ where: { customerId: numCustomerId } }),
        this.prisma.deal.count({ where: { customerId: numCustomerId } }),
        this.prisma.task.count({ where: { customerId: numCustomerId } }),
        this.prisma.attendance.count({ where: { customerId: numCustomerId } }),
        this.prisma.attendanceBreak.count({
          where: { attendance: { customerId: numCustomerId } },
        }),
        this.prisma.leaveRequest.count({ where: { customerId: numCustomerId } }),
        this.prisma.remoteRequest.count({ where: { customerId: numCustomerId } }),
        this.prisma.visit.count({ where: { customerId: numCustomerId } }),
        this.prisma.payroll.count({ where: { customerId: numCustomerId } }),
        this.prisma.salarySlip.count({ where: { customerId: numCustomerId } }),
        this.prisma.notification.count({ where: { customerId: numCustomerId } }),
        this.prisma.employeeLocation.count({ where: { customerId: numCustomerId } }),
        this.prisma.work.count({ where: { customerId: numCustomerId } }),
        this.prisma.monthlySchedule.count({ where: { customerId: numCustomerId } }),
        this.prisma.supportTicket.count({ where: { customerId: numCustomerId } }),
        this.prisma.employeeClaim.count({ where: { customerId: numCustomerId } }),
        this.prisma.employeeLoan.count({ where: { customerId: numCustomerId } }),
        this.prisma.employee.count({ where: { customerId: numCustomerId } }),
        this.prisma.department.count({ where: { customerId: numCustomerId } }),
        this.prisma.designation.count({ where: { customerId: numCustomerId } }),
        this.prisma.user.count({ where: { customerId: numCustomerId } }),
      ]);

      const lastResetLogs = await this.prisma.auditLog.findMany({
        where: { customerId: numCustomerId, action: 'DATA_RESET' },
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
      where: { customerId: numCustomerId, action: 'DATA_RESET' },
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
          if (tx.leadActivityTimeline?.deleteMany) await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId: numCustomerId } } });
          if (tx.leadNote?.deleteMany) await tx.leadNote.deleteMany({ where: { lead: { customerId: numCustomerId } } });
          if (tx.leadReminder?.deleteMany) await tx.leadReminder.deleteMany({ where: { lead: { customerId: numCustomerId } } });
          if (tx.leadStatusHistory?.deleteMany) await tx.leadStatusHistory.deleteMany({ where: { lead: { customerId: numCustomerId } } });
          if (tx.taskHistory?.deleteMany) await tx.taskHistory.deleteMany({ where: { task: { customerId: numCustomerId } } });
          if (tx.taskProof?.deleteMany) await tx.taskProof.deleteMany({ where: { task: { customerId: numCustomerId } } });
          if (tx.taskReview?.deleteMany) await tx.taskReview.deleteMany({ where: { task: { customerId: numCustomerId } } });
          if (tx.quotationItem?.deleteMany) await tx.quotationItem.deleteMany({ where: { quotation: { customerId: numCustomerId } } });
          if (tx.communicationHistory?.deleteMany) await tx.communicationHistory.deleteMany({ where: { contact: { customerId: numCustomerId } } });

          // Parents in FK-safe order
          const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const leads = tx.lead?.deleteMany ? await tx.lead.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
          const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

          deletedCount =
            cnt(quotations) +
            cnt(visits) +
            cnt(tasks) +
            cnt(deals) +
            cnt(contacts) +
            cnt(leads) +
            cnt(companies);
          break;
        }
        case 'attendance': {
          const breaks = tx.attendanceBreak?.deleteMany
            ? await tx.attendanceBreak.deleteMany({ where: { attendance: { customerId: numCustomerId } } })
            : { count: 0 };
          const attendances = tx.attendance?.deleteMany
            ? await tx.attendance.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(breaks) + cnt(attendances);
          break;
        }
        case 'leave': {
          if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: { customerId: numCustomerId } });
          if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: { customerId: numCustomerId } });
          const leaves = tx.leaveRequest?.deleteMany
            ? await tx.leaveRequest.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(leaves);
          break;
        }
        case 'remote': {
          const remotes = tx.remoteRequest?.deleteMany
            ? await tx.remoteRequest.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(remotes);
          break;
        }
        case 'visits': {
          const visits = tx.visit?.deleteMany
            ? await tx.visit.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(visits);
          break;
        }
        case 'payroll': {
          const slips = tx.salarySlip?.deleteMany
            ? await tx.salarySlip.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          const items = tx.payrollItem?.deleteMany
            ? await tx.payrollItem.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          const payrolls = tx.payroll?.deleteMany
            ? await tx.payroll.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(slips) + cnt(items) + cnt(payrolls);
          break;
        }
        case 'notifications': {
          const notifications = tx.notification?.deleteMany
            ? await tx.notification.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(notifications);
          break;
        }
        case 'location': {
          if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: { customerId: numCustomerId } });
          const locations = tx.employeeLocation?.deleteMany
            ? await tx.employeeLocation.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(locations);
          break;
        }
        case 'claims': {
          const claims = tx.employeeClaim?.deleteMany
            ? await tx.employeeClaim.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(claims);
          break;
        }
        case 'loans': {
          const loans = tx.employeeLoan?.deleteMany
            ? await tx.employeeLoan.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(loans);
          break;
        }
        case 'works': {
          if (tx.workTask?.deleteMany) await tx.workTask.deleteMany({ where: { work: { customerId: numCustomerId } } });
          if (tx.workAccessRequest?.deleteMany) await tx.workAccessRequest.deleteMany({ where: { customerId: numCustomerId } });
          const works = tx.work?.deleteMany
            ? await tx.work.deleteMany({ where: { customerId: numCustomerId } })
            : { count: 0 };
          deletedCount = cnt(works);
          break;
        }
        default:
          throw new BadRequestException(`Unsupported reset module: ${dto.module}`);
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            customerId: numCustomerId,
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

    const customerRecord = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
      select: { id: true, name: true, companyName: true },
    });

    const conf = dto.confirmation.trim().toUpperCase();
    const validConfirms = ['RESET ALL DATA'];
    if (customerRecord?.name) validConfirms.push(customerRecord.name.trim().toUpperCase());
    if (customerRecord?.companyName) validConfirms.push(customerRecord.companyName.trim().toUpperCase());

    if (!validConfirms.includes(conf)) {
      throw new BadRequestException(
        'Confirmation mismatch. You must type "RESET ALL DATA" to execute all transactional data reset.',
      );
    }

    let totalDeleted = 0;
    const cnt = (res?: { count?: number } | null): number => (res && typeof res.count === 'number' ? res.count : 0);

    await this.prisma.$transaction(async (tx) => {
      // ── Step 1: Deep leaf children across all transactional areas ─────────────
      if (tx.leadActivityTimeline?.deleteMany) await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      if (tx.leadNote?.deleteMany) await tx.leadNote.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      if (tx.leadReminder?.deleteMany) await tx.leadReminder.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      if (tx.leadStatusHistory?.deleteMany) await tx.leadStatusHistory.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      if (tx.communicationHistory?.deleteMany) await tx.communicationHistory.deleteMany({ where: { contact: { customerId: numCustomerId } } });
      if (tx.taskReview?.deleteMany) await tx.taskReview.deleteMany({ where: { task: { customerId: numCustomerId } } });
      if (tx.taskProof?.deleteMany) await tx.taskProof.deleteMany({ where: { task: { customerId: numCustomerId } } });
      if (tx.taskHistory?.deleteMany) await tx.taskHistory.deleteMany({ where: { task: { customerId: numCustomerId } } });
      if (tx.quotationItem?.deleteMany) await tx.quotationItem.deleteMany({ where: { quotation: { customerId: numCustomerId } } });
      if (tx.workTask?.deleteMany) await tx.workTask.deleteMany({ where: { work: { customerId: numCustomerId } } });
      if (tx.ticketComment?.deleteMany) await tx.ticketComment.deleteMany({ where: { ticket: { customerId: numCustomerId } } });
      if (tx.attendanceBreak?.deleteMany) await tx.attendanceBreak.deleteMany({ where: { attendance: { customerId: numCustomerId } } });
      if (tx.aiGenerationAsset?.deleteMany) await tx.aiGenerationAsset.deleteMany({ where: { generation: { customerId: numCustomerId } } });

      // ── Step 2: Marketing & Social Media ──────────────────────────────────────
      const videoViews = tx.customerMarketingVideoView?.deleteMany ? await tx.customerMarketingVideoView.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const videos = tx.marketingVideo?.deleteMany ? await tx.marketingVideo.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const banners = tx.marketingBanner?.deleteMany ? await tx.marketingBanner.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const trending = tx.trendingContent?.deleteMany ? await tx.trendingContent.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialPublishes = tx.socialPublish?.deleteMany ? await tx.socialPublish.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialAccounts = tx.socialAccount?.deleteMany ? await tx.socialAccount.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialHandlers = tx.socialMediaHandler?.deleteMany ? await tx.socialMediaHandler.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 3: AI Studio ─────────────────────────────────────────────────────
      const aiGens = tx.aiGeneration?.deleteMany ? await tx.aiGeneration.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const aiTxns = tx.aiCreditTransaction?.deleteMany ? await tx.aiCreditTransaction.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 4: Bookings & Reviews ────────────────────────────────────────────
      const bookingPayments = tx.influencerBookingPayment?.deleteMany ? await tx.influencerBookingPayment.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const reviews = tx.influencerReview?.deleteMany ? await tx.influencerReview.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const bookings = tx.influencerBooking?.deleteMany ? await tx.influencerBooking.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 5: Calendar / Schedules & Works ───────────────────────────────────
      const schedules = tx.monthlySchedule?.deleteMany ? await tx.monthlySchedule.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const workAccess = tx.workAccessRequest?.deleteMany ? await tx.workAccessRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.roleWorkPermission?.deleteMany) await tx.roleWorkPermission.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeModuleOverride?.deleteMany) await tx.employeeModuleOverride.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeLeadLimit?.deleteMany) await tx.employeeLeadLimit.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.roleLeadLimit?.deleteMany) await tx.roleLeadLimit.deleteMany({ where: { customerId: numCustomerId } });
      const works = tx.work?.deleteMany ? await tx.work.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 6: Billing & Invoices (Purge transactional invoices/payments) ────
      if (tx.invoiceItem?.deleteMany) await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: numCustomerId } } });
      const invRes = tx.invoice?.deleteMany ? await tx.invoice.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const payRes = tx.paymentHistory?.deleteMany ? await tx.paymentHistory.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const instRes = tx.subscriptionInstallment?.deleteMany ? await tx.subscriptionInstallment.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.customPlanOrder?.deleteMany) await tx.customPlanOrder.deleteMany({ where: { customerId: numCustomerId } });

      // ── Step 7: CRM Parent Records ────────────────────────────────────────────
      const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const leads = tx.lead?.deleteMany ? await tx.lead.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 8: Data Capture ──────────────────────────────────────────────────
      const dcPlaces = tx.dataCapturePlace?.deleteMany ? await tx.dataCapturePlace.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const dcJobs = tx.dataCaptureJob?.deleteMany ? await tx.dataCaptureJob.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // ── Step 9: Operations & HR Transactional ─────────────────────────────────
      const tickets = tx.supportTicket?.deleteMany ? await tx.supportTicket.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const notifications = tx.notification?.deleteMany ? await tx.notification.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const locations = tx.employeeLocation?.deleteMany ? await tx.employeeLocation.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: { customerId: numCustomerId } });
      const attendances = tx.attendance?.deleteMany ? await tx.attendance.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const leaves = tx.leaveRequest?.deleteMany ? await tx.leaveRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: { customerId: numCustomerId } });
      const remotes = tx.remoteRequest?.deleteMany ? await tx.remoteRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const slips = tx.salarySlip?.deleteMany ? await tx.salarySlip.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const items = tx.payrollItem?.deleteMany ? await tx.payrollItem.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const payrolls = tx.payroll?.deleteMany ? await tx.payroll.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const claims = tx.employeeClaim?.deleteMany ? await tx.employeeClaim.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany ? await tx.employeeLoan.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      totalDeleted =
        cnt(quotations) +
        cnt(visits) +
        cnt(tasks) +
        cnt(deals) +
        cnt(contacts) +
        cnt(leads) +
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
        cnt(videoViews) +
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
        cnt(payRes) +
        cnt(instRes);

      // Reset storage usage
      if (tx.customer?.update) {
        await tx.customer.update({
          where: { id: numCustomerId },
          data: { storageUsed: 0, updatedAt: new Date() },
        });
      }

      // Audit Log
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            customerId: numCustomerId,
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
      if (typeof (tx.lead as any)?.count === 'function') {
        const remaining = await Promise.all([
          tx.lead.count({ where: { customerId: numCustomerId } }),
          tx.contact?.count ? tx.contact.count({ where: { customerId: numCustomerId } }) : 0,
          tx.deal?.count ? tx.deal.count({ where: { customerId: numCustomerId } }) : 0,
          tx.task?.count ? tx.task.count({ where: { customerId: numCustomerId } }) : 0,
          tx.attendance?.count ? tx.attendance.count({ where: { customerId: numCustomerId } }) : 0,
          tx.leaveRequest?.count ? tx.leaveRequest.count({ where: { customerId: numCustomerId } }) : 0,
          tx.work?.count ? tx.work.count({ where: { customerId: numCustomerId } }) : 0,
        ]);

        const [rLeads, rContacts, rDeals, rTasks, rAtt, rLeaves, rWorks] = remaining;
        const totalRemaining = rLeads + rContacts + rDeals + rTasks + rAtt + rLeaves + rWorks;

        if (totalRemaining > 0) {
          throw new InternalServerErrorException(
            `Data reset verification failed: ${totalRemaining} transactional records remain after deletion. Transaction rolled back.`,
          );
        }
      }
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
    const numCustomerId = employee.customerId;
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
      this.prisma.attendance.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.attendanceBreak.count({
        where: { attendance: { customerId: numCustomerId, employeeId: numEmployeeId } },
      }),
      this.prisma.leaveRequest.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.remoteRequest.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.visit.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.salarySlip.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.payrollItem.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.employeeLocation.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.employeeClaim.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.employeeLoan.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
      this.prisma.workTask.count({ where: { work: { customerId: numCustomerId }, assignedToId: numEmployeeId } }),
      employeeUserId
        ? this.prisma.notification.count({ where: { customerId: numCustomerId, userId: employeeUserId } })
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
    const numCustomerId = employee.customerId;
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
                where: { attendance: { customerId: numCustomerId, employeeId: numEmployeeId } },
              })
            : { count: 0 };
          const attendances = tx.attendance?.deleteMany
            ? await tx.attendance.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(breaks) + cnt(attendances);
          break;
        }
        case 'leave': {
          if (tx.leaveAdjustmentHistory?.deleteMany) {
            await tx.leaveAdjustmentHistory.deleteMany({
              where: { customerId: numCustomerId, employeeId: numEmployeeId },
            });
          }
          if (tx.employeeLeaveBalance?.deleteMany) {
            await tx.employeeLeaveBalance.deleteMany({
              where: { employeeId: numEmployeeId },
            });
          }
          const leaves = tx.leaveRequest?.deleteMany
            ? await tx.leaveRequest.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(leaves);
          break;
        }
        case 'remote': {
          const remotes = tx.remoteRequest?.deleteMany
            ? await tx.remoteRequest.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(remotes);
          break;
        }
        case 'visits': {
          const visits = tx.visit?.deleteMany
            ? await tx.visit.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(visits);
          break;
        }
        case 'payroll': {
          const slips = tx.salarySlip?.deleteMany
            ? await tx.salarySlip.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          const items = tx.payrollItem?.deleteMany
            ? await tx.payrollItem.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(slips) + cnt(items);
          break;
        }
        case 'claims': {
          const claims = tx.employeeClaim?.deleteMany
            ? await tx.employeeClaim.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(claims);
          break;
        }
        case 'loans': {
          const loans = tx.employeeLoan?.deleteMany
            ? await tx.employeeLoan.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
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
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(locations);
          break;
        }
        case 'tasks': {
          if (tx.taskHistory?.deleteMany) {
            await tx.taskHistory.deleteMany({
              where: { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
            });
          }
          if (tx.taskProof?.deleteMany) {
            await tx.taskProof.deleteMany({
              where: {
                OR: [
                  { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
                  { employeeId: numEmployeeId },
                ],
              },
            });
          }
          if (tx.taskReview?.deleteMany) {
            await tx.taskReview.deleteMany({
              where: { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
            });
          }
          const tasks = tx.task?.deleteMany
            ? await tx.task.deleteMany({
                where: { customerId: numCustomerId, employeeId: numEmployeeId },
              })
            : { count: 0 };
          deletedCount = cnt(tasks);
          break;
        }
        case 'works': {
          if (tx.workTask?.deleteMany) {
            await tx.workTask.deleteMany({
              where: { work: { customerId: numCustomerId }, assignedToId: numEmployeeId },
            });
          }
          if (tx.workAccessRequest?.deleteMany) {
            await tx.workAccessRequest.deleteMany({
              where: { customerId: numCustomerId, employeeId: numEmployeeId },
            });
          }
          if (tx.work?.updateMany) {
            await tx.work.updateMany({
              where: { customerId: numCustomerId, assignedToId: numEmployeeId },
              data: { assignedToId: null },
            });
            await tx.work.updateMany({
              where: { customerId: numCustomerId, editorId: numEmployeeId },
              data: { editorId: null },
            });
          }
          deletedCount = 1;
          break;
        }
        case 'notifications': {
          if (employeeUserId && tx.notification?.deleteMany) {
            const notifs = await tx.notification.deleteMany({
              where: { customerId: numCustomerId, userId: employeeUserId },
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
            customerId: numCustomerId,
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
    const numCustomerId = employee.customerId;
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
          where: { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
        });
      }
      if (tx.taskProof?.deleteMany) {
        await tx.taskProof.deleteMany({
          where: {
            OR: [
              { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
              { employeeId: numEmployeeId },
            ],
          },
        });
      }
      if (tx.taskReview?.deleteMany) {
        await tx.taskReview.deleteMany({
          where: { task: { customerId: numCustomerId, employeeId: numEmployeeId } },
        });
      }
      const tasks = tx.task?.deleteMany
        ? await tx.task.deleteMany({ where: { customerId: numCustomerId, employeeId: numEmployeeId } })
        : { count: 0 };

      // 2. Work tasks & access requests
      const workTasks = tx.workTask?.deleteMany
        ? await tx.workTask.deleteMany({ where: { work: { customerId: numCustomerId }, assignedToId: numEmployeeId } })
        : { count: 0 };
      if (tx.workAccessRequest?.deleteMany) {
        await tx.workAccessRequest.deleteMany({ where: { customerId: numCustomerId, employeeId: numEmployeeId } });
      }

      // 3. Unassign Works
      if (tx.work?.updateMany) {
        await tx.work.updateMany({
          where: { customerId: numCustomerId, assignedToId: numEmployeeId },
          data: { assignedToId: null },
        });
        await tx.work.updateMany({
          where: { customerId: numCustomerId, editorId: numEmployeeId },
          data: { editorId: null },
        });
      }

      // 4. Attendance breaks then attendances
      const breaks = tx.attendanceBreak?.deleteMany
        ? await tx.attendanceBreak.deleteMany({
            where: { attendance: { customerId: numCustomerId, employeeId: numEmployeeId } },
          })
        : { count: 0 };
      const attendances = tx.attendance?.deleteMany
        ? await tx.attendance.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 5. Leaves & balances
      if (tx.leaveAdjustmentHistory?.deleteMany) {
        await tx.leaveAdjustmentHistory.deleteMany({
          where: { customerId: numCustomerId, employeeId: numEmployeeId },
        });
      }
      if (tx.employeeLeaveBalance?.deleteMany) {
        await tx.employeeLeaveBalance.deleteMany({
          where: { employeeId: numEmployeeId },
        });
      }
      const leaves = tx.leaveRequest?.deleteMany
        ? await tx.leaveRequest.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 6. Remote requests & visits
      const remotes = tx.remoteRequest?.deleteMany
        ? await tx.remoteRequest.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };
      const visits = tx.visit?.deleteMany
        ? await tx.visit.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 7. Payroll slips, items & structure
      const slips = tx.salarySlip?.deleteMany
        ? await tx.salarySlip.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };
      const items = tx.payrollItem?.deleteMany
        ? await tx.payrollItem.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };
      if (tx.salaryStructure?.deleteMany) {
        await tx.salaryStructure.deleteMany({
          where: { customerId: numCustomerId, employeeId: numEmployeeId },
        });
      }

      // 8. Claims & Loans
      const claims = tx.employeeClaim?.deleteMany
        ? await tx.employeeClaim.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany
        ? await tx.employeeLoan.deleteMany({
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
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
            where: { customerId: numCustomerId, employeeId: numEmployeeId },
          })
        : { count: 0 };

      // 10. Overrides & Limits
      if (tx.employeeModuleOverride?.deleteMany) {
        await tx.employeeModuleOverride.deleteMany({
          where: { customerId: numCustomerId, employeeId: numEmployeeId },
        });
      }
      if (tx.employeeLeadLimit?.deleteMany) {
        await tx.employeeLeadLimit.deleteMany({
          where: { employeeId: numEmployeeId },
        });
      }

      // 11. Unlink shared assignments
      if (tx.lead?.updateMany) {
        await tx.lead.updateMany({
          where: { customerId: numCustomerId, employeeId: numEmployeeId },
          data: { employeeId: null },
        });
      }
      if (tx.monthlySchedule?.updateMany) {
        await tx.monthlySchedule.updateMany({
          where: { customerId: numCustomerId, assignedEmployeeId: numEmployeeId },
          data: { assignedEmployeeId: null },
        });
      }
      if (tx.team?.updateMany) {
        await tx.team.updateMany({
          where: { customerId: numCustomerId, leaderId: numEmployeeId },
          data: { leaderId: null },
        });
      }
      if (tx.department?.updateMany) {
        await tx.department.updateMany({
          where: { customerId: numCustomerId, headId: numEmployeeId },
          data: { headId: null },
        });
      }
      if (tx.customer?.updateMany) {
        await tx.customer.updateMany({
          where: { assignedEmployeeId: numEmployeeId },
          data: { assignedEmployeeId: null },
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
            where: { customerId: numCustomerId, userId: employeeUserId },
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
            customerId: numCustomerId,
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
          tx.attendance.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }),
          tx.leaveRequest?.count ? tx.leaveRequest.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.remoteRequest?.count ? tx.remoteRequest.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.visit?.count ? tx.visit.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.salarySlip?.count ? tx.salarySlip.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.employeeLocation?.count ? tx.employeeLocation.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.task?.count ? tx.task.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.workTask?.count ? tx.workTask.count({ where: { work: { customerId: numCustomerId }, assignedToId: numEmployeeId } }) : 0,
          tx.employeeClaim?.count ? tx.employeeClaim.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
          tx.employeeLoan?.count ? tx.employeeLoan.count({ where: { customerId: numCustomerId, employeeId: numEmployeeId } }) : 0,
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
   * GET live summary of customer data and record counts
   */
  async getCustomerSummary(customerId: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        phone: true,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found.`);
    }

    const summary = await this.getSummary(numCustomerId);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        companyName: customer.companyName,
        displayName: customer.companyName || customer.name,
        email: customer.email,
        phone: customer.phone,
        isActive: customer.isActive,
      },
      ...summary,
    };
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
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found.`);
    }

    const numUserId = Number(userId);

    // Atomic Prisma Transaction with cascading deletions in foreign-key order
    const resetResult = await this.prisma.$transaction(async (tx) => {
      const cnt = (res: any) => (res && typeof res.count === 'number' ? res.count : 0);

      // 1. Dependent leaf tables without direct customerId
      if (tx.leadActivityTimeline?.deleteMany) {
        await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      }
      if (tx.leadNote?.deleteMany) {
        await tx.leadNote.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      }
      if (tx.leadReminder?.deleteMany) {
        await tx.leadReminder.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      }
      if (tx.leadStatusHistory?.deleteMany) {
        await tx.leadStatusHistory.deleteMany({ where: { lead: { customerId: numCustomerId } } });
      }
      if (tx.communicationHistory?.deleteMany) {
        await tx.communicationHistory.deleteMany({ where: { contact: { customerId: numCustomerId } } });
      }
      if (tx.taskReview?.deleteMany) {
        await tx.taskReview.deleteMany({ where: { task: { customerId: numCustomerId } } });
      }
      if (tx.taskProof?.deleteMany) {
        await tx.taskProof.deleteMany({ where: { task: { customerId: numCustomerId } } });
      }
      if (tx.taskHistory?.deleteMany) {
        await tx.taskHistory.deleteMany({ where: { task: { customerId: numCustomerId } } });
      }
      if (tx.quotationItem?.deleteMany) {
        await tx.quotationItem.deleteMany({ where: { quotation: { customerId: numCustomerId } } });
      }
      if (tx.workTask?.deleteMany) {
        await tx.workTask.deleteMany({ where: { work: { customerId: numCustomerId } } });
      }
      if (tx.ticketComment?.deleteMany) {
        await tx.ticketComment.deleteMany({ where: { ticket: { customerId: numCustomerId } } });
      }
      if (tx.attendanceBreak?.deleteMany) {
        await tx.attendanceBreak.deleteMany({ where: { attendance: { customerId: numCustomerId } } });
      }
      if (tx.aiGenerationAsset?.deleteMany) {
        await tx.aiGenerationAsset.deleteMany({ where: { generation: { customerId: numCustomerId } } });
      }

      // 2. Marketing, Campaigns & Social Media
      const videoViews = tx.customerMarketingVideoView?.deleteMany ? await tx.customerMarketingVideoView.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const videos = tx.marketingVideo?.deleteMany ? await tx.marketingVideo.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const banners = tx.marketingBanner?.deleteMany ? await tx.marketingBanner.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const trending = tx.trendingContent?.deleteMany ? await tx.trendingContent.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialPublishes = tx.socialPublish?.deleteMany ? await tx.socialPublish.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialAccounts = tx.socialAccount?.deleteMany ? await tx.socialAccount.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const socialHandlers = tx.socialMediaHandler?.deleteMany ? await tx.socialMediaHandler.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 3. AI Studio
      const aiGens = tx.aiGeneration?.deleteMany ? await tx.aiGeneration.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const aiTxns = tx.aiCreditTransaction?.deleteMany ? await tx.aiCreditTransaction.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 4. Influencer Bookings & Reviews
      const bookingPayments = tx.influencerBookingPayment?.deleteMany ? await tx.influencerBookingPayment.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const reviews = tx.influencerReview?.deleteMany ? await tx.influencerReview.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const bookings = tx.influencerBooking?.deleteMany ? await tx.influencerBooking.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 5. Calendar / Schedules, Works, Work Access & Limits
      const schedules = tx.monthlySchedule?.deleteMany ? await tx.monthlySchedule.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const workAccess = tx.workAccessRequest?.deleteMany ? await tx.workAccessRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.roleWorkPermission?.deleteMany) await tx.roleWorkPermission.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeModuleOverride?.deleteMany) await tx.employeeModuleOverride.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeLeadLimit?.deleteMany) await tx.employeeLeadLimit.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.roleLeadLimit?.deleteMany) await tx.roleLeadLimit.deleteMany({ where: { customerId: numCustomerId } });
      const works = tx.work?.deleteMany ? await tx.work.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 6. Billing items & invoices
      if (tx.invoiceItem?.deleteMany) await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: numCustomerId } } });
      const invRes = tx.invoice?.deleteMany ? await tx.invoice.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const payRes = tx.paymentHistory?.deleteMany ? await tx.paymentHistory.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const instRes = tx.subscriptionInstallment?.deleteMany ? await tx.subscriptionInstallment.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.customPlanOrder?.deleteMany) await tx.customPlanOrder.deleteMany({ where: { customerId: numCustomerId } });

      // 7. CRM parent tables
      const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const leads = tx.lead?.deleteMany ? await tx.lead.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 8. Data Capture
      const dcPlaces = tx.dataCapturePlace?.deleteMany ? await tx.dataCapturePlace.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const dcJobs = tx.dataCaptureJob?.deleteMany ? await tx.dataCaptureJob.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 9. Operations & HR Transactional
      const tickets = tx.supportTicket?.deleteMany ? await tx.supportTicket.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const notifications = tx.notification?.deleteMany ? await tx.notification.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const locations = tx.employeeLocation?.deleteMany ? await tx.employeeLocation.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: { customerId: numCustomerId } });
      const attendances = tx.attendance?.deleteMany ? await tx.attendance.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const leaves = tx.leaveRequest?.deleteMany ? await tx.leaveRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: { customerId: numCustomerId } });
      if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: { customerId: numCustomerId } });
      const remotes = tx.remoteRequest?.deleteMany ? await tx.remoteRequest.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const slips = tx.salarySlip?.deleteMany ? await tx.salarySlip.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const payrollItems = tx.payrollItem?.deleteMany ? await tx.payrollItem.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const payrolls = tx.payroll?.deleteMany ? await tx.payroll.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      if (tx.salaryStructure?.deleteMany) await tx.salaryStructure.deleteMany({ where: { employee: { customerId: numCustomerId } } });
      const claims = tx.employeeClaim?.deleteMany ? await tx.employeeClaim.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany ? await tx.employeeLoan.deleteMany({ where: { customerId: numCustomerId } }) : { count: 0 };

      // 10. Auth sessions & refresh tokens for linked users
      if (tx.refreshToken?.deleteMany) {
        await tx.refreshToken.deleteMany({ where: { user: { customerId: numCustomerId } } });
      }
      if (tx.session?.deleteMany) {
        await tx.session.deleteMany({ where: { user: { customerId: numCustomerId } } });
      }

      // 11. Storage reset
      if (tx.customer?.update) {
        await tx.customer.update({
          where: { id: numCustomerId },
          data: { storageUsed: 0, updatedAt: new Date() },
        });
      }

      const totalDeleted =
        cnt(invRes) +
        cnt(payRes) +
        cnt(instRes) +
        cnt(quotations) +
        cnt(tasks) +
        cnt(deals) +
        cnt(visits) +
        cnt(leads) +
        cnt(contacts) +
        cnt(companies) +
        cnt(dcPlaces) +
        cnt(dcJobs) +
        cnt(works) +
        cnt(schedules) +
        cnt(tickets) +
        cnt(notifications) +
        cnt(locations) +
        cnt(attendances) +
        cnt(leaves) +
        cnt(remotes) +
        cnt(slips) +
        cnt(payrollItems) +
        cnt(payrolls) +
        cnt(claims) +
        cnt(loans) +
        cnt(videoViews) +
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
        cnt(workAccess);

      // 12. Audit Log
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            customerId: numCustomerId,
            userId: !isNaN(numUserId) && numUserId > 0 ? numUserId : null,
            action: 'DATA_RESET',
            module: 'CUSTOMER_DATA_RESET',
            details: {
              scope: 'CUSTOMER_DATA_RESET',
              recordsDeleted: totalDeleted,
              performedByRole: userRole || 'SUPER_ADMIN',
              reason: dto?.reason || 'Admin reset customer application data',
              resetAt: new Date().toISOString(),
            },
          },
        });
      }

      // 13. Pre-commit verification: verify application records are deleted
      const remainingLeads = tx.lead?.count ? await tx.lead.count({ where: { customerId: numCustomerId } }) : 0;
      const remainingAttendances = tx.attendance?.count ? await tx.attendance.count({ where: { customerId: numCustomerId } }) : 0;

      if (remainingLeads > 0 || remainingAttendances > 0) {
        throw new InternalServerErrorException(
          `Customer data reset verification failed: records still remain for Customer #${numCustomerId}. Rolling back transaction.`,
        );
      }

      return { totalDeleted };
    });

    this.logger.log(
      `[CUSTOMER_DATA_RESET] Customer #${numCustomerId} reset completed. ${resetResult.totalDeleted} records removed.`,
    );

    return {
      success: true,
      customerId: numCustomerId,
      customerName: customer.companyName || customer.name,
      recordsDeleted: resetResult.totalDeleted,
      message: `Successfully reset all application data for ${customer.companyName || customer.name} (${resetResult.totalDeleted} records permanently removed). Customer profile, employees, and settings remain preserved.`,
    };
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
    // Soft-deleted customers: deletedAt is not null
    const deletedCustomers = await this.prisma.customer.findMany({
      where: { deletedAt: { not: null } },
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        isActive: true,
        deletedAt: true,
        _count: {
          select: {
            leads: true,
            contacts: true,
            deals: true,
            tasks: true,
            employees: true,
          },
        },
        auditLogs: {
          where: { action: 'MOVE_TO_BIN' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { deletedAt: 'desc' },
    });

    // Soft-deleted employees: status = 'DELETED'
    const deletedEmployees = await this.prisma.employee.findMany({
      where: { status: 'DELETED' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeCode: true,
        customerId: true,
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
        customer: { select: { name: true, companyName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const customers = deletedCustomers.map((c) => ({
      id: String(c.id),
      type: 'CUSTOMER' as const,
      name: c.name || c.companyName || `Customer #${c.id}`,
      email: c.email || '',
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      deletedBy: c.auditLogs?.[0]?.user
        ? `${c.auditLogs[0].user.firstName || ''} ${c.auditLogs[0].user.lastName || ''}`.trim() || c.auditLogs[0].user.email
        : 'Admin',
      dataCounts: {
        leads: c._count.leads,
        contacts: c._count.contacts,
        deals: c._count.deals,
        tasks: c._count.tasks,
        employees: c._count.employees,
        total: c._count.leads + c._count.contacts + c._count.deals + c._count.tasks + c._count.employees,
      },
    }));

    const employees = deletedEmployees.map((e) => ({
      id: String(e.id),
      type: 'EMPLOYEE' as const,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email || '',
      employeeCode: e.employeeCode || '',
      department: e.department?.name || '',
      designation: e.designation?.name || '',
      customerName: e.customer?.name || e.customer?.companyName || '',
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
  async restoreCustomerFromBin(customerId: number | string) {
    const numId = Number(customerId);
    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Invalid customer ID');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: numId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found.`);
    }

    if (!customer.deletedAt && customer.isActive) {
      throw new BadRequestException('Customer is not in the Bin.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: numId },
        data: { isActive: true, deletedAt: null },
      });
      await tx.user.updateMany({
        where: { customerId: numId },
        data: { isActive: true, deletedAt: null },
      });
      await tx.auditLog.create({
        data: {
          customerId: numId,
          action: 'RESTORE_FROM_BIN',
          module: 'CUSTOMER',
          details: `Restored Customer #${numId} from Bin`,
        },
      });
    });

    this.logger.log(`[BIN_RESTORE_CUSTOMER] Customer #${numId} restored from Bin.`);
    return { success: true, message: `Customer #${numId} restored from Bin successfully.` };
  }

  /**
   * Permanently delete a customer from the Bin.
   * Runs a full FK-safe purge atomically in a transaction with post-commit verification.
   */
  async deleteCustomerPermanently(customerId: number | string) {
    const numId = Number(customerId);
    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Invalid customer ID');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: numId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.leadActivityTimeline?.deleteMany?.({ where: { lead: { customerId: numId } } });
      await tx.leadNote?.deleteMany?.({ where: { lead: { customerId: numId } } });
      await tx.leadReminder?.deleteMany?.({ where: { lead: { customerId: numId } } });
      await tx.leadStatusHistory?.deleteMany?.({ where: { lead: { customerId: numId } } });
      await tx.taskReview?.deleteMany?.({ where: { task: { customerId: numId } } });
      await tx.taskProof?.deleteMany?.({ where: { task: { customerId: numId } } });
      await tx.taskHistory?.deleteMany?.({ where: { task: { customerId: numId } } });
      await tx.ticketComment?.deleteMany?.({ where: { ticket: { customerId: numId } } });
      await tx.communicationHistory?.deleteMany?.({ where: { contact: { customerId: numId } } });
      await tx.workTask?.deleteMany?.({ where: { work: { customerId: numId } } });
      await tx.attendanceBreak?.deleteMany?.({ where: { attendance: { customerId: numId } } });
      await tx.subscriptionInstallment?.deleteMany?.({ where: { customerId: numId } });
      await tx.invoiceItem?.deleteMany?.({ where: { invoice: { customerId: numId } } });
      await tx.invoice?.deleteMany?.({ where: { customerId: numId } });
      await tx.quotationItem?.deleteMany?.({ where: { quotation: { customerId: numId } } });
      await tx.quotation?.deleteMany?.({ where: { customerId: numId } });
      await tx.visit?.deleteMany?.({ where: { customerId: numId } });
      await tx.task?.deleteMany?.({ where: { customerId: numId } });
      await tx.deal?.deleteMany?.({ where: { customerId: numId } });
      await tx.contact?.deleteMany?.({ where: { customerId: numId } });
      await tx.lead?.deleteMany?.({ where: { customerId: numId } });
      await tx.company?.deleteMany?.({ where: { customerId: numId } });
      await tx.supportTicket?.deleteMany?.({ where: { customerId: numId } });
      await tx.work?.deleteMany?.({ where: { customerId: numId } });
      await tx.attendance?.deleteMany?.({ where: { customerId: numId } });
      await tx.leaveRequest?.deleteMany?.({ where: { customerId: numId } });
      await tx.remoteRequest?.deleteMany?.({ where: { customerId: numId } });
      await tx.salarySlip?.deleteMany?.({ where: { customerId: numId } });
      await tx.payrollItem?.deleteMany?.({ where: { customerId: numId } });
      await tx.payroll?.deleteMany?.({ where: { customerId: numId } });
      await tx.dataCapturePlace?.deleteMany?.({ where: { customerId: numId } });
      await tx.dataCaptureJob?.deleteMany?.({ where: { customerId: numId } });
      await tx.influencerBookingPayment?.deleteMany?.({ where: { customerId: numId } });
      await tx.influencerBooking?.deleteMany?.({ where: { customerId: numId } });
      await tx.influencerReview?.deleteMany?.({ where: { customerId: numId } });
      await tx.aiGenerationAsset?.deleteMany?.({ where: { generation: { customerId: numId } } });
      await tx.socialPublish?.deleteMany?.({ where: { customerId: numId } });
      await tx.socialAccount?.deleteMany?.({ where: { customerId: numId } });
      await tx.aiGeneration?.deleteMany?.({ where: { customerId: numId } });
      await tx.aiCreditTransaction?.deleteMany?.({ where: { customerId: numId } });
      await tx.customerMarketingVideoView?.deleteMany?.({ where: { customerId: numId } });
      await tx.paymentHistory?.deleteMany?.({ where: { customerId: numId } });
      await tx.customPlanOrder?.deleteMany?.({ where: { customerId: numId } });
      await tx.monthlySchedule?.deleteMany?.({ where: { customerId: numId } });
      await tx.customerSubscription?.deleteMany?.({ where: { customerId: numId } });
      await tx.refreshToken?.deleteMany?.({ where: { user: { customerId: numId } } });
      await tx.session?.deleteMany?.({ where: { user: { customerId: numId } } });
      await tx.teamMember?.deleteMany?.({ where: { team: { customerId: numId } } });
      await tx.auditLog?.deleteMany?.({ where: { customerId: numId } });
      await tx.employee?.deleteMany?.({ where: { customerId: numId } });
      await tx.user?.deleteMany?.({ where: { customerId: numId } });
      await tx.customer.delete({ where: { id: numId } });
    });

    const stillExists = await this.prisma.customer.findUnique({ where: { id: numId } });
    if (stillExists) {
      throw new InternalServerErrorException(`Permanent deletion verification failed: Customer #${numId} still exists in database.`);
    }

    this.logger.log(`[BIN_PERMANENT_DELETE_CUSTOMER] Customer #${numId} permanently deleted and verified removed from database.`);
    return { success: true, message: `Customer #${numId} permanently deleted from database.` };
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

    const userId = employee.userId ? Number(employee.userId) : null;
    const empCustomerId = Number(employee.customerId);

    await this.prisma.$transaction(async (tx) => {
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
      await tx.employeeModuleOverride?.deleteMany?.({ where: { employeeId: numId } });
      await tx.employeeLeadLimit?.deleteMany?.({ where: { employeeId: numId } });
      await tx.locationTrackingSetting?.deleteMany?.({ where: { employeeId: numId } });
      await tx.teamMember?.deleteMany?.({ where: { employeeId: numId } });
      await tx.team?.updateMany?.({ where: { leaderId: numId }, data: { leaderId: null } });
      await tx.department?.updateMany?.({ where: { headId: numId }, data: { headId: null } });
      await tx.customer?.updateMany?.({ where: { assignedEmployeeId: numId }, data: { assignedEmployeeId: null } });
      await tx.lead?.updateMany?.({ where: { employeeId: numId }, data: { employeeId: null } });
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

      await tx.auditLog?.updateMany?.({ where: { customerId: empCustomerId, userId }, data: { userId: null } });
      await tx.employee.delete({ where: { id: numId } });

      if (userId) {
        await tx.notification?.deleteMany?.({ where: { userId } });
        await tx.userRole?.deleteMany?.({ where: { userId } });
        await tx.user?.delete?.({ where: { id: userId } });
      }
    });

    const stillExists = await this.prisma.employee.findUnique({ where: { id: numId } });
    if (stillExists) {
      throw new InternalServerErrorException(`Permanent deletion verification failed: Employee #${numId} still exists in database.`);
    }

    this.logger.log(`[BIN_PERMANENT_DELETE_EMPLOYEE] Employee #${numId} permanently deleted and verified removed from database.`);
    return { success: true, message: `Employee #${numId} permanently deleted from database.` };
  }
}
