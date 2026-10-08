import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { EmployeeCommunicationService } from './employee-communication.service';
import { SubscriptionStatus, WorkStatus, LeadStatus } from '@prisma/client';

/**
 * Returns UTC Date range matching start and end of day in Indian Standard Time (IST: UTC+5:30)
 */
function getIstDayWindow(dayOffset: number): { start: Date; end: Date } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowUtc = new Date();
  const nowIst = new Date(nowUtc.getTime() + IST_OFFSET_MS);

  // Advance by dayOffset in IST
  const targetIst = new Date(nowIst.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const year = targetIst.getUTCFullYear();
  const month = targetIst.getUTCMonth();
  const date = targetIst.getUTCDate();

  // Construct start and end of target IST day in UTC
  const startIst = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const endIst = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));

  return {
    start: new Date(startIst.getTime() - IST_OFFSET_MS),
    end: new Date(endIst.getTime() - IST_OFFSET_MS),
  };
}

@Injectable()
export class NotificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private campaignTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly employeeCommunication: EmployeeCommunicationService,
  ) {}

  onModuleInit() {
    // Warmup delay (10s) to allow app bootstrap before first check
    setTimeout(() => {
      this.runAllScheduledChecks().catch((err) => {
        this.logger.error(`Initial scheduled check error: ${err?.message}`, err?.stack);
      });
    }, 10000);

    // Periodic check every 1 hour (3600000 ms) for general reminders & cleanup
    this.timer = setInterval(() => {
      this.runAllScheduledChecks().catch((err) => {
        this.logger.error(`Periodic scheduled check error: ${err?.message}`, err?.stack);
      });
    }, 60 * 60 * 1000);

    // Prompt check every 1 minute for scheduled offer campaigns
    this.campaignTimer = setInterval(() => {
      this.notificationService.processScheduledCampaigns().catch((err) => {
        this.logger.error(`Scheduled offer campaign check error: ${err?.message}`);
      });
    }, 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.campaignTimer) {
      clearInterval(this.campaignTimer);
      this.campaignTimer = null;
    }
  }

  /**
   * Run all automated notifications:
   * 1. 3-day subscription expiry reminders (Customer)
   * 2. Same-day subscription expiry reminders (Customer)
   * 3. Tomorrow's calendar activity reminders (Customer + Employee)
   * 4. Pending scheduled offer notifications
   * 5. 7-day notification cleanup
   */
  async runAllScheduledChecks() {
    this.logger.log('Starting automated notification scheduler cycle...');

    const carriedForwardCount = await this.autoCarryForwardIncompleteWorks();
    const subCount3Days = await this.checkSubscriptionExpiries(3);
    const subCountToday = await this.checkSubscriptionExpiries(0);
    const { customerCount, employeeCount } = await this.checkTomorrowCalendarSchedules();
    const scheduledOffersCount = await this.notificationService.processScheduledCampaigns();
    const followUpRemindersCount = await this.checkLeadFollowUpReminders();
    const attendanceReports = await this.employeeCommunication.sendCompletedMonthReports().catch((err: any) => {
      this.logger.warn(`[ATTENDANCE_REPORT] ${err?.message}`);
      return null;
    });
    const cleanupCount = await this.cleanupOldNotifications();

    this.logger.log(
      `[SCHEDULER_CYCLE_COMPLETE] Tasks Carried Forward: ${carriedForwardCount} | Subscriptions (3-Day): ${subCount3Days} | Subscriptions (Today): ${subCountToday} | Customer Calendar: ${customerCount} | Employee Calendar: ${employeeCount} | Scheduled Offers: ${scheduledOffersCount} | Follow-Up Reminders: ${followUpRemindersCount} | Attendance Reports: ${attendanceReports && !('skipped' in attendanceReports) ? attendanceReports.attempted : 0} | Notifications Cleaned: ${cleanupCount}`,
    );

    return {
      tasksCarriedForward: carriedForwardCount,
      subscriptionsNotified3Days: subCount3Days,
      subscriptionsNotifiedToday: subCountToday,
      customerCalendarNotified: customerCount,
      employeeCalendarNotified: employeeCount,
      scheduledOffersNotified: scheduledOffersCount,
      followUpRemindersNotified: followUpRemindersCount,
      notificationsCleaned: cleanupCount,
    };
  }

  /**
   * Safe Task Auto Carry-Forward:
   * Moves any incomplete tasks scheduled for past days in IST to today (or next working day).
   * Idempotent: Never duplicates the task. Preserves the same Task ID.
   */
  async autoCarryForwardIncompleteWorks(): Promise<number> {
    const todayStart = getIstDayWindow(0).start;
    const overdueWorks = await this.prisma.work.findMany({
      where: {
        scheduledDate: { lt: todayStart },
        status: {
          notIn: [WorkStatus.COMPLETED, WorkStatus.APPROVED, WorkStatus.CANCELLED],
        },
      },
    });

    if (overdueWorks.length === 0) return 0;

    let count = 0;
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowUtc = new Date();
    const nowIst = new Date(nowUtc.getTime() + IST_OFFSET_MS);
    const curY = nowIst.getUTCFullYear();
    const curM = nowIst.getUTCMonth();
    const curD = nowIst.getUTCDate();

    for (const work of overdueWorks) {
      try {
        const origDate = work.scheduledDate;
        const origIst = new Date(origDate.getTime() + IST_OFFSET_MS);
        const origY = origIst.getUTCFullYear();
        const origM = String(origIst.getUTCMonth() + 1).padStart(2, '0');
        const origD = String(origIst.getUTCDate()).padStart(2, '0');
        const origIso = `${origY}-${origM}-${origD}`;

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const origDisplay = `${origD} ${months[origIst.getUTCMonth()]} ${origY}`;

        const existingNotes = work.notes || '';
        const alreadyHasOriginalTag = /\[ORIGINAL_SCHEDULE:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/.test(existingNotes);

        let updatedNotes = existingNotes;
        if (!alreadyHasOriginalTag) {
          const origPrefix = `[ORIGINAL_SCHEDULE:${origIso}] Originally scheduled: ${origDisplay}`;
          updatedNotes = existingNotes.trim().length > 0 ? `${origPrefix}\n${existingNotes}` : origPrefix;
        }

        let targetIstY = curY;
        let targetIstM = curM;
        let targetIstD = curD;

        if (work.customerId) {
          const customerPolicy = await this.prisma.attendancePolicy.findFirst({
            where: { customerId: work.customerId, isActive: true },
          });
          const workingDaysPerWeek = customerPolicy?.workingDaysPerWeek ?? 6;
          const targetDateObj = new Date(Date.UTC(targetIstY, targetIstM, targetIstD, 12, 0, 0, 0));
          const dayOfWeek = targetDateObj.getUTCDay();

          if (workingDaysPerWeek <= 5 && (dayOfWeek === 0 || dayOfWeek === 6)) {
            const daysToAdd = dayOfWeek === 6 ? 2 : 1;
            targetDateObj.setUTCDate(targetDateObj.getUTCDate() + daysToAdd);
            targetIstY = targetDateObj.getUTCFullYear();
            targetIstM = targetDateObj.getUTCMonth();
            targetIstD = targetDateObj.getUTCDate();
          } else if (workingDaysPerWeek === 6 && dayOfWeek === 0) {
            targetDateObj.setUTCDate(targetDateObj.getUTCDate() + 1);
            targetIstY = targetDateObj.getUTCFullYear();
            targetIstM = targetDateObj.getUTCMonth();
            targetIstD = targetDateObj.getUTCDate();
          }
        }

        const targetDateUtc = new Date(Date.UTC(targetIstY, targetIstM, targetIstD, 4, 30, 0, 0));

        await this.prisma.work.update({
          where: { id: work.id },
          data: {
            scheduledDate: targetDateUtc,
            notes: updatedNotes,
          },
        });
        count++;
      } catch (err: any) {
        this.logger.error(`Error in notification scheduler carrying forward work #${work.id}: ${err?.message}`);
      }
    }
    return count;
  }

  /**
   * Cleanup notifications older than 7 days
   */
  async cleanupOldNotifications(): Promise<number> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const res = await this.prisma.notification.deleteMany({
        where: {
          createdAt: { lt: sevenDaysAgo },
        },
      });
      return res.count;
    } catch (err: any) {
      this.logger.error(`Failed to cleanup old notifications: ${err?.message}`, err?.stack);
      return 0;
    }
  }

  /**
   * Check for active subscriptions expiring (dayOffset = 3 for 3-day reminder, dayOffset = 0 for same-day reminder)
   */
  async checkSubscriptionExpiries(dayOffset = 3): Promise<number> {
    const { start, end } = getIstDayWindow(dayOffset);
    let notifiedCount = 0;
    const isToday = dayOffset === 0;
    const notifType = isToday ? 'SUBSCRIPTION_EXPIRING_TODAY' : 'SUBSCRIPTION_EXPIRING_SOON';
    // 24 hours lookback for same-day, 7 days for 3-day reminder
    const lookbackThreshold = new Date(Date.now() - (isToday ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000));

    try {
      const expiringSubs = await this.prisma.customerSubscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          deletedAt: null,
          endDate: { gte: start, lte: end },
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              users: { where: { deletedAt: null }, select: { id: true }, take: 1 },
            },
          },
          plan: { select: { id: true, name: true } },
        },
      });

      for (const sub of expiringSubs) {
        // Prevent duplicate notification
        const alreadyNotified = await this.prisma.notification.findFirst({
          where: {
            customerId: sub.customerId,
            type: notifType,
            createdAt: { gte: lookbackThreshold },
          },
        });

        if (alreadyNotified) {
          continue;
        }

        const res = await this.notificationService.sendSubscriptionExpiringNotification(
          sub.customerId,
          sub,
          dayOffset,
        );

        if (res) {
          notifiedCount++;
          this.logger.log(
            `Sent ${isToday ? 'same-day' : '3-day'} subscription expiry notification to customer #${sub.customerId} for plan "${sub.plan?.name}"`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in checkSubscriptionExpiries(offset=${dayOffset}): ${err?.message}`, err?.stack);
    }

    return notifiedCount;
  }

  /**
   * Check for calendar schedules occurring tomorrow (Day offset = 1)
   */
  async checkTomorrowCalendarSchedules(): Promise<{ customerCount: number; employeeCount: number }> {
    const { start: tomorrowStart, end: tomorrowEnd } = getIstDayWindow(1);
    let customerCount = 0;
    let employeeCount = 0;

    try {
      const upcomingWorks = await this.prisma.work.findMany({
        where: {
          scheduledDate: { gte: tomorrowStart, lte: tomorrowEnd },
          status: { notIn: [WorkStatus.CANCELLED, WorkStatus.COMPLETED] },
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              users: { where: { deletedAt: null }, select: { id: true }, take: 1 },
            },
          },
          assignedTo: {
            select: { id: true, userId: true, firstName: true, lastName: true },
          },
        },
      });

      const todayStart = getIstDayWindow(0).start;

      for (const work of upcomingWorks) {
        // 1. Notify Customer
        const customerUser = work.customer?.users?.[0];
        if (customerUser) {
          const alreadyNotifiedCustomer = await this.prisma.notification.findFirst({
            where: {
              customerId: work.customerId,
              userId: customerUser.id,
              type: 'CALENDAR_SCHEDULE_REMINDER',
              createdAt: { gte: todayStart },
            },
          });

          if (!alreadyNotifiedCustomer) {
            const res = await this.notificationService.sendCalendarReminderNotification({
              recipientType: 'CUSTOMER',
              userId: customerUser.id,
              customerId: work.customerId,
              work,
            });
            if (res) customerCount++;
          }
        }

        // 2. Notify Assigned Employee
        if (work.assignedTo && work.assignedTo.userId) {
          const employeeUserId = work.assignedTo.userId;

          const alreadyNotifiedEmp = await this.prisma.notification.findFirst({
            where: {
              userId: employeeUserId,
              type: 'CALENDAR_SCHEDULE_REMINDER',
              createdAt: { gte: todayStart },
            },
          });

          if (!alreadyNotifiedEmp) {
            const res = await this.notificationService.sendCalendarReminderNotification({
              recipientType: 'EMPLOYEE',
              userId: employeeUserId,
              customerId: work.customerId,
              work,
            });
            if (res) employeeCount++;
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in checkTomorrowCalendarSchedules: ${err?.message}`, err?.stack);
    }

    return { customerCount, employeeCount };
  }

  /**
   * 3-Day Follow-Up Reminder for Leads
   * Scans leads currently in FOLLOW_UP status whose latest transition to FOLLOW_UP
   * occurred >= 3 days ago, and sends a reminder to the responsible BPO.
   */
  async checkLeadFollowUpReminders(): Promise<number> {
    let notifiedCount = 0;
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const followUpLeads = await this.prisma.lead.findMany({
        where: {
          status: LeadStatus.FOLLOW_UP,
          deletedAt: null,
        },
        select: {
          id: true,
          customerId: true,
          title: true,
          firstName: true,
          lastName: true,
          companyName: true,
          status: true,
          stageId: true,
          assignedToId: true,
          employeeId: true,
          createdAt: true,
          employee: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      });

      for (const lead of followUpLeads) {
        // 1. Resolve latest transition into FOLLOW_UP
        const latestHistory = await this.prisma.leadStatusHistory.findFirst({
          where: { leadId: lead.id },
          orderBy: { createdAt: 'desc' },
        });

        // If the lead transitioned away from FOLLOW_UP according to history, skip
        if (latestHistory && latestHistory.toStatus !== LeadStatus.FOLLOW_UP) {
          continue;
        }

        const transitionTimestamp: Date =
          latestHistory?.toStatus === LeadStatus.FOLLOW_UP
            ? latestHistory.createdAt
            : lead.createdAt;

        // 2. Exact 3-day calculation: must be >= 3 days from the latest transition to FOLLOW_UP
        const eligibleAtMs = transitionTimestamp.getTime() + THREE_DAYS_MS;
        if (now < eligibleAtMs) {
          continue;
        }

        // 3. Resolve responsible BPO recipient using existing Lead ownership/assignment relationship
        let bpoUserId: number | null = lead.assignedToId ? Number(lead.assignedToId) : null;
        if (!bpoUserId && lead.employee?.userId) {
          bpoUserId = Number(lead.employee.userId);
        }
        if (!bpoUserId && lead.employeeId) {
          const emp = await this.prisma.employee.findUnique({
            where: { id: lead.employeeId },
            select: { userId: true },
          });
          if (emp?.userId) {
            bpoUserId = Number(emp.userId);
          }
        }

        if (!bpoUserId) {
          this.logger.warn(
            `[FOLLOW_UP_REMINDER] Lead #${lead.id} is in Follow-Up for 3+ days but has no assigned BPO recipient. Skipping.`,
          );
          continue;
        }

        // 4. Duplicate notification protection (Idempotency)
        // Check if an in-app notification of type LEAD_FOLLOW_UP_REMINDER was already sent for this lead during this cycle
        const existingNotifications = await this.prisma.notification.findMany({
          where: {
            customerId: lead.customerId,
            userId: bpoUserId,
            type: 'LEAD_FOLLOW_UP_REMINDER',
            createdAt: { gte: transitionTimestamp },
          },
          select: { id: true, data: true },
        });

        const alreadySent = existingNotifications.some((n: any) => {
          const d = (n.data as any) || {};
          return String(d.leadId) === String(lead.id);
        });

        if (alreadySent) {
          continue;
        }

        // Also check if existing LeadReminder record is already marked completed for this cycle
        const existingReminder = await this.prisma.leadReminder.findFirst({
          where: {
            leadId: lead.id,
            title: '3_DAY_FOLLOW_UP_REMINDER',
            createdAt: { gte: transitionTimestamp },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingReminder?.isCompleted) {
          continue;
        }

        // 5. Send notification to the responsible BPO
        const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
        const leadDisplayName = lead.title || leadFullName || lead.companyName || `Lead #${lead.id}`;

        const res = await this.notificationService.sendLeadFollowUpReminderNotification({
          customerId: lead.customerId,
          leadId: lead.id,
          leadName: leadDisplayName,
          companyName: lead.companyName,
          transitionDate: transitionTimestamp,
          bpoUserId,
        });

        if (res) {
          notifiedCount++;
          this.logger.log(
            `[FOLLOW_UP_REMINDER] Sent 3-day reminder to BPO user #${bpoUserId} for lead #${lead.id} (${leadDisplayName})`,
          );

          // 6. Record the event as processed (mark LeadReminder as completed)
          try {
            if (existingReminder) {
              await this.prisma.leadReminder.update({
                where: { id: existingReminder.id },
                data: { isCompleted: true },
              });
            } else {
              await this.prisma.leadReminder.create({
                data: {
                  leadId: lead.id,
                  remindAt: new Date(eligibleAtMs),
                  title: '3_DAY_FOLLOW_UP_REMINDER',
                  isCompleted: true,
                },
              });
            }
          } catch (remErr: any) {
            this.logger.warn(`[FOLLOW_UP_REMINDER] Failed to update leadReminder record: ${remErr?.message}`);
          }

          // 7. Record timeline activity
          try {
            await this.prisma.leadActivityTimeline.create({
              data: {
                leadId: lead.id,
                action: 'FOLLOW_UP_REMINDER_SENT',
                description: '3-Day Follow-Up reminder sent to responsible BPO',
                metadata: {
                  bpoUserId,
                  leadId: lead.id,
                  transitionDate: transitionTimestamp.toISOString(),
                  notifiedAt: new Date().toISOString(),
                },
              },
            });
          } catch (tlErr: any) {
            this.logger.warn(`[FOLLOW_UP_REMINDER] Failed to log timeline activity: ${tlErr?.message}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in checkLeadFollowUpReminders: ${err?.message}`, err?.stack);
    }

    return notifiedCount;
  }
}
