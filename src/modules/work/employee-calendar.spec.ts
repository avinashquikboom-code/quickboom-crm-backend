import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkStatus, WorkType } from '@prisma/client';

describe('Employee Calendar Isolation & Mapping Tests', () => {
  let workService: WorkService;
  let prisma: any;

  const mockWorkItems = [
    {
      id: 101,
      customerId: 10,
      subscriptionId: 50,
      assignedToId: 1, // Employee A
      editorId: 2,     // Employee B
      workType: WorkType.REELS_SHOOT,
      title: 'Reels Video Shoot',
      scheduledDate: new Date('2026-09-10T10:00:00.000Z'),
      scheduledTime: '10:00 AM',
      status: WorkStatus.ASSIGNED,
      notes: 'Shoot location at studio',
      customer: {
        id: 10,
        name: 'Acme Corp',
        address: '123 Market St',
        city: 'Mumbai',
        state: 'Maharashtra',
      },
      team: { name: 'Production Crew' },
      assignedTo: { id: 1, firstName: 'John', lastName: 'Photographer' },
      editor: { id: 2, firstName: 'Alice', lastName: 'Editor' },
      entitlement: { serviceName: 'Reels Shoot' },
      subscription: { id: 50, plan: { name: 'Premium Growth Plan' } },
      tasks: [
        { id: 1, title: 'Setup Camera', status: 'PENDING', assignedToId: 1 },
      ],
    },
    {
      id: 102,
      customerId: 20,
      subscriptionId: 60,
      assignedToId: 3, // Employee C
      editorId: 3,     // Employee C
      workType: WorkType.POST_DESIGN,
      title: 'Creative Post Design',
      scheduledDate: new Date('2026-09-10T14:00:00.000Z'),
      scheduledTime: '02:00 PM',
      status: WorkStatus.SCHEDULED,
      notes: 'Social media post design',
      customer: {
        id: 20,
        name: 'Beta LLC',
        address: '456 Tech Park',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
      team: { name: 'Design Team' },
      assignedTo: { id: 3, firstName: 'Bob', lastName: 'Designer' },
      editor: null,
      entitlement: { serviceName: 'Post Design' },
      subscription: { id: 60, plan: { name: 'Basic Plan' } },
      tasks: [],
    },
  ];

  beforeEach(async () => {
    prisma = {
      work: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return mockWorkItems.filter((w) => {
            if (where.OR) {
              const matchesOr = where.OR.some((condition: any) => {
                if (condition.assignedToId !== undefined && w.assignedToId === condition.assignedToId) return true;
                if (condition.editorId !== undefined && w.editorId === condition.editorId) return true;
                if (condition.tasks?.some?.assignedToId !== undefined) {
                  return w.tasks?.some((t: any) => t.assignedToId === condition.tasks.some.assignedToId);
                }
                return false;
              });
              if (!matchesOr) return false;
            }
            if (where.status && where.status.not && w.status === where.status.not) {
              return false;
            }
            return true;
          });
        }),
      },
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.OR?.some((cond: any) => cond.userId === 1 || cond.email === 'emp1@crm.com')) {
            return { id: 1, firstName: 'John', lastName: 'Photographer', designation: { name: 'Photographer' } };
          }
          if (where.OR?.some((cond: any) => cond.userId === 2 || cond.email === 'emp2@crm.com')) {
            return { id: 2, firstName: 'Alice', lastName: 'Editor', designation: { name: 'Video Editor' } };
          }
          return null;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    workService = module.get<WorkService>(WorkService);
  });

  it('Employee 1 sees work assigned to them (as photographer)', async () => {
    const calendar = await workService.getEmployeeCalendar(1);
    expect(calendar).toHaveLength(1);
    expect(calendar[0].id).toBe('101');
    expect(calendar[0].customerName).toBe('Acme Corp');
    expect(calendar[0].title).toBe('Reels Video Shoot');
    expect(calendar[0].time).toBe('10:00 AM');
    expect(calendar[0].location).toBe('123 Market St, Mumbai, Maharashtra');
    expect(calendar[0].status).toBe(WorkStatus.ASSIGNED);
  });

  it('Employee 2 sees work assigned to them (as video editor)', async () => {
    const calendar = await workService.getEmployeeCalendar(2);
    expect(calendar).toHaveLength(1);
    expect(calendar[0].id).toBe('101');
    expect(calendar[0].customerName).toBe('Acme Corp');
    expect(calendar[0].assignedEmployee).toBe('John Photographer');
    expect(calendar[0].editorName).toBe('Alice Editor');
  });

  it('Employee 4 (unassigned) does NOT see Employee 1 or Employee 2 assigned work', async () => {
    const calendar = await workService.getEmployeeCalendar(4);
    expect(calendar).toHaveLength(0);
  });

  it('Employee 3 sees only their own work (Creative Post Design for Beta LLC)', async () => {
    const calendar = await workService.getEmployeeCalendar(3);
    expect(calendar).toHaveLength(1);
    expect(calendar[0].id).toBe('102');
    expect(calendar[0].customerName).toBe('Beta LLC');
    expect(calendar[0].location).toBe('456 Tech Park, Bengaluru, Karnataka');
  });

  it('Correctly filters by exact date without timezone drift', async () => {
    const calendarMatch = await workService.getEmployeeCalendar(1, { date: '2026-09-10' });
    expect(calendarMatch).toHaveLength(1);

    const calendarNoMatch = await workService.getEmployeeCalendar(1, { date: '2026-09-11' });
    expect(calendarNoMatch).toHaveLength(0);
  });
});
