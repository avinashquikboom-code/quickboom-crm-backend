import { CommissionService } from './commission.service';
import { commissionForPayroll, settleCommissionShares } from './commission-payroll.util';

// Synthetic transaction fixtures; no real payments, payroll or customers are written.
describe('BPO commission split, attribution, access and settlement', () => {
  let db: any; let service: CommissionService; let event: any;
  let employee: any; let leader: any; let payment: any; let team: any;
  beforeEach(() => {
    event = null;
    employee = { id: 10, userId: 100, customerId: 1, status: 'ACTIVE', firstName: 'Seller', lastName: '', employeeCode: 'E10', designation: { name: 'Telecaller', commissionEnabled: true, commissionType: 'PERCENTAGE', commissionRate: 3 }, department: { name: 'BPO' }, commissionConfig: null };
    leader = { ...employee, id: 20, userId: 200, firstName: 'Leader', designation: { name: 'BPO Team Leader' } };
    payment = { id: 30, customerId: 50, amount: 10000, status: 'SUCCESS', planId: 2, createdAt: new Date('2026-10-11T12:00:00Z'), deletedAt: null, paymentId: 'pay-fixture', paymentMethod: 'RAZORPAY' };
    team = { id: 4, customerId: 1, name: 'BPO Alpha', description: '', updatedAt: new Date('2026-10-01'), leader };
    db = {
      $transaction: jest.fn(async fn => fn(db)),
      paymentHistory: { findUnique: jest.fn(async () => payment) },
      customer: { findUnique: jest.fn(async () => ({ id: 50, leadId: 60, originLead: { id: 60, customerId: 1, convertedByEmployeeId: 10 }, assignedEmployeeId: 99, createdByEmployeeId: 99 })) },
      employee: { findUnique: jest.fn(async ({ where }) => where.id === 10 ? employee : leader), findFirst: jest.fn(async ({ where }) => [employee, leader].find(e => e.userId === where.userId && e.customerId === where.customerId)) },
      teamMember: { findMany: jest.fn(async () => [{ team }]) },
      commission: {
        findUnique: jest.fn(async ({ where }) => event && (where.id ? event.id === where.id : event.purchaseId === where.purchaseId) ? event : null),
        findFirst: jest.fn(async () => event),
        create: jest.fn(async ({ data }) => {
          event = { ...data, id: 1, createdAt: payment.createdAt, shares: (data.shares?.create || []).map((s, i) => ({ ...s, id: i + 1, commissionId: 1, status: 'APPROVED', payrollItemId: null })), customer: { id: 50, name: 'Customer' }, lead: { id: 60 }, employee: { id: 10, firstName: 'Seller', lastName: '' } };
          return event;
        }),
        findMany: jest.fn(async ({ where }) => !event ? [] : where.OR.some(c => (c.tenantId === event.tenantId && (c.shares?.some ? event.shares.some(s => s.employeeId === c.shares.some.employeeId && (!c.shares.some.recipientRole || s.recipientRole === c.shares.some.recipientRole)) : c.employeeId === event.employeeId)) || (c.tenantId === null && event.tenantId == null && c.employeeId === event.employeeId)) ? [event] : []),
        update: jest.fn(async ({ data }) => { Object.assign(event, data); return event; }),
      },
      commissionShare: {
        findMany: jest.fn(async ({ where }) => (event?.shares || []).filter(s => (!where.employeeId || s.employeeId === where.employeeId) && (!where.payrollItemId || s.payrollItemId === where.payrollItemId) && (!where.status || s.status === where.status)).map(s => ({ ...s, commission: event }))),
        updateMany: jest.fn(async ({ where, data }) => { let count = 0; for (const s of event.shares) { if ((where.payrollItemId == null || s.payrollItemId === where.payrollItemId) && (typeof where.status === 'string' ? s.status === where.status : s.status !== where.status?.not)) { Object.assign(s, data); count++; } } return { count }; }),
        count: jest.fn(async ({ where }) => event.shares.filter(s => s.status !== where.status.not).length),
      },
    };
    service = new CommissionService(db);
  });
  const params = { customerId: 50, purchaseId: 30, purchaseAmount: 999999, planId: 2 };
  const award = () => service.calculateAndAwardCommission(params);

  it('uses successful stored payment base; splits total 3% into 1.5% / ₹150 each', async () => {
    const result = await award();
    expect(result.purchaseAmount).toBe(10000);
    expect(result.commissionAmount).toBe(300);
    expect(result.shares.map(s => [s.employeeId, s.effectiveRate, s.amount])).toEqual([[10, 1.5, 150], [20, 1.5, 150]]);
    expect(result.leadId).toBe(60); expect(result.employeeId).toBe(10); expect(result.teamId).toBe(4); expect(result.leaderId).toBe(20); expect(result.tenantId).toBe(1);
  });
  it('splits fixed amounts and allocates the odd paisa without exceeding the original total', async () => {
    employee.commissionConfig = { status: 'ACTIVE', commissionType: 'FIXED', commissionValue: 300.01 };
    const result = await award();
    expect(result.shares.map(s => s.amount)).toEqual([150.01, 150]);
    expect(Math.round(result.shares.reduce((sum, s) => sum + s.amount, 0) * 100)).toBe(30001);
  });
  it('holds missing leader for review, with no payable shares', async () => {
    team.leader = null;
    const result = await award();
    expect(result.status).toBe('PENDING'); expect(result.reviewReason).toBe('BPO_LEADER_UNRESOLVED'); expect(result.shares).toEqual([]);
  });
  it('holds missing sale employee without awarding to the customer creator', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 50, leadId: 60, originLead: { customerId: 1 }, createdByEmployeeId: 99 });
    const result = await award();
    expect(result.employeeId).toBeNull(); expect(result.reviewReason).toBe('SALE_EMPLOYEE_UNRESOLVED'); expect(result.shares).toEqual([]);
  });
  it('does not award BPO commission to a non-BPO designer even with a rate', async () => {
    employee.designation.name = 'Graphic Designer'; employee.department.name = 'Production';
    expect(await award()).toBeNull(); expect(db.commission.create).not.toHaveBeenCalled();
  });
  it('does not earn commission for failed payments or disabled configuration', async () => {
    payment.status = 'FAILED'; expect(await award()).toBeNull();
    payment.status = 'SUCCESS'; employee.commissionConfig = { status: 'INACTIVE' }; expect(await award()).toBeNull();
  });
  it('webhook/job retries and later team changes reuse the original immutable event', async () => {
    const original = await award(); team.leader = { ...leader, id: 77 };
    expect(await award()).toBe(original); expect(db.commission.create).toHaveBeenCalledTimes(1); expect(original.leaderId).toBe(20);
  });
  it('does not infer historical leader after a team change', async () => {
    team.updatedAt = new Date('2026-10-12');
    expect((await award()).reviewReason).toBe('HISTORICAL_TEAM_REVIEW_REQUIRED');
  });
  it('preserves previously paid historical unsplit commissions', async () => {
    event = { id: 99, purchaseId: 30, customerId: 50, status: 'PAID', commissionAmount: 300, shares: [] };
    expect(await award()).toBe(event); expect(db.paymentHistory.findUnique).not.toHaveBeenCalled(); expect(db.commission.create).not.toHaveBeenCalled();
  });
  it('cancels unpaid shares on refunds without deleting history', async () => {
    await award(); await service.handleRefundOrCancellation(30, 50);
    expect(event.status).toBe('CANCELLED'); expect(event.shares.every(s => s.status === 'CANCELLED')).toBe(true); expect(event.history.at(-1).action).toBe('REFUND_REQUESTED');
  });
  it('preserves paid share and flags authorized adjustment on later refund', async () => {
    await award(); event.shares[0].status = 'PAID';
    await service.handleRefundOrCancellation(30, 50);
    expect(event.shares[0].status).toBe('PAID'); expect(event.reviewReason).toBe('PAID_REVERSAL_REQUIRES_AUTHORIZED_ADJUSTMENT');
  });
  it('authenticated employee sees only own share; client employee filter cannot widen access', async () => {
    await award(); const own = await service.getEmployeeCommissions(1, 100, { employeeId: 20 });
    expect(own.data[0].commissionAmount).toBe(150); expect(own.data[0].commissionRate).toBe(1.5); expect(own.data[0].originalCommissionRate).toBe(3); expect(own.summary.approvedCommission).toBe(150);
    await expect(service.getEmployeeCommissions(2, 100, {})).rejects.toThrow('Employee profile');
  });
  it('leader gets only snapshotted own team shares and employee attribution', async () => {
    await award(); const own = await service.getLeaderCommissions(1, 200, {});
    expect(own.data[0].recipientRole).toBe('LEADER'); expect(own.data[0].employee.id).toBe(10); expect(own.data[0].employeeShareAmount).toBe(150); expect(own.data[0].leaderShareAmount).toBe(150);
    leader.id = 77; expect((await service.getLeaderCommissions(1, 200, {})).data).toEqual([]);
  });
  it('settles each recipient once, leaves the other approved, then finalizes the event', async () => {
    await award(); event.shares[0].payrollItemId = 1000; event.shares[1].payrollItemId = 2000;
    await settleCommissionShares(db, 1000); await settleCommissionShares(db, 1000);
    expect(event.shares.map(s => s.status)).toEqual(['PAID', 'APPROVED']); expect(event.status).toBe('APPROVED');
    await settleCommissionShares(db, 2000); expect(event.status).toBe('PAID');
  });
  it('payroll uses exact employee, tenant and earned period; blocks overlapping salary commission', async () => {
    await award(); const start = new Date('2026-10-01'); const end = new Date('2026-10-31');
    const split = await commissionForPayroll(db, 1, 10, start, end, 5, 0); expect(split.amount).toBe(150);
    expect(db.commissionShare.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ employeeId: 10, status: 'APPROVED', commission: { tenantId: 1, reviewReason: null, qualifyingAt: { gte: start, lte: end } } }) }));
    await expect(commissionForPayroll(db, 1, 10, start, end, 5, 100)).rejects.toThrow('overlap');
  });
  it('blocks manual payment of split commissions and paid history changes', async () => {
    await award(); db.commissionShare.count.mockResolvedValue(2);
    await expect(service.updateCommissionStatus(1, 1, { status: 'PAID' as any }, { id: 1 })).rejects.toThrow('payroll');
    event.status = 'PAID'; await expect(service.updateCommissionStatus(1, 1, { status: 'CANCELLED' as any }, { id: 1 })).rejects.toThrow('adjustment');
  });
  it('duplicate gateway transaction on another PaymentHistory row reuses the same event', async () => {
    const original = await award(); payment.id = 31;
    expect(await service.calculateAndAwardCommission({ ...params, purchaseId: 31 })).toBe(original);
    expect(db.commission.create).toHaveBeenCalledTimes(1);
  });
  it('retries serializable contention without issuing another event', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect((await award()).shares).toHaveLength(2);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
  it('partial refunds hold shares and repeated refund events do not duplicate history', async () => {
    await award(); await service.handleRefundOrCancellation(30, 50, 'refund-fixture', true);
    const count = event.history.length;
    await service.handleRefundOrCancellation(30, 50, 'refund-fixture', true);
    expect(event.reviewReason).toBe('PARTIAL_REFUND_REQUIRES_REVIEW');
    expect(event.shares.every(s => s.status === 'PENDING')).toBe(true);
    expect(event.history).toHaveLength(count);
  });
  it('end-to-end fixture: award, ledger, correct recipient settlement, paid mobile ledger', async () => {
    await award();
    const own = await service.getEmployeeCommissions(1, 100, {});
    expect(own.data[0].customerId).toBe(50); expect(own.data[0].customerCommissionTotal).toBe(150);
    const split = await commissionForPayroll(db, 1, 10, new Date('2026-10-01'), new Date('2026-10-31'), 7, 0);
    expect(split.amount).toBe(150);
    event.shares[0].payrollItemId = 700;
    await settleCommissionShares(db, 700);
    const paid = await service.getEmployeeCommissions(1, 100, {});
    expect(paid.summary.paidCommission).toBe(150);
    expect((await service.getLeaderCommissions(1, 200, {})).summary.approvedCommission).toBe(150);
  });
  it('admin totals aggregate share states without counting the full event twice', async () => {
    await award();
    db.commission.count = jest.fn().mockResolvedValue(1);
    db.commission.groupBy = jest.fn().mockResolvedValue([]);
    db.commissionShare.groupBy = jest.fn().mockResolvedValue([
      { status: 'PAID', _sum: { amount: 150 }, _count: { id: 1 } },
      { status: 'APPROVED', _sum: { amount: 150 }, _count: { id: 1 } },
    ]);
    const ledger = await service.getAdminCommissions(1, { employeeId: 20, search: 'Customer' });
    expect(ledger.summary.totalCommission).toBe(300); expect(ledger.summary.paidCommission).toBe(150); expect(ledger.summary.approvedCommission).toBe(150);
    const where = db.commission.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ tenantId: 1 }); expect(where.AND).toHaveLength(2);
  });
});
