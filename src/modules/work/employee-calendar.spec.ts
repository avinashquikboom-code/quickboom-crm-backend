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
        assignedEmployeeId: null,
      },
      team: { name: 'Design Team' },
      assignedTo: { id: 3, firstName: 'Bob', lastName: 'Designer' },
      editor: null,
      entitlement: { serviceName: 'Post Design' },
      subscription: { id: 60, plan: { name: 'Basic Plan' } },
      tasks: [],
    },
    {
      id: 103,
      customerId: 30,
      subscriptionId: 66,
      assignedToId: null, // Assigned through Customer
      editorId: null,
      workType: WorkType.REELS_SHOOT,
      title: 'Reel Shoot',
      // Stored as 28 Aug 18:30 UTC -> which is 29 Aug 00:00:00 IST
      scheduledDate: new Date('2026-08-28T18:30:00.000Z'),
      scheduledTime: '10:00 AM',
      status: WorkStatus.SCHEDULED,
      notes: 'Gym reel shoot on location',
      customer: {
        id: 30,
        name: 'Care Fitness Gym',
        address: 'MG Road',
        city: 'Pune',
        state: 'Maharashtra',
        assignedEmployeeId: 1, // Employee A
      },
      team: null,
      assignedTo: null,
      editor: null,
      entitlement: { serviceName: 'Reel Shoot' },
      subscription: { id: 66, plan: { name: 'Growth Plan' } },
      tasks: [],
    },
    {
      id: 104,
      customerId: 40,
      subscriptionId: 77,
      assignedToId: null, // Assigned through Team
      editorId: null,
      workType: WorkType.STORY_DESIGN,
      title: 'Story Design',
      scheduledDate: new Date('2026-08-29T10:30:00.000Z'),
      scheduledTime: '04:00 PM',
      status: WorkStatus.SCHEDULED,
      notes: 'Weekend promo story',
      customer: {
        id: 40,
        name: 'Delta Mart',
        address: 'Ring Road',
        city: 'Surat',
        state: 'Gujarat',
        assignedEmployeeId: null,
      },
      team: {
        id: 5,
        name: 'SSM Team A',
        members: [{ employeeId: 1 }], // Employee A is member
      },
      assignedTo: null,
      editor: null,
      entitlement: { serviceName: 'Story Design' },
      subscription: { id: 77, plan: { name: 'Starter Plan' } },
      tasks: [],
    },
  ];

  beforeEach(async () => {
    prisma = {
      work: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return mockWorkItems.filter((item: any) => {
            if (where.OR) {
              const matchesOr = where.OR.some((condition: any) => {
                if (condition.customer !== undefined) {
                  if (condition.customer.assignedEmployeeId !== undefined) {
                    if (item.customer?.assignedEmployeeId !== condition.customer.assignedEmployeeId) return false;
                  }
                  if (condition.customer.assignedEmployee !== undefined) {
                    if (item.customer?.assignedEmployee !== condition.customer.assignedEmployee) return false;
                  }
                  if (condition.customer.assignedTeam !== undefined) {
                    const matchTeam = condition.customer.assignedTeam.OR?.some((tc: any) => {
                      if (tc.members?.some?.employeeId !== undefined) {
                        return item.customer?.assignedTeam?.members?.some((m: any) => m.employeeId === tc.members.some.employeeId);
                      }
                      if (tc.leaderId !== undefined) {
                        return item.customer?.assignedTeam?.leaderId === tc.leaderId;
                      }
                      return false;
                    });
                    if (!matchTeam) return false;
                  } else if (condition.customer.assignedEmployeeId === undefined && condition.customer.assignedEmployee === undefined) {
                    return false;
                  }
                  if (condition.assignedToId === null && item.assignedToId !== null) return false;
                  return true;
                }
                if (condition.team !== undefined) {
                  if (condition.team.members?.some?.employeeId !== undefined) {
                    return item.team?.members?.some((m: any) => m.employeeId === condition.team.members.some.employeeId);
                  }
                  if (condition.team.leaderId !== undefined) {
                    return item.team?.leaderId === condition.team.leaderId;
                  }
                  return false;
                }
                if (condition.assignedToId !== undefined && condition.assignedToId !== null && item.assignedToId === condition.assignedToId) return true;
                if (condition.editorId !== undefined && condition.editorId !== null && item.editorId === condition.editorId) return true;
                if (condition.tasks?.some?.assignedToId !== undefined) {
                  return item.tasks?.some((t: any) => t.assignedToId === condition.tasks.some.assignedToId);
                }
                return false;
              });
              if (!matchesOr) return false;
            }
            if (where.status && where.status.not && item.status === where.status.not) {
              return false;
            }
            return true;
          });
        }),
      },
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 1) return { id: 1, firstName: 'John', lastName: 'Photographer', userId: 1 };
          if (where.id === 2) return { id: 2, firstName: 'Alice', lastName: 'Editor', userId: 2 };
          if (where.id === 3) return { id: 3, firstName: 'Bob', lastName: 'Designer', userId: 3 };
          return null;
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 1 || where.OR?.some((cond: any) => cond.userId === 1 || cond.email === 'emp1@crm.com')) {
            return { id: 1, firstName: 'John', lastName: 'Photographer', userId: 1 };
          }
          if (where.id === 2 || where.OR?.some((cond: any) => cond.userId === 2 || cond.email === 'emp2@crm.com')) {
            return { id: 2, firstName: 'Alice', lastName: 'Editor', userId: 2 };
          }
          if (where.id === 3 || where.OR?.some((cond: any) => cond.userId === 3 || cond.email === 'emp3@crm.com')) {
            return { id: 3, firstName: 'Bob', lastName: 'Designer', userId: 3 };
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
    expect(calendar.length).toBeGreaterThanOrEqual(1);
    const item101 = calendar.find((c) => c.id === '101');
    expect(item101).toBeDefined();
    expect(item101?.customerName).toBe('Acme Corp');
    expect(item101?.title).toBe('Reels Video Shoot');
    expect(item101?.time).toBe('10:00 AM');
    expect(item101?.location).toBe('123 Market St, Mumbai, Maharashtra');
    expect(item101?.status).toBe(WorkStatus.ASSIGNED);
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

  it('Employee 1 sees activities of assigned Customer (Care Fitness Gym PUR-066)', async () => {
    const calendar = await workService.getEmployeeCalendar(1, { date: '2026-08-29' });
    const careGymItem = calendar.find((c) => c.id === '103');
    expect(careGymItem).toBeDefined();
    expect(careGymItem?.customerName).toBe('Care Fitness Gym');
    expect(careGymItem?.purchaseId).toBe('PUR-066');
    expect(careGymItem?.title).toBe('Reel Shoot');
    expect(careGymItem?.scheduledDate).toBe('2026-08-29');
    expect(careGymItem?.time).toBe('10:00 AM');
    expect(careGymItem?.status).toBe(WorkStatus.SCHEDULED);
  });

  it('Employee 2 (unassigned) does NOT see Customer 30 assigned work (PUR-066)', async () => {
    const calendar = await workService.getEmployeeCalendar(2, { date: '2026-08-29' });
    const careGymItem = calendar.find((c) => c.id === '103');
    expect(careGymItem).toBeUndefined();
  });

  it('Employee 1 sees work assigned to their team (SSM Team A)', async () => {
    const calendar = await workService.getEmployeeCalendar(1, { date: '2026-08-29' });
    const teamItem = calendar.find((c) => c.id === '104');
    expect(teamItem).toBeDefined();
    expect(teamItem?.team).toBe('SSM Team A');
    expect(teamItem?.customerName).toBe('Delta Mart');
    expect(teamItem?.title).toBe('Story Design');
  });

  it('Employee 2 (not in SSM Team A) does NOT see team assigned work', async () => {
    const calendar = await workService.getEmployeeCalendar(2, { date: '2026-08-29' });
    const teamItem = calendar.find((c) => c.id === '104');
    expect(teamItem).toBeUndefined();
  });

  it('Correctly returns month activities without boundary truncation', async () => {
    const augustCalendar = await workService.getEmployeeCalendar(1, { year: 2026, month: 8 });
    const ids = augustCalendar.map((a) => a.id);
    expect(ids).toContain('103');
    expect(ids).toContain('104');
    expect(ids).not.toContain('101'); // 101 is September
  });
});
