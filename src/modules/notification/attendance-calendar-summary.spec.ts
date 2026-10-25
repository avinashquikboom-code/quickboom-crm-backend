import { EmployeeCommunicationService } from './employee-communication.service';

describe('Calendar-based monthly attendance summary', () => {
  it('counts scheduled dates, approved leave and office holidays without inflating duplicate attendance', async () => {
    const row = { id: 1, date: new Date('2026-09-30T18:30:00Z'), punchIn: new Date('2026-10-01T04:00:00Z'), status: 'PRESENT', workingHours: 8 };
    const prisma: any = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 3, officeId: 4, joiningDate: new Date('2026-01-01'), shift: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] } }) },
      attendance: { findMany: jest.fn().mockResolvedValue([row, { ...row, id: 2 }]) },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([{ fromDate: '2026-10-05', toDate: '2026-10-05', leaveType: { code: 'PL' } }]) },
      publicHoliday: { findMany: jest.fn().mockResolvedValue([{ date: new Date('2026-10-02') }]) },
      attendancePolicy: { findMany: jest.fn().mockResolvedValue([{ officeId: null, workingDaysPerWeek: 5 }]) },
    };
    const result = await (new EmployeeCommunicationService(prisma) as any).buildAttendanceSummary(3, 2, 2026, 10);
    expect(result).toMatchObject({ calendarDays: 31, workingDays: 21, present: 1, absent: 19, leave: 1, holidayDays: 1, weeklyOffDays: 9, hours: 8 });
    expect(result.days).toHaveLength(1);
    expect(prisma.leaveRequest.findMany.mock.calls[0][0].where.status).toBe('APPROVED');
    expect(prisma.attendance.findMany.mock.calls[0][0].where.date.gte.getTime()).toBeLessThan(row.date.getTime());
  });
});
