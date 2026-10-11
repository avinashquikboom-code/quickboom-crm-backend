import { Logger } from '@nestjs/common';
import { CommissionService, commissionBaseOf } from './commission.service';
import { awardCommissionForPayment } from './commission-trigger.util';

// Synthetic fixtures only; nothing is written to a real database.
describe('Commission qualifying events, base and admin metrics', () => {
  let db: any;
  let service: CommissionService;
  let event: any;
  let payment: any;
  let customer: any;
  let employee: any;
  let leader: any;

  beforeEach(() => {
    event = null;
    employee = { id: 10, userId: 100, customerId: 1, status: 'ACTIVE', firstName: 'Seller', lastName: '', designation: { name: 'Telecaller', commissionEnabled: true, commissionType: 'PERCENTAGE', commissionRate: 3 }, department: { name: 'BPO' }, commissionConfig: null };
    leader = { ...employee, id: 20, userId: 200, firstName: 'Leader', designation: { name: 'BPO Team Leader' } };
    customer = { id: 50, leadId: 60, originLead: { id: 60, customerId: 1, convertedByEmployeeId: 10 }, assignedEmployeeId: null };
    payment = { id: 30, customerId: 50, amount: 10000, taxAmount: 1800, totalAmount: 11800, status: 'SUCCESS', planId: 2, orderId: 'ORD-1', createdAt: new Date('2026-10-11T12:00:00Z'), updatedAt: new Date('2026-10-11T12:00:00Z'), deletedAt: null, paymentId: null, paymentMethod: 'RAZORPAY' };
    const team = { id: 4, customerId: 1, name: 'BPO Alpha', description: '', updatedAt: new Date('2026-10-01'), leader };
    db = {
      $transaction: jest.fn(async (fn) => fn(db)),
      paymentHistory: { findUnique: jest.fn(async () => payment) },
      customer: { findUnique: jest.fn(async () => customer) },
      employee: {
        findUnique: jest.fn(async ({ where }) => (where.id === 10 ? employee : where.id === 20 ? leader : null)),
        findFirst: jest.fn(async () => null),
      },
      teamMember: { findMany: jest.fn(async () => [{ team }]) },
      commission: {
        findUnique: jest.fn(async ({ where }) => (event && event.purchaseId === where.purchaseId ? event : null)),
        findFirst: jest.fn(async () => event),
        create: jest.fn(async ({ data }) => {
          event = { ...data, id: 1, shares: (data.shares?.create || []).map((s: any, i: number) => ({ ...s, id: i + 1, status: 'APPROVED' })) };
          return event;
        }),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        groupBy: jest.fn(async () => []),
      },
      commissionShare: { groupBy: jest.fn(async () => []) },
    };
    service = new CommissionService(db);
  });

  const award = () => service.calculateAndAwardCommission({ customerId: 50, purchaseId: 30, purchaseAmount: 0 });

  describe('commissionBaseOf', () => {
    it('uses the stored tax-exclusive amount for gateway, installment and custom-plan payments', () => {
      expect(commissionBaseOf({ amount: 10000, taxAmount: 1800, totalAmount: 11800 })).toBe(10000);
      expect(commissionBaseOf({ amount: 5000, taxAmount: 0, totalAmount: 5000 })).toBe(5000);
      expect(commissionBaseOf({ amount: 5000 })).toBe(5000);
    });

    it('removes GST when amount stores the tax-inclusive total (admin activation, plan change, renewal)', () => {
      expect(commissionBaseOf({ amount: 11800, taxAmount: 1800, totalAmount: 11800 })).toBe(10000);
    });
  });

  it('1/5. admin-recorded purchase by a BPO-converted customer: 3% of the tax-exclusive base, split 1.5% + 1.5%', async () => {
    payment = { ...payment, amount: 11800, paymentMethod: 'BANK_TRANSFER' };
    const result = await award();

    expect(result.purchaseAmount).toBe(10000);
    expect(result.commissionAmount).toBe(300);
    expect(result.status).toBe('APPROVED');
    expect(result.tenantId).toBe(1);
    expect(result.customerId).toBe(50);
    expect(result.leadId).toBe(60);
    expect(result.shares.map((s: any) => [s.recipientRole, s.employeeId, s.effectiveRate, s.amount])).toEqual([
      ['EMPLOYEE', 10, 1.5, 150],
      ['LEADER', 20, 1.5, 150],
    ]);
  });

  it('2. self-serve purchase with no source lead and no assigned seller creates no commission record', async () => {
    customer = { id: 50, leadId: null, originLead: null, assignedEmployeeId: null };
    expect(await award()).toBeNull();
    expect(db.commission.create).not.toHaveBeenCalled();
  });

  it('2b. failed or pending payment for a WON lead does not earn commission', async () => {
    payment.status = 'PENDING';
    expect(await award()).toBeNull();
    expect(db.commission.create).not.toHaveBeenCalled();
  });

  it('3. non-BPO seller is never awarded', async () => {
    employee.designation = { ...employee.designation, name: 'Video Editor' };
    employee.department = { name: 'Production' };
    expect(await award()).toBeNull();
    expect(db.commission.create).not.toHaveBeenCalled();
  });

  it('4. source lead without a resolvable seller is held for review in the lead tenant, without shares', async () => {
    customer = { ...customer, originLead: { id: 60, customerId: 1 } };
    const result = await award();
    expect(result.status).toBe('PENDING');
    expect(result.reviewReason).toBe('SALE_EMPLOYEE_UNRESOLVED');
    expect(result.tenantId).toBe(1);
    expect(result.shares).toEqual([]);
  });

  it('zero-value purchase (full discount) creates no commission record', async () => {
    payment = { ...payment, amount: 0, taxAmount: 0, totalAmount: 0 };
    expect(await award()).toBeNull();
    expect(db.commission.create).not.toHaveBeenCalled();
  });

  it('6. retried trigger for the same payment reuses the existing event', async () => {
    const logger = new Logger('test');
    const qualifying = { id: 30, customerId: 50, amount: 10000, planId: 2, orderId: 'ORD-1' };
    await awardCommissionForPayment(service, logger, qualifying, 'installment');
    await awardCommissionForPayment(service, logger, qualifying, 'installment');
    expect(db.commission.create).toHaveBeenCalledTimes(1);
  });

  it('trigger never fails the purchase when commission generation throws', async () => {
    const logger = { error: jest.fn() } as unknown as Logger;
    const failing = { calculateAndAwardCommission: jest.fn().mockRejectedValue(new Error('db down')) } as unknown as CommissionService;
    await expect(
      awardCommissionForPayment(failing, logger, { id: 30, customerId: 50, amount: 1 }, 'admin-renewal'),
    ).resolves.toBeUndefined();
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining('admin-renewal'), expect.anything());
  });

  it('trigger is a no-op without a commission service or a committed payment', async () => {
    const spy = jest.spyOn(service, 'calculateAndAwardCommission');
    await awardCommissionForPayment(undefined, new Logger('test'), { id: 30, customerId: 50, amount: 1 }, 'x');
    await awardCommissionForPayment(service, new Logger('test'), null, 'x');
    expect(spy).not.toHaveBeenCalled();
  });

  it('7. admin metrics: review-required events count as Pending Verification; split shares count by share status', async () => {
    db.commission.groupBy.mockResolvedValue([
      { status: 'PENDING', _sum: { commissionAmount: 300 }, _count: { id: 1 } },
      { status: 'PAID', _sum: { commissionAmount: 120 }, _count: { id: 1 } },
      { status: 'CANCELLED', _sum: { commissionAmount: 999 }, _count: { id: 1 } },
    ]);
    db.commissionShare.groupBy.mockResolvedValue([
      { status: 'APPROVED', _sum: { amount: 150 }, _count: { id: 1 } },
      { status: 'PAID', _sum: { amount: 150 }, _count: { id: 1 } },
    ]);

    const { summary } = await service.getAdminCommissions(1, {} as any);

    const legacyWhere = db.commission.groupBy.mock.calls[0][0].where;
    expect(legacyWhere.reviewReason).toBeUndefined();
    expect(legacyWhere.shares).toEqual({ none: {} });
    expect(summary.pendingCommission).toBe(300);
    expect(summary.approvedCommission).toBe(150);
    expect(summary.paidCommission).toBe(270);
    expect(summary.totalCommission).toBe(720);
    expect(summary.totalCount).toBe(4);
  });

  it('9. admin list is scoped to the caller tenant (and legacy rows of that tenant only)', async () => {
    await service.getAdminCommissions(1, {} as any);
    const where = db.commission.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ tenantId: 1 });
    expect(JSON.stringify(where)).not.toContain('"tenantId":2');
  });
});
