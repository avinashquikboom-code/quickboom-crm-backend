import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkStatus, WorkType, TaskStatus, SubscriptionStatus } from '@prisma/client';

describe('Customer-Scheduled Tasks Visibility in Employee Calendar and My Work', () => {
  let service: WorkService;
  let prisma: any;
  let workPermissionService: any;
  let planAccessService: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      team: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      work: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      workTask: {
        createMany: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      planEntitlement: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerSubscription: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      attendancePolicy: {
        findFirst: jest.fn(),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    };

    workPermissionService = {
      getAllowedActivityTypesForEmployee: jest.fn().mockImplementation(async (empId: number) => {
        if (empId === 10) {
          // Employee 10 is a videographer/shooter
          return {
            role: 'Videographer',
            allowedTypes: new Set(['REEL_SHOOT', 'VIDEO_SHOOT', 'REELS_SHOOT', 'REEL']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        if (empId === 20) {
          // Employee 20 is a video editor
          return {
            role: 'Video Editor',
            allowedTypes: new Set(['REEL_EDIT', 'EDITING', 'VIDEO_EDITING']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        if (empId === 30) {
          // Employee 30 is graphic designer
          return {
            role: 'Graphic Designer',
            allowedTypes: new Set(['POST_DESIGN', 'STORY_DESIGN']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        return {
          role: 'Employee',
          allowedTypes: new Set(['REEL_SHOOT', 'REEL_EDIT']),
          isFullAccess: true,
          isProductionManager: false,
        };
      }),
    };

    planAccessService = {
      getEffectivePlan: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkPermissionService, useValue: workPermissionService },
        { provide: PlanAccessService, useValue: planAccessService },
      ],
    }).compile();

    service = module.get<WorkService>(WorkService);
  });

  describe('1. Task Created in Customer Calendar Auto-Assigns Eligible Staff', () => {
    it('auto-assigns shooter (10) and video editor (20) to customer scheduled reel', async () => {
      // Customer 1 has assigned team 5
      prisma.customer.findUnique.mockResolvedValue({
        id: 1,
        assignedTeamId: 5,
        assignedEmployeeId: null,
      });

      // Active plan
      jest.spyOn(service as any, 'getActivePlanDirect').mockResolvedValue({
        isActive: true,
        isExpired: false,
        planId: 1,
        planCode: 'STANDARD',
        endDate: new Date('2026-12-31'),
      });

      // Attendance policy (allow scheduling)
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);

      // Entitlement
      prisma.planEntitlement.findFirst.mockResolvedValue({
        id: 1,
        customerId: 1,
        serviceName: 'Reels',
        totalQty: 6,
        usedQty: 1,
        scheduledQty: 0,
      });
      prisma.planEntitlement.update.mockResolvedValue({});

      // Subscription
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 10,
        customerId: 1,
      });

      // Team 5 has shooter 10 and editor 20
      prisma.team.findUnique.mockResolvedValue({
        id: 5,
        name: 'Production Team Alpha',
        description: 'Video Production Team',
        members: [
          { employeeId: 10, employee: { id: 10, firstName: 'Sam', lastName: 'Shooter', status: 'ACTIVE' } },
          { employeeId: 20, employee: { id: 20, firstName: 'Eddie', lastName: 'Editor', status: 'ACTIVE' } },
        ],
      });

      // Mock work creation
      prisma.work.create.mockImplementation((args: any) => ({
        id: 501,
        ...args.data,
        customer: { id: 1, name: 'Acme Corp' },
        assignedTo: { id: args.data.assignedToId, firstName: 'Sam', lastName: 'Shooter' },
        editor: { id: args.data.editorId, firstName: 'Eddie', lastName: 'Editor' },
        tasks: [],
      }));

      // Customer creates schedule for REELS_SHOOT
      const created = await service.create(1, {
        workType: WorkType.REELS_SHOOT,
        title: 'Product Launch Reel',
        scheduledDate: '2026-10-15',
        scheduledTime: '11:00 AM',
      });

      // Verified: Work assigned to shooter (10), editor assigned to (20), status ASSIGNED
      expect(created.assignedToId).toBe(10);
      expect(created.editorId).toBe(20);
      expect(created.status).toBe(WorkStatus.ASSIGNED);

      // Verified: WorkTask multi-step pipeline created
      expect(prisma.workTask.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ workId: 501, title: 'Reels Video Shoot', assignedToId: 10 }),
          expect.objectContaining({ workId: 501, title: 'Video Editing & Color Grading', assignedToId: 20 }),
        ]),
      });
    });
  });

  describe('2. Visibility in Employee Calendar on Scheduled Date', () => {
    it('appears in assigned employee (10) calendar for 2026-10-15', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 10,
        userId: 100,
        firstName: 'Sam',
        lastName: 'Shooter',
        customerId: 1,
        designation: { name: 'Videographer' },
      });

      const workRecord = {
        id: 501,
        customerId: 1,
        title: 'Product Launch Reel',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-10-15T10:00:00.000Z'),
        scheduledTime: '11:00 AM',
        status: WorkStatus.ASSIGNED,
        assignedToId: 10,
        editorId: 20,
        customer: { id: 1, name: 'Acme Corp' },
        assignedTo: { id: 10, firstName: 'Sam', lastName: 'Shooter' },
        editor: { id: 20, firstName: 'Eddie', lastName: 'Editor' },
        tasks: [
          { id: 1, title: 'Reels Video Shoot', assignedToId: 10, assignedTo: { id: 10, firstName: 'Sam', lastName: 'Shooter' } },
        ],
      };

      prisma.work.findMany.mockResolvedValue([workRecord]);

      const calendarItems = await service.getEmployeeCalendar(10, {
        date: '2026-10-15',
      });

      expect(calendarItems).toHaveLength(1);
      expect(calendarItems[0].id).toBe('501');
      expect(calendarItems[0].scheduledDate).toBe('2026-10-15');
      expect(calendarItems[0].assignedToId).toBe(10);
      expect(calendarItems[0].assignedEmployee).toBe('Sam Shooter');
    });
  });

  describe('3. Visibility for Assigned Video Editor (20)', () => {
    it('appears in Video Editor (20) calendar for 2026-10-15', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 20,
        userId: 200,
        firstName: 'Eddie',
        lastName: 'Editor',
        customerId: 1,
        designation: { name: 'Video Editor' },
      });

      const workRecord = {
        id: 501,
        customerId: 1,
        title: 'Product Launch Reel',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-10-15T10:00:00.000Z'),
        scheduledTime: '11:00 AM',
        status: WorkStatus.ASSIGNED,
        assignedToId: 10,
        editorId: 20,
        customer: { id: 1, name: 'Acme Corp' },
        assignedTo: { id: 10, firstName: 'Sam', lastName: 'Shooter' },
        editor: { id: 20, firstName: 'Eddie', lastName: 'Editor' },
        tasks: [
          { id: 2, title: 'Video Editing & Color Grading', assignedToId: 20, assignedTo: { id: 20, firstName: 'Eddie', lastName: 'Editor' } },
        ],
      };

      prisma.work.findMany.mockResolvedValue([workRecord]);

      const calendarItems = await service.getEmployeeCalendar(20, {
        date: '2026-10-15',
      });

      expect(calendarItems).toHaveLength(1);
      expect(calendarItems[0].id).toBe('501');
      expect(calendarItems[0].editorId).toBe(20);
      expect(calendarItems[0].editorName).toBe('Eddie Editor');
    });
  });

  describe('4. Full Work Visibility in My Work (Unconstrained Date Range)', () => {
    it('returns task scheduled in any month when queried with no date constraint', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 10,
        userId: 100,
        firstName: 'Sam',
        lastName: 'Shooter',
        customerId: 1,
        designation: { name: 'Videographer' },
      });

      const futureMonthWork = {
        id: 601,
        customerId: 1,
        title: 'December Promo Reel',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-12-20T10:00:00.000Z'),
        scheduledTime: '02:00 PM',
        status: WorkStatus.ASSIGNED,
        assignedToId: 10,
        editorId: 20,
        customer: { id: 1, name: 'Acme Corp' },
        assignedTo: { id: 10, firstName: 'Sam', lastName: 'Shooter' },
        editor: { id: 20, firstName: 'Eddie', lastName: 'Editor' },
        tasks: [],
      };

      prisma.work.findMany.mockResolvedValue([futureMonthWork]);

      // Query with {} (no date, no month) - like My Work does
      const myWorkItems = await service.getEmployeeCalendar(10, {});

      expect(myWorkItems).toHaveLength(1);
      expect(myWorkItems[0].id).toBe('601');
      expect(myWorkItems[0].scheduledDate).toBe('2026-12-20');
      expect(myWorkItems[0].title).toBe('December Promo Reel');
    });
  });

  describe('5. Task Isolation: Does Not Leak to Wrong Employee', () => {
    it('does not return task assigned to Employee 10 when Employee 30 queries calendar', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 30,
        userId: 300,
        firstName: 'Gina',
        lastName: 'Graphic',
        customerId: 1,
        designation: { name: 'Graphic Designer' },
      });

      const workRecordAssignedTo10 = {
        id: 501,
        customerId: 1,
        title: 'Product Launch Reel',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-10-15T10:00:00.000Z'),
        scheduledTime: '11:00 AM',
        status: WorkStatus.ASSIGNED,
        assignedToId: 10,
        editorId: 20,
        customer: { id: 1, name: 'Acme Corp' },
        assignedTo: { id: 10, firstName: 'Sam', lastName: 'Shooter' },
        editor: { id: 20, firstName: 'Eddie', lastName: 'Editor' },
        tasks: [],
      };

      // Mock findMany returning all works for company
      prisma.work.findMany.mockResolvedValue([workRecordAssignedTo10]);

      // Employee 30 queries calendar
      const employee30Items = await service.getEmployeeCalendar(30, {
        date: '2026-10-15',
      });

      // Employee 30 must NOT see Employee 10's task!
      expect(employee30Items).toHaveLength(0);
    });
  });

  describe('6. Canonical Employee ID Resolution', () => {
    it('resolves User ID (100) to Employee ID (10)', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValue({ id: 10 });

      const resolved = await service.resolveCanonicalEmployeeId(100);
      expect(resolved).toBe(10);
    });

    it('resolves Employee Code (EMP-010) to Employee ID (10)', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 10 });

      const resolved = await service.resolveCanonicalEmployeeId('EMP-010', 1);
      expect(resolved).toBe(10);
    });
  });
});
