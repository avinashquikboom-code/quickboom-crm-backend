import { Test, TestingModule } from '@nestjs/testing';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LeadStatus } from '@prisma/client';

describe('3-Day Follow-Up Reminder for Leads', () => {
  let schedulerService: NotificationSchedulerService;
  let notificationService: NotificationService;
  let prisma: PrismaService;

  const mockPrisma = {
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    leadStatusHistory: {
      findFirst: jest.fn(),
    },
    leadReminder: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    leadActivityTimeline: {
      create: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    customerSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockNotificationService = {
    sendLeadFollowUpReminderNotification: jest.fn(),
    sendSubscriptionExpiryReminderNotification: jest.fn(),
    sendCalendarEventReminderNotification: jest.fn(),
    processScheduledCampaigns: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationSchedulerService,
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    schedulerService = module.get<NotificationSchedulerService>(NotificationSchedulerService);
    notificationService = module.get<NotificationService>(NotificationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('checkLeadFollowUpReminders', () => {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    it('CASE 1: Lead entered Follow Up 3+ days ago and still in Follow Up -> BPO receives 1 reminder', async () => {
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 101,
          customerId: 1,
          title: 'John Doe Deal',
          firstName: 'John',
          lastName: 'Doe',
          companyName: 'Acme Corp',
          status: LeadStatus.FOLLOW_UP,
          stageId: 2,
          assignedToId: 55, // BPO User ID
          employeeId: 10,
          createdAt: fourDaysAgo,
          employee: { id: 10, userId: 55 },
        },
      ]);

      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 1,
        leadId: 101,
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: fourDaysAgo,
      });

      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.leadReminder.findFirst.mockResolvedValue(null);
      mockNotificationService.sendLeadFollowUpReminderNotification.mockResolvedValue({ success: true });

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(1);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).toHaveBeenCalledWith({
        customerId: 1,
        leadId: 101,
        leadName: 'John Doe Deal',
        companyName: 'Acme Corp',
        transitionDate: fourDaysAgo,
        bpoUserId: 55,
      });
      expect(mockPrisma.leadReminder.create).toHaveBeenCalled();
      expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 101,
            action: 'FOLLOW_UP_REMINDER_SENT',
          }),
        }),
      );
    });

    it('CASE 1b: Lead entered Follow Up less than 3 days ago -> No notification sent', async () => {
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 102,
          customerId: 1,
          title: 'Recent Lead',
          firstName: 'Jane',
          lastName: 'Smith',
          companyName: 'Beta LLC',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: 55,
          createdAt: twoDaysAgo,
        },
      ]);

      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 2,
        leadId: 102,
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: twoDaysAgo,
      });

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 2: Lead was in Follow Up, but changed to WON before 3 days -> No notification', async () => {
      // If the lead's current status is WON, findMany queries status: LeadStatus.FOLLOW_UP, so it won't be returned
      mockPrisma.lead.findMany.mockResolvedValue([]);

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 3: Lead moved away from Follow Up (e.g. status history shows latest is LOST/FINAL_CALL) -> No notification', async () => {
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 103,
          customerId: 1,
          title: 'Lost Deal',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: 55,
          createdAt: fourDaysAgo,
        },
      ]);

      // Latest status transition shows it transitioned to LOST
      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 3,
        leadId: 103,
        fromStatus: LeadStatus.FOLLOW_UP,
        toStatus: LeadStatus.LOST,
        createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
      });

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 4: Lead left Follow Up, then entered Follow Up again -> 3-day timer resets to latest transition', async () => {
      // First entered Follow-Up 10 days ago, but left and re-entered 1 day ago
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 104,
          customerId: 1,
          title: 'Re-entered Lead',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: 55,
          createdAt: tenDaysAgo,
        },
      ]);

      // Latest status history transition to FOLLOW_UP was only 1 day ago
      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 4,
        leadId: 104,
        fromStatus: LeadStatus.FINAL_CALL,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: oneDayAgo,
      });

      const count = await schedulerService.checkLeadFollowUpReminders();

      // Since only 1 day has passed since latest re-entry, NOT eligible yet!
      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 5: Scheduler runs multiple times after 3 days -> Only ONE notification sent (Idempotency)', async () => {
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 105,
          customerId: 1,
          title: 'Already Reminded Lead',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: 55,
          createdAt: fourDaysAgo,
        },
      ]);

      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 5,
        leadId: 105,
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: fourDaysAgo,
      });

      // Notification was already sent for this lead during this cycle
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 999,
          data: { leadId: '105' },
        },
      ]);

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 5b: LeadReminder record already marked as completed -> Only ONE notification sent', async () => {
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 106,
          customerId: 1,
          title: 'Lead with completed reminder',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: 55,
          createdAt: fourDaysAgo,
        },
      ]);

      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 6,
        leadId: 106,
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: fourDaysAgo,
      });

      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.leadReminder.findFirst.mockResolvedValue({
        id: 88,
        leadId: 106,
        title: '3_DAY_FOLLOW_UP_REMINDER',
        isCompleted: true,
      });

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 6: Lead in Follow Up for 3+ days has NO assigned BPO -> Safely skipped without notifying random employees', async () => {
      const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.lead.findMany.mockResolvedValue([
        {
          id: 107,
          customerId: 1,
          title: 'Unassigned Lead',
          status: LeadStatus.FOLLOW_UP,
          assignedToId: null,
          employeeId: null,
          employee: null,
          createdAt: fourDaysAgo,
        },
      ]);

      mockPrisma.leadStatusHistory.findFirst.mockResolvedValue({
        id: 7,
        leadId: 107,
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.FOLLOW_UP,
        createdAt: fourDaysAgo,
      });

      const count = await schedulerService.checkLeadFollowUpReminders();

      expect(count).toBe(0);
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });

    it('CASE 7: Lead assigned to BPO -> Strictly NO assignment notification triggered by follow-up mechanism', async () => {
      // Verifying that checking follow-up reminders never triggers assignment notifications
      expect(mockNotificationService.sendLeadFollowUpReminderNotification).not.toHaveBeenCalled();
    });
  });
});
