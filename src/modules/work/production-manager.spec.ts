import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { WorkPermissionService } from './work-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkStatus } from '@prisma/client';

describe('Production Manager Functionality & Cross-Role Visibility', () => {
  let workService: WorkService;
  let workPermissionService: WorkPermissionService;
  let prisma: any;

  const mockTenantCustomerId = 1;

  beforeEach(async () => {
    prisma = {
      work: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      team: {
        findMany: jest.fn(),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        {
          provide: WorkPermissionService,
          useValue: {
            getAllowedActivityTypesForEmployee: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    workService = module.get<WorkService>(WorkService);
    workPermissionService = module.get<WorkPermissionService>(WorkPermissionService);
  });

  describe('1. Production Manager vs Normal Employee Scoping', () => {
    it('allows Production Manager to see all employees and teams work under the workspace', async () => {
      // Authenticated employee is a Production Manager
      prisma.employee.findUnique.mockResolvedValue({
        id: 50,
        userId: 100,
        firstName: 'Prod',
        lastName: 'Manager',
        customerId: mockTenantCustomerId,
      });

      jest.spyOn(workPermissionService, 'getAllowedActivityTypesForEmployee').mockResolvedValue({
        role: 'Production Manager',
        allowedTypes: new Set(['REEL_SHOOT', 'REEL_EDIT', 'REEL_POST']),
        isFullAccess: true,
        isProductionManager: true,
        workPermissions: ['reel_shoot', 'video_edit', 'reel_post'],
      });

      const mockWorks = [
        {
          id: 101,
          customerId: 10,
          title: 'Reel Shoot',
          workType: 'REEL_SHOOT',
          status: WorkStatus.SCHEDULED,
          scheduledDate: new Date('2026-09-07T10:00:00Z'),
          assignedToId: 1, // Employee A
          assignedTo: { id: 1, firstName: 'Employee', lastName: 'A' },
          customer: { id: 10, name: 'Test Pvt Ltd' },
        },
        {
          id: 102,
          customerId: 10,
          title: 'Reel Edit',
          workType: 'REEL_EDIT',
          status: WorkStatus.IN_PROGRESS,
          scheduledDate: new Date('2026-09-07T14:00:00Z'),
          assignedToId: 2, // Employee B
          assignedTo: { id: 2, firstName: 'Employee', lastName: 'B' },
          customer: { id: 10, name: 'Test Pvt Ltd' },
        },
        {
          id: 103,
          customerId: 10,
          title: 'Reel Post',
          workType: 'REEL_POST',
          status: WorkStatus.SCHEDULED,
          scheduledDate: new Date('2026-09-08T10:00:00Z'),
          assignedToId: 1, // Employee A
          assignedTo: { id: 1, firstName: 'Employee', lastName: 'A' },
          customer: { id: 10, name: 'Test Pvt Ltd' },
        },
      ];

      prisma.work.findMany.mockResolvedValue(mockWorks);

      const result = await workService.getEmployeeCalendar(50, {});

      expect(prisma.work.findMany).toHaveBeenCalled();
      const queryWhere = prisma.work.findMany.mock.calls[0][0].where;

      // Notice: For Production Manager, where should NOT restrict to assignedToId == 50!
      expect(queryWhere.OR).toBeUndefined();
      expect(result.length).toBe(3);
      expect(result.map((w) => w.assignedEmployee)).toEqual(['Employee A', 'Employee B', 'Employee A']);
    });

    it('strictly restricts Normal Employee to only their assigned work', async () => {
      // Authenticated employee is a normal Employee (e.g. Employee B, id=2)
      prisma.employee.findUnique.mockResolvedValue({
        id: 2,
        userId: 200,
        firstName: 'Employee',
        lastName: 'B',
        customerId: mockTenantCustomerId,
      });

      jest.spyOn(workPermissionService, 'getAllowedActivityTypesForEmployee').mockResolvedValue({
        role: 'Video Editor',
        allowedTypes: new Set(['REEL_EDIT', 'VIDEO_EDITING']),
        isFullAccess: false,
        isProductionManager: false,
        workPermissions: ['video_edit'],
      });

      prisma.work.findMany.mockResolvedValue([]);

      await workService.getEmployeeCalendar(2, {});

      const queryWhere = prisma.work.findMany.mock.calls[0][0].where;
      // Normal employee must have strict OR condition targeting only employee #2
      expect(queryWhere.OR).toBeDefined();
      expect(queryWhere.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ assignedToId: 2 }),
          expect.objectContaining({ editorId: 2 }),
        ]),
      );
    });
  });

  describe('2. Supervisory Filtering', () => {
    it('applies customerId, employeeId, teamId, and status filters when requested by Production Manager', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 50,
        userId: 100,
        firstName: 'Prod',
        lastName: 'Manager',
        customerId: mockTenantCustomerId,
      });

      jest.spyOn(workPermissionService, 'getAllowedActivityTypesForEmployee').mockResolvedValue({
        role: 'Production Manager',
        allowedTypes: new Set(['REEL_SHOOT', 'REEL_EDIT']),
        isFullAccess: true,
        isProductionManager: true,
        workPermissions: ['reel_shoot', 'video_edit'],
      });

      prisma.work.findMany.mockResolvedValue([]);

      await workService.getEmployeeCalendar(50, {
        customerId: 10,
        employeeId: 2,
        teamId: 5,
        status: 'IN_PROGRESS',
      });

      const queryWhere = prisma.work.findMany.mock.calls[0][0].where;
      expect(queryWhere.customerId).toBe(10);
      expect(queryWhere.status).toEqual({ in: [WorkStatus.IN_PROGRESS, WorkStatus.PROCESSING] });
      expect(queryWhere.AND).toBeDefined();
    });
  });

  describe('Production filter options', () => {
    it('returns only employees and teams belonging to the Production Team', async () => {
      jest.spyOn(workService, 'getEmployeeCalendar').mockResolvedValue([
        {
          customerId: 10,
          customerName: 'Test Customer',
          assignedTeam: 'Production Team',
          assignedToId: 20,
          assignedEmployee: 'Bhavesh Gandhi',
          editorId: 21,
          editorName: 'BPO Editor',
          teamId: 30,
        },
      ] as any);
      prisma.employee.findUnique.mockResolvedValue({
        id: 50,
        customerId: mockTenantCustomerId,
      });
      prisma.employee.findMany.mockResolvedValue([
        { id: 40, firstName: 'Production', lastName: 'Employee' },
      ]);
      prisma.team.findMany.mockResolvedValue([
        { id: 30, name: 'Production Team' },
      ]);
      prisma.customer.findMany.mockResolvedValue([]);

      const result = await workService.getProductionFilterOptions(50);

      expect(result.employees).toEqual([
        { id: 40, name: 'Production Employee' },
      ]);
      expect(result.teams).toEqual([
        { id: 30, name: 'Production Team' },
      ]);
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { teamMembers: { some: { team: expect.objectContaining({ customerId: mockTenantCustomerId }) } } },
              { ledTeams: { some: expect.objectContaining({ customerId: mockTenantCustomerId }) } },
            ],
          }),
        }),
      );
    });
  });

  describe('3. Production Metrics Calculation', () => {
    it('accurately derives total, pending, inProgress, completed, blocked, today, and overdue metrics', async () => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      prisma.employee.findUnique.mockResolvedValue({
        id: 50,
        userId: 100,
        firstName: 'Prod',
        lastName: 'Manager',
        customerId: mockTenantCustomerId,
      });

      jest.spyOn(workPermissionService, 'getAllowedActivityTypesForEmployee').mockResolvedValue({
        role: 'Production Manager',
        allowedTypes: new Set(['REEL_SHOOT', 'REEL_EDIT']),
        isFullAccess: true,
        isProductionManager: true,
        workPermissions: ['reel_shoot', 'video_edit'],
      });

      const mockCalendarItems = [
        {
          id: '1',
          scheduledDate: todayStr,
          status: 'SCHEDULED',
        },
        {
          id: '2',
          scheduledDate: todayStr,
          status: 'IN_PROGRESS',
        },
        {
          id: '3',
          scheduledDate: yesterdayStr,
          status: 'IN_PROGRESS', // Overdue because scheduled for yesterday and still in progress
        },
        {
          id: '4',
          scheduledDate: yesterdayStr,
          status: 'COMPLETED', // Not overdue because completed
        },
        {
          id: '5',
          scheduledDate: todayStr,
          status: 'BLOCKED',
        },
      ];

      jest.spyOn(workService, 'getEmployeeCalendar').mockResolvedValue(mockCalendarItems as any);

      const metrics = await workService.getProductionMetrics(50, {});

      expect(metrics.total).toBe(5);
      expect(metrics.pending).toBe(1);
      expect(metrics.inProgress).toBe(2);
      expect(metrics.completed).toBe(1);
      expect(metrics.blocked).toBe(1);
      expect(metrics.today).toBe(3);
      expect(metrics.overdue).toBe(1);
    });
  });

  describe('4. Work Progress Update & Status Persistence', () => {
    it('persists employee notes update and status change to the same Work record in database', async () => {
      const existingWork = {
        id: 123,
        customerId: 10,
        title: 'Reel Edit',
        status: WorkStatus.IN_PROGRESS,
        notes: 'Initial requirements',
      };

      prisma.work.findFirst.mockResolvedValue(existingWork);
      prisma.work.update.mockResolvedValue({
        ...existingWork,
        status: WorkStatus.COMPLETED,
        notes: 'Editing 80% complete. Final cut revision done.',
        completedAt: new Date(),
      });

      const updated = await workService.update(
        10,
        123,
        {
          status: WorkStatus.COMPLETED,
          notes: 'Editing 80% complete. Final cut revision done.',
        },
        50,
      );

      expect(prisma.work.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 123 },
          data: expect.objectContaining({
            status: WorkStatus.COMPLETED,
            notes: 'Editing 80% complete. Final cut revision done.',
          }),
        }),
      );
      expect(updated.status).toBe(WorkStatus.COMPLETED);
    });
  });
});
