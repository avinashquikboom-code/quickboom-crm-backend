import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealService } from './deal.service';

describe('DealService deal deletion', () => {
  const prisma = {
    deal: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (work) => work(prisma)),
  };
  const service = new DealService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes one deal in the current tenant and keeps linked records', async () => {
    prisma.deal.findFirst.mockResolvedValue({ id: 8, title: 'Northwind' });
    prisma.deal.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.delete(4, 8, { id: 2, firstName: 'Ada' })).resolves.toEqual({ deleted: true, id: 8, title: 'Northwind' });

    expect(prisma.deal.updateMany).toHaveBeenCalledWith({
      where: { id: 8, customerId: 4, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'DELETE', entityType: 'Deal', entityId: '8' }),
    }));
  });

  it('rejects an invalid deal id', async () => {
    await expect(service.delete(4, 'deal-8')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.deal.updateMany).not.toHaveBeenCalled();
  });

  it('does not delete a deal from another tenant', async () => {
    prisma.deal.findFirst.mockResolvedValue(null);
    await expect(service.delete(4, 8)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.deal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, customerId: 4, deletedAt: null },
    }));
  });

  it('soft-deletes the valid selected deals and reports the rejected ones', async () => {
    prisma.deal.findMany
      .mockResolvedValueOnce([
        { id: 1, title: 'Kept', deletedAt: null },
        { id: 2, title: 'Gone', deletedAt: new Date() },
      ])
      .mockResolvedValueOnce([]);
    prisma.deal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.bulkDelete(4, [1, 1, 2, 'nope', 99], { id: 3 });

    expect(prisma.deal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [1] }, customerId: 4, deletedAt: null },
    }));
    expect(result.deletedIds).toEqual([1]);
    expect(result.success).toBe(1);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'nope' }),
      expect.objectContaining({ id: 2, message: '"Gone" is already deleted.' }),
      expect.objectContaining({ id: 99 }),
    ]));
  });

  it('rejects an empty selection', async () => {
    await expect(service.bulkDelete(4, [])).rejects.toBeInstanceOf(BadRequestException);
  });
});
