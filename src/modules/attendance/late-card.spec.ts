import { AttendanceService } from './attendance.service';

describe('employee late card', () => {
  it('uses the shift effective at punch-in, including later assignment changes', async () => {
    const historical = { startTime: '09:00 AM' };
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ previousShift: historical });
    const service = new AttendanceService({ shiftAssignmentHistory: { findFirst } } as any);
    const shift = await (service as any).resolveShiftAtPunch({ id: 1, customerId: 2, shift: { startTime: '10:00 AM' } }, new Date('2026-11-23T03:30:00Z'));
    expect(shift).toBe(historical);
  });

  it('does not substitute a current shift after an explicit unassignment', async () => {
    const service = new AttendanceService({ shiftAssignmentHistory: { findFirst: jest.fn().mockResolvedValue({ newShift: null }) } } as any);
    const shift = await (service as any).resolveShiftAtPunch({ id: 1, customerId: 2, shift: { startTime: '10:00 AM' } }, new Date());
    expect(shift).toBeNull();
    const result = await (service as any).resolveTodayLateMark({ id: 1, customerId: 2, shift: { startTime: '10:00 AM' } }, { punchIn: new Date() }, {}, shift);
    expect(result.lateMarkStatus).toBe('no_shift');
  });
  it('shows late minutes with zero deduction when policy is disabled', async () => {
    const service = new AttendanceService({} as any);
    jest.spyOn(service as any, 'evaluatePunchLateness').mockResolvedValue({ applicable: false, isLate: true, lateMinutes: 3, deduction: 0, ratePerMinute: 1, gracePeriodMinutes: 0, reason: 'policy_disabled' });
    const result = await (service as any).resolveTodayLateMark({ id: 1, customerId: 1 }, { punchIn: new Date() }, {}, { startTime: '10:00 AM' });
    expect(result).toMatchObject({ isLate: true, lateMinutes: 3, lateDeduction: 0, isEligibleLateMark: false, lateMarkStatus: 'policy_disabled' });
  });
  it('does not fabricate monthly deductions when recorded deduction is zero', async () => {
    const prisma: any = { attendance: { findMany: jest.fn().mockResolvedValue([{ id: 1, date: new Date(), punchIn: new Date(), isLate: true, lateMinutes: 3, lateDeduction: 0, lateRatePerMinute: 1 }]) }, lateMarkPolicy: { findUnique: jest.fn().mockResolvedValue({ deductionRatePerMin: 1 }) } };
    const result = await (new AttendanceService(prisma) as any).summarizeEmployeeStoredLateMarks(1, 1);
    expect(result).toMatchObject({ lateDays: 1, totalLateMinutes: 3, totalDeduction: 0 });
  });
});
