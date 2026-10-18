import { TaskService } from './task.service';

it('maps mobile My Work from the employee calendar while preserving schedule and purchase metadata', async () => {
  const scheduledAt = new Date('2026-10-17T04:30:00Z');
  const item = { id: '42', activityId: '42', customerId: '8', customerName: 'Home Consultancy',
    purchaseId: 'PUR-114', productName: 'Stories', serviceName: 'Stories', planName: 'Standard Package',
    title: 'Story #1: Design', scheduledAt, scheduledDate: '2026-10-17', scheduledTime: '10:00 AM',
    status: 'SCHEDULED', workType: 'STORY_DESIGN', team: 'Production' };
  const getEmployeeCalendar = jest.fn().mockResolvedValue([item]);
  const service = new TaskService({} as any, { getEmployeeCalendar } as any);
  const rows = await (service as any).findEmployeeCalendarWorks(13, 1, [], {});
  expect(getEmployeeCalendar).toHaveBeenCalledWith(13, {}, { assignedOnly: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ activityId: '42', purchaseId: 'PUR-114', customerName: 'Home Consultancy',
    scheduledAt, scheduledDate: '2026-10-17', scheduledTime: '10:00 AM', productName: 'Stories',
    serviceName: 'Stories', planName: 'Standard Package', source: 'WORK' });
});

describe('mobile task/calendar consistency', () => {
  const row = {
    id: '42', workType: 'EDITING', activityType: 'REEL_EDIT', status: 'ASSIGNED',
    priority: 'HIGH', assignedToId: 13, assignedEmployee: 'Assigned Person',
    customerId: '8', title: 'Edit deliverable', scheduledDate: '2026-10-17',
  };

  it('keeps matching priority and actual assignment metadata', async () => {
    const getEmployeeCalendar = jest.fn().mockResolvedValue([row]);
    const service = new TaskService({} as any, { getEmployeeCalendar } as any);
    const rows = await (service as any).findEmployeeCalendarWorks(13, undefined, [], { priority: 'HIGH', status: 'PENDING' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 42, customerId: 8, assignedToId: 13, priority: 'HIGH', status: 'ASSIGNED' });
    expect(getEmployeeCalendar).toHaveBeenCalledWith(13, {}, { assignedOnly: true });
    expect(await (service as any).findEmployeeCalendarWorks(13, undefined, [], { priority: 'LOW' })).toEqual([]);
  });

  it('preserves completed records in their status filter', async () => {
    const service = new TaskService({} as any, {
      getEmployeeCalendar: jest.fn().mockResolvedValue([{ ...row, status: 'APPROVED' }]),
    } as any);
    expect(await (service as any).findEmployeeCalendarWorks(13, undefined, [], { status: 'COMPLETED' })).toHaveLength(1);
    expect(await (service as any).findEmployeeCalendarWorks(13, undefined, [], { status: 'PENDING' })).toEqual([]);
  });

  it('does not convert a calendar failure into an empty success', async () => {
    const service = new TaskService({} as any, {
      getEmployeeCalendar: jest.fn().mockRejectedValue(new Error('Database unavailable')),
    } as any);
    await expect((service as any).findEmployeeCalendarWorks(13, undefined, [], {})).rejects.toThrow('Database unavailable');
  });

  it('does not grant personal Task ownership through a coworker or department', async () => {
    const prisma = {
      teamMember: { findMany: jest.fn().mockResolvedValue([{ teamId: 7 }]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new TaskService(prisma as any, {} as any);
    const scope = await (service as any).buildMyTaskOwnership({ id: 13, userId: 91, departmentId: 4 });
    expect(scope.orOwnership).toEqual([{ employeeId: 13 }, { assignedToId: 91 }]);
    expect(scope.teamIds).toEqual([7]);
  });
});
