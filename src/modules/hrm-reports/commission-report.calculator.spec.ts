import { commissionInPeriod, presentCommission, summarizeCommissions } from './commission-report.calculator';

describe('commission monthly period', () => {
  const start = new Date('2026-11-01T00:00:00.000+05:30');
  const end = new Date('2026-11-30T23:59:59.999+05:30');

  it('keeps last month earnings out of this month and counts a reversal made this month', () => {
    const earlier = { createdAt: new Date('2026-10-20T10:00:00.000+05:30'), updatedAt: new Date('2026-11-03T10:00:00.000+05:30'), status: 'CANCELLED' };
    const current = { createdAt: new Date('2026-11-04T10:00:00.000+05:30'), updatedAt: new Date('2026-11-04T10:00:00.000+05:30'), status: 'APPROVED' };
    expect(commissionInPeriod(earlier, start, end)).toBe(true);
    expect(commissionInPeriod(current, start, end)).toBe(true);
    expect(commissionInPeriod({ createdAt: new Date('2026-10-02T00:00:00.000+05:30'), updatedAt: new Date('2026-10-02T00:00:00.000+05:30'), status: 'PAID' }, start, end)).toBe(false);
  });

  it('separates pending, approved, paid and reversed amounts without inventing a leader split', () => {
    const lines = [
      presentCommission({ id: 1, employeeId: 4, employee: { firstName: 'Asha', lastName: 'Patil', employeeCode: 'EMP001' }, lead: { id: 9, companyName: 'Northwind' }, plan: { name: 'Growth' }, purchase: { paymentId: 'INV-1', orderNumber: 'ORD-1' }, purchaseAmount: 20000, commissionType: 'PERCENTAGE', commissionRate: 5, commissionAmount: 1000, status: 'APPROVED', createdAt: new Date() }),
      presentCommission({ id: 2, employeeId: 4, employee: { firstName: 'Asha', lastName: 'Patil', employeeCode: 'EMP001' }, lead: { id: 10, companyName: 'Fabrikam' }, plan: { name: 'Care' }, purchase: { orderNumber: 'ORD-2' }, purchaseAmount: 10000, commissionType: 'FIXED', commissionRate: 500, commissionAmount: 500, status: 'PAID', createdAt: new Date() }),
      presentCommission({ id: 3, employeeId: 4, employee: { firstName: 'Asha', lastName: 'Patil', employeeCode: 'EMP001' }, lead: { id: 11, companyName: 'Contoso' }, plan: { name: 'Care' }, purchaseAmount: 8000, commissionType: 'PERCENTAGE', commissionRate: 5, commissionAmount: 400, status: 'PENDING', createdAt: new Date() }),
      presentCommission({ id: 4, employeeId: 4, employee: { firstName: 'Asha', lastName: 'Patil', employeeCode: 'EMP001' }, lead: { id: 12, companyName: 'Adventure' }, plan: { name: 'Care' }, purchaseAmount: 6000, commissionType: 'PERCENTAGE', commissionRate: 5, commissionAmount: 300, status: 'CANCELLED', createdAt: new Date() }),
    ];
    const summary = summarizeCommissions(lines);
    expect(summary.generated).toBe(1900);
    expect(summary.employeeShare).toBe(1900);
    expect(summary.leaderShare).toBe(0);
    expect(summary.pending).toBe(400);
    expect(summary.paid).toBe(500);
    expect(summary.outstanding).toBe(1000);
    expect(summary.approved).toBe(1500);
    expect(summary.reversed).toBe(300);
    expect(summary.netEarned).toBe(1500);
    expect(summary.customers).toBe(3);
  });
});
