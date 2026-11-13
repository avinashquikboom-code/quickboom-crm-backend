import { BadRequestException, ConflictException } from '@nestjs/common';
import { CommissionWalletService } from './commission-wallet.service';

describe('Commission wallet', () => {
  let db: any;
  let service: CommissionWalletService;
  beforeEach(() => {
    db = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 7, customerId: 2, bankDetails: { upiId: 'test@bank' }, designation: { commissionEnabled: true, commissionType: 'PERCENTAGE', commissionRate: 5 } }) },
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { commissionAmount: 1000, purchaseAmount: 20000 } }),
        groupBy: jest.fn().mockResolvedValue([{ leadId: 10 }]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      commissionWithdrawal: {
        aggregate: jest.fn().mockImplementation(({ where }) => Promise.resolve({ _sum: { amount: where.status === 'PAID' ? 200 : 100 } })),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 11, ...data })),
        findFirst: jest.fn().mockResolvedValue({ id: 11, status: 'APPROVED', paymentReference: null }),
        update: jest.fn(),
      },
      commissionSlab: { findMany: jest.fn().mockResolvedValue([]) },
      commissionConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    db.$transaction = jest.fn((fn) => fn(db));
    service = new CommissionWalletService(db, {} as any);
  });
  const request = { amount: 300, paymentAccountId: 'upi', paymentMethod: 'UPI', idempotencyKey: 'request-test-1' };

  it('reserves a pending request using transaction-scoped balance after locking the employee', async () => {
    const result = await service.requestWithdrawal(2, 5, request);
    expect('availableBalance' in result && result.availableBalance).toBe(400);
    expect(result.status).toBe('PENDING');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.commission.aggregate.mock.invocationCallOrder[0]);
    expect(db.commissionWithdrawal.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: 2, employeeId: 7, amount: 300, status: 'PENDING' }) });
  });
  it('replays an identical request without a second reservation', async () => {
    db.commissionWithdrawal.findUnique.mockResolvedValue({ id: 11, customerId: 2, employeeId: 7, amount: 300, accountRef: 'upi' });
    expect((await service.requestWithdrawal(2, 5, request)).id).toBe(11);
    expect(db.commissionWithdrawal.create).not.toHaveBeenCalled();
  });
  it('rejects a key owned by another tenant/employee or another payload', async () => {
    for (const row of [
      { customerId: 3, employeeId: 7, amount: 300, accountRef: 'upi' },
      { customerId: 2, employeeId: 8, amount: 300, accountRef: 'upi' },
      { customerId: 2, employeeId: 7, amount: 400, accountRef: 'upi' },
    ]) {
      db.commissionWithdrawal.findUnique.mockResolvedValue(row);
      await expect(service.requestWithdrawal(2, 5, request)).rejects.toBeInstanceOf(ConflictException);
    }
    expect(db.commissionWithdrawal.create).not.toHaveBeenCalled();
  });
  it('rejects invalid, fractional-paise and over-balance requests', async () => {
    for (const amount of [0, -1, Infinity, NaN, 1.001, 701]) {
      await expect(service.requestWithdrawal(2, 5, { ...request, amount })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(db.commissionWithdrawal.create).not.toHaveBeenCalled();
  });
  it('returns current availability and distinct lead counts with filtered earnings', async () => {
    const data = await service.earnings(2, 5, { period: 'last_month' });
    expect(data.availableBalance).toBe(700);
    expect(data.leadsClosed).toBe(1);
    expect(data.averageCommissionRate).toBe(5);
    await expect(service.earnings(2, 5, { startDate: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('exposes designation fallback and inactive override eligibility', async () => {
    expect((await service.rules(2, 5)).eligible).toBe(true);
    db.commissionConfig.findUnique.mockResolvedValue({ commissionType: 'PERCENTAGE', commissionValue: 5, status: 'INACTIVE' });
    expect((await service.rules(2, 5)).eligible).toBe(false);
  });
  it('paginates the combined ledger without the former 200-row cap', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'earn-260' }]).mockResolvedValueOnce([{ total: BigInt(501) }]);
    const result = await service.transactions(2, 5, { page: '13', limit: '20' });
    expect(result.meta).toEqual({ page: 13, limit: 20, total: 501 });
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining([2, 7, 20, 240]));
  });
  it('does not mark paid without processing evidence', async () => {
    await expect(service.setWithdrawalStatus(2, 11, 'paid', 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.commissionWithdrawal.update).not.toHaveBeenCalled();
  });
});
