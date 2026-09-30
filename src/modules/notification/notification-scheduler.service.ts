import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { SubscriptionStatus, WorkStatus } from '@prisma/client';

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

    const subCount3Days = await this.checkSubscriptionExpiries(3);
    const subCountToday = await this.checkSubscriptionExpiries(0);
    const { customerCount, employeeCount } = await this.checkTomorrowCalendarSchedules();
    const scheduledOffersCount = await this.notificationService.processScheduledCampaigns();
    const cleanupCount = await this.cleanupOldNotifications();

    this.logger.log(
      `[SCHEDULER_CYCLE_COMPLETE] Subscriptions (3-Day): ${subCount3Days} | Subscriptions (Today): ${subCountToday} | Customer Calendar: ${customerCount} | Employee Calendar: ${employeeCount} | Scheduled Offers: ${scheduledOffersCount} | Notifications Cleaned: ${cleanupCount}`,
    );

    return {
      subscriptionsNotified3Days: subCount3Days,
      subscriptionsNotifiedToday: subCountToday,
      customerCalendarNotified: customerCount,
      employeeCalendarNotified: employeeCount,
      scheduledOffersNotified: scheduledOffersCount,
      notificationsCleaned: cleanupCount,
    };
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
}
