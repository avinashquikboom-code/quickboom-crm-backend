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
  expect(getEmployeeCalendar).toHaveBeenCalledWith(13, {}, { allTenantCustomers: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ activityId: '42', purchaseId: 'PUR-114', customerName: 'Home Consultancy',
    scheduledAt, scheduledDate: '2026-10-17', scheduledTime: '10:00 AM', productName: 'Stories',
    serviceName: 'Stories', planName: 'Standard Package', source: 'WORK' });
});
