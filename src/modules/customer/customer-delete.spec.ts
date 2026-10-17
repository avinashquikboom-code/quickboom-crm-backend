import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { CustomerService } from './customer.service';
import { BulkDeleteCustomersDto } from './customer.controller';
const admin = { id: 1, accountType: 'ADMIN' };
function setup(
  records: Array<{ id: number; userId?: number | null; deletedAt: any }> = [
    { id: 2, userId: null, deletedAt: null },
    { id: 3, userId: null, deletedAt: null },
  ],
) {
  const tx: any = {
    $queryRaw: jest.fn(),
    customer: {
      findMany: jest.fn().mockResolvedValue(records),
      updateMany: jest.fn().mockResolvedValue({ count: records.length }),
    },
    customerSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerCheckout: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma: any = { $transaction: jest.fn((fn) => fn(tx)) };
  return { service: new CustomerService(prisma), prisma, tx };
}
describe('single and bulk customer soft deletion', () => {
  it('deletes one customer using the same transaction and preserves all billing and lead records', async () => {
    const { service, prisma, tx } = setup([{ id: 2, deletedAt: null }]);
    await expect(service.remove(2, admin)).resolves.toEqual({
      deletedCount: 1,
      ids: [2],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [2] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.customerSubscription).not.toHaveProperty('deleteMany');
    expect(tx.customerCheckout).not.toHaveProperty('deleteMany');
  });
  it('deduplicates bulk IDs and marks them deleted in one write', async () => {
    const { service, tx } = setup();
    await expect(service.bulkRemove([3, 2, 3], admin)).resolves.toEqual({
      deletedCount: 2,
      ids: [2, 3],
    });
    expect(tx.customer.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 5, accountType: 'CUSTOMER' },
    { id: 5, accountType: 'EMPLOYEE' },
    {},
  ])('rejects non-administrators before accessing records', async (actor) => {
    const { service, prisma } = setup();
    await expect(service.bulkRemove([2], actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [0],
      [-1],
      [1.5],
      ['2'],
      Array.from({ length: 101 }, (_, i) => i + 1),
    ].map((ids) => ({ ids })),
  )('rejects invalid or oversized ID lists', async ({ ids }) => {
    const { service, prisma } = setup();
    await expect(
      service.bulkRemove(ids as number[], admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects an entire batch if an ID is missing', async () => {
    const { service, tx } = setup([{ id: 2, deletedAt: null }]);
    await expect(service.bulkRemove([2, 3], admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });
  it('blocks deletion when one customer has an active or pending subscription', async () => {
    const { service, tx } = setup();
    tx.customerSubscription.findFirst.mockResolvedValue({ customerId: 3 });
    await expect(service.bulkRemove([2, 3], admin)).rejects.toThrow(
      'Cancel it before deleting',
    );
    expect(tx.customerSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
        }),
      }),
    );
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });
  it('cascades subscription and checkout cancellation when cancelSubscriptions is true', async () => {
    const { service, tx } = setup([{ id: 2, userId: 10, deletedAt: null }]);
    tx.customerSubscription.findFirst.mockResolvedValue({ customerId: 2 });
    await expect(service.bulkRemove([2], admin, true)).resolves.toEqual({
      deletedCount: 1,
      ids: [2],
    });
    expect(tx.customerSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: { in: [2] },
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
      },
      data: { status: 'CANCELLED' },
    });
    expect(tx.customerCheckout.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: { in: [2] },
        status: { notIn: ['PAID', 'CANCELLED'] },
      },
      data: { status: 'CANCELLED' },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10] } },
      data: { isActive: false },
    });
    expect(tx.customer.updateMany).toHaveBeenCalledTimes(1);
  });
  it('blocks unresolved checkouts and does not partially delete the batch', async () => {
    const { service, tx } = setup();
    tx.customerCheckout.findFirst.mockResolvedValue({ customerId: 2 });
    await expect(service.bulkRemove([2, 3], admin)).rejects.toThrow(
      'unresolved checkout',
    );
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });
  it('treats retries on previously deleted customers as a no-op', async () => {
    const { service, tx } = setup([{ id: 2, deletedAt: new Date() }]);
    await expect(service.remove(2, admin)).resolves.toEqual({
      deletedCount: 0,
      ids: [],
    });
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });
  it('excludes deleted customers from authorization and checkout preparation', async () => {
    const prisma: any = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const service = new CustomerService(prisma);
    await expect(
      service.prepare(admin, {
        customerId: 2,
        planId: 1,
        idempotencyKey: 'request-123',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 2, deletedAt: null },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks deletion under the shared customer lock before creating a checkout', async () => {
    const tx: any = {
      $queryRaw: jest.fn(),
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      customerCheckout: { upsert: jest.fn() },
    };
    const prisma: any = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    await expect(
      new CustomerService(prisma).prepare(admin, {
        customerId: 2,
        planId: 1,
        idempotencyKey: 'request-123',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.customerCheckout.upsert).not.toHaveBeenCalled();
  });
  it('validates the bulk API payload', async () => {
    for (const ids of [[], [0], ['2'], Array(101).fill(2)]) {
      const dto = Object.assign(new BulkDeleteCustomersDto(), { ids });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
    expect(
      await validate(
        Object.assign(new BulkDeleteCustomersDto(), { ids: [2, 3] }),
      ),
    ).toHaveLength(0);
  });
});
