import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkStatus, WorkType, TaskStatus } from '@prisma/client';

describe('Employee Calendar Scheduling Flow and Task Visibility Tests', () => {
  let service: WorkService;
  let prisma: any;
  let workPermissionService: any;

  const mockEmployees: Record<number, any> = {
    19: {
      id: 19,
      userId: 119,
      employeeCode: 'QB-EMP-019',
      firstName: 'Vikram',
      lastName: 'Rathore',
      status: 'ACTIVE',
      customerId: 1,
      designation: { name: 'Operations Executive' },
      department: { name: 'Operations' },
    },
    20: {
      id: 20,
      userId: 120,
      employeeCode: 'QB-EMP-020',
      firstName: 'Alice',
      lastName: 'Editor',
      status: 'ACTIVE',
      customerId: 1,
      designation: { name: 'Video Editor' },
      department: { name: 'Production' },
    },
    10: {
      id: 10,
      userId: 110,
      employeeCode: 'QB-EMP-010',
      firstName: 'John',
      lastName: 'Shooter',
      status: 'ACTIVE',
      customerId: 1,
      designation: { name: 'Reel Shooter' },
      department: { name: 'Production' },
    },
    30: {
      id: 30,
      userId: 130,
      employeeCode: 'QB-EMP-030',
      firstName: 'Maya',
      lastName: 'Designer',
      status: 'ACTIVE',
      customerId: 1,
      designation: { name: 'Graphic Designer' },
      department: { name: 'Production' },
    },
    40: {
      id: 40,
      userId: 140,
      employeeCode: 'QB-EMP-040',
      firstName: 'Rohan',
      lastName: 'Unassigned',
      status: 'ACTIVE',
      customerId: 1,
      designation: { name: 'Video Editor' },
      department: { name: 'Production' },
    },
  };

  const mockWorks = [
    // 1. Task assigned directly to QB-EMP-019
    {
      id: 1,
      customerId: 1,
      workType: WorkType.CONTENT_WRITING,
      title: 'Review Weekly Operational Plan',
      description: 'Review operational deliverable status',
      scheduledDate: new Date('2026-10-15T04:30:00.000Z'), // 10:00 AM IST
      scheduledTime: '10:00 AM',
      status: WorkStatus.IN_PROGRESS,
      assignedToId: 19,
      editorId: null,
      teamId: null,
      notes: null,
      customer: {
        id: 1,
        name: 'QuikBoom Enterprise',
        companyName: 'QuikBoom Corp',
        address: '101 Cyber Hub',
        city: 'Gurugram',
        state: 'Haryana',
        assignedEmployeeId: null,
        assignedTeamId: null,
      },
      assignedTo: mockEmployees[19],
      editor: null,
      tasks: [],
    },
    // 2. Video editing deliverable assigned to Editor 20 (Shooter is 10)
    {
      id: 2,
      customerId: 2,
      workType: WorkType.REEL,
      title: 'Fitness Gym Promotional Reel',
      description: 'Reel shoot and edit',
      scheduledDate: new Date('2026-10-15T04:30:00.000Z'),
      scheduledTime: '11:00 AM',
      status: WorkStatus.ASSIGNED,
      assignedToId: 10,
      editorId: 20,
      teamId: 1,
      notes: null,
      customer: {
        id: 2,
        name: 'Care Fitness Gym',
        companyName: 'Care Fitness',
        address: 'MG Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        assignedEmployeeId: null,
        assignedTeamId: 1,
      },
      assignedTo: mockEmployees[10],
      editor: mockEmployees[20],
      tasks: [
        { id: 101, title: 'Reels Video Shoot', assignedToId: 10, stepOrder: 1, status: TaskStatus.COMPLETED },
        { id: 102, title: 'Video Editing & Color Grading', assignedToId: 20, stepOrder: 2, status: TaskStatus.IN_PROGRESS },
      ],
    },
    // 3. Post Design deliverable assigned to Maya Designer 30
    {
      id: 3,
      customerId: 3,
      workType: WorkType.POST_DESIGN,
      title: 'Festival Offer Creative Post',
      description: 'Design festival offer banner',
      scheduledDate: new Date('2026-10-16T04:30:00.000Z'),
      scheduledTime: '02:00 PM',
      status: WorkStatus.SCHEDULED,
      assignedToId: 30,
      editorId: null,
      teamId: 1,
      notes: null,
      customer: {
        id: 3,
        name: 'Fashion Hub',
        companyName: 'Fashion Hub Retail',
        address: 'Brigade Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        assignedEmployeeId: null,
        assignedTeamId: 1,
      },
      assignedTo: mockEmployees[30],
      editor: null,
      tasks: [
        { id: 103, title: 'Asset Preparation', assignedToId: 30, stepOrder: 1, status: TaskStatus.PENDING },
      ],
    },
    // 4. Completed shooting task assigned to Reel Shooter 10
    {
      id: 4,
      customerId: 4,
      workType: WorkType.SHOOT,
      title: 'Restaurant Ambience Shoot',
      description: 'Shoot ambience reels and photos',
      scheduledDate: new Date('2026-10-14T04:30:00.000Z'),
      scheduledTime: '09:00 AM',
      status: WorkStatus.COMPLETED,
      assignedToId: 10,
      editorId: null,
      teamId: null,
      notes: null,
      customer: {
        id: 4,
        name: 'Spice Bistro',
        companyName: 'Spice Bistro LLP',
        address: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        assignedEmployeeId: null,
        assignedTeamId: null,
      },
      assignedTo: mockEmployees[10],
      editor: null,
      tasks: [],
    },
  ];

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          return mockEmployees[where.id] || null;
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.userId) {
            return Object.values(mockEmployees).find((e) => e.userId === where.userId) || null;
          }
          if (where.employeeCode) {
            const targetCode = typeof where.employeeCode === 'object' ? where.employeeCode.equals : where.employeeCode;
            return (
              Object.values(mockEmployees).find(
                (e) => e.employeeCode.toLowerCase() === String(targetCode).toLowerCase(),
              ) || null
            );
          }
          if (where.id) {
            return mockEmployees[where.id] || null;
          }
          return null;
        }),
        findMany: jest.fn().mockResolvedValue(Object.values(mockEmployees)),
      },
      customer: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          const w = mockWorks.find((work) => work.customer.id === where.id);
          return w ? w.customer : null;
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      team: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerSubscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      work: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return mockWorks.filter((w) => {
            if (where.status) {
              if (where.status.not && w.status === where.status.not) return false;
              if (where.status.in && !where.status.in.includes(w.status)) return false;
              if (typeof where.status === 'string' && w.status !== where.status) return false;
            }
            if (where.customerId && w.customerId !== where.customerId) return false;
            if (where.workType && w.workType !== where.workType) return false;

            if (where.OR) {
              const matchesOr = where.OR.some((cond: any) => {
                if (cond.assignedToId && w.assignedToId === cond.assignedToId) return true;
                if (cond.editorId && w.editorId === cond.editorId) return true;
                if (cond.tasks?.some?.assignedToId) {
                  return (w.tasks || []).some((t) => t.assignedToId === cond.tasks.some.assignedToId);
                }
                if (cond.customer?.assignedEmployeeId && w.customer.assignedEmployeeId === cond.customer.assignedEmployeeId) return true;
                return false;
              });
              if (!matchesOr) return false;
            }
            return true;
          });
        }),
        update: jest.fn(),
      },
      workTask: {
        updateMany: jest.fn(),
      },
    };

    workPermissionService = {
      getAllowedActivityTypesForEmployee: jest.fn().mockImplementation(async (empId: number) => {
        if (empId === 10) {
          return {
            role: 'Reel Shooter',
            allowedTypes: new Set(['REEL_SHOOT', 'SHOOT', 'REELS_SHOOT']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        if (empId === 20 || empId === 40) {
          return {
            role: 'Video Editor',
            allowedTypes: new Set(['REEL_EDIT', 'EDITING', 'VIDEO_EDITING', 'VIDEO']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        if (empId === 30) {
          return {
            role: 'Graphic Designer',
            allowedTypes: new Set(['POST_DESIGN', 'GRAPHIC_DESIGN', 'CREATIVE_POST']),
            isFullAccess: false,
            isProductionManager: false,
          };
        }
        return {
          role: 'Employee',
          allowedTypes: new Set(['TASK']),
          isFullAccess: true,
          isProductionManager: false,
        };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkPermissionService, useValue: workPermissionService },
      ],
    }).compile();

    service = module.get<WorkService>(WorkService);
  });

  describe('Acceptance Criteria Verification', () => {
    it('1 & 2: Task assigned to QB-EMP-019 appears in My Work and on its scheduled date', async () => {
      // Identity resolution test
      const resolvedId = await service.resolveEmployeeIdForUser({ employeeCode: 'QB-EMP-019' });
      expect(resolvedId).toBe(19);

      const canonicalId = await service.resolveCanonicalEmployeeId('QB-EMP-019');
      expect(canonicalId).toBe(19);

      // Calendar query for employee 19
      const calendar = await service.getEmployeeCalendar(19, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(calendar).toHaveLength(1);
      expect(calendar[0].id).toBe('1');
      expect(calendar[0].title).toBe('Review Weekly Operational Plan');
      expect(calendar[0].scheduledDate).toBe('2026-10-15');
      expect(calendar[0].assignedEmployees).toContain('Vikram Rathore');

      // Exact date query returns the task
      const dateCalendar = await service.getEmployeeCalendar(19, { date: '2026-10-15' }, { allTenantCustomers: true });
      expect(dateCalendar).toHaveLength(1);
      expect(dateCalendar[0].id).toBe('1');
    });

    it('3: Video Editor (Employee 20) sees their assigned customer video-editing tasks as REEL_EDIT', async () => {
      const calendar = await service.getEmployeeCalendar(20, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(calendar).toHaveLength(1);
      expect(calendar[0].id).toBe('2');
      expect(calendar[0].customerName).toBe('Care Fitness Gym');
      expect(calendar[0].activityType).toBe('REEL_EDIT');
      expect(calendar[0].editorName).toBe('Alice Editor');
      expect(calendar[0].assignedEmployees).toContain('Alice Editor');
    });

    it('4: Reel Shooter (Employee 10) sees their assigned shooting tasks', async () => {
      const calendar = await service.getEmployeeCalendar(10, { month: 10, year: 2026 }, { allTenantCustomers: true });
      const ids = calendar.map((i) => i.id);
      expect(ids).toContain('2'); // Shared reel shoot
      expect(ids).toContain('4'); // Restaurant shoot
      expect(calendar).toHaveLength(2);

      const shootTask = calendar.find((i) => i.id === '4');
      expect(shootTask?.activityType).toBe('REEL_SHOOT');
      expect(shootTask?.status).toBe(WorkStatus.COMPLETED);
    });

    it('5: Post Designer (Employee 30) sees their assigned design tasks', async () => {
      const calendar = await service.getEmployeeCalendar(30, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(calendar).toHaveLength(1);
      expect(calendar[0].id).toBe('3');
      expect(calendar[0].activityType).toBe('POST_DESIGN');
      expect(calendar[0].title).toBe('Festival Offer Creative Post');
      expect(calendar[0].assignedEmployees).toContain('Maya Designer');
    });

    it('6: An employee does not see another employee restricted personal tasks', async () => {
      // Employee 40 is a Video Editor with NO assignments
      const calendar = await service.getEmployeeCalendar(40, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(calendar).toHaveLength(0);
    });

    it('8 & 9: Selecting a date returns tasks for that date only (in IST)', async () => {
      // On 2026-10-14, only Reel Shooter 10 has a task (Work #4)
      const day14 = await service.getEmployeeCalendar(10, { date: '2026-10-14' }, { allTenantCustomers: true });
      expect(day14).toHaveLength(1);
      expect(day14[0].id).toBe('4');

      // On 2026-10-15, Shooter 10 has Work #2
      const day15 = await service.getEmployeeCalendar(10, { date: '2026-10-15' }, { allTenantCustomers: true });
      expect(day15).toHaveLength(1);
      expect(day15[0].id).toBe('2');

      // On 2026-10-16, Shooter 10 has no tasks
      const day16 = await service.getEmployeeCalendar(10, { date: '2026-10-16' }, { allTenantCustomers: true });
      expect(day16).toHaveLength(0);
    });

    it('10: Reassignment removes the task from the previous employee and makes it visible to the new assignee', async () => {
      // Initially, Editor 20 sees Work #2, Editor 40 sees nothing
      const before20 = await service.getEmployeeCalendar(20, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(before20.map((i) => i.id)).toContain('2');

      const before40 = await service.getEmployeeCalendar(40, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(before40).toHaveLength(0);

      // Simulate reassigning Work #2 editorId from 20 to 40
      mockWorks[1].editorId = 40;
      mockWorks[1].editor = mockEmployees[40];
      mockWorks[1].tasks[1].assignedToId = 40;

      // After reassignment: Editor 20 no longer sees it, Editor 40 now sees it
      const after20 = await service.getEmployeeCalendar(20, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(after20).toHaveLength(0);

      const after40 = await service.getEmployeeCalendar(40, { month: 10, year: 2026 }, { allTenantCustomers: true });
      expect(after40).toHaveLength(1);
      expect(after40[0].id).toBe('2');
      expect(after40[0].editorName).toBe('Rohan Unassigned');

      // Restore
      mockWorks[1].editorId = 20;
      mockWorks[1].editor = mockEmployees[20];
      mockWorks[1].tasks[1].assignedToId = 20;
    });

    it('11: Completed, pending, and in-progress statuses display correctly', async () => {
      const completedTask = await service.getEmployeeCalendar(10, { status: 'COMPLETED' }, { allTenantCustomers: true });
      expect(completedTask.map((i) => i.id)).toEqual(['4']);

      const inProgressTask = await service.getEmployeeCalendar(19, { status: 'IN_PROGRESS' }, { allTenantCustomers: true });
      expect(inProgressTask.map((i) => i.id)).toEqual(['1']);

      const pendingTask = await service.getEmployeeCalendar(30, { status: 'PENDING' }, { allTenantCustomers: true });
      expect(pendingTask.map((i) => i.id)).toEqual(['3']);
    });
  });
});
