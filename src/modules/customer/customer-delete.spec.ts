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
  it('allows administrators to set an explicit one-to-one CRM company mapping', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ id: 2, crmCompanyId: 55 }),
      },
      company: { findFirst: jest.fn().mockResolvedValue({ id: 55 }) },
    };
    const service = new CustomerService(prisma);
    await expect(service.linkCrmCompany(2, 55, admin)).resolves.toEqual({
      id: 2,
      crmCompanyId: 55,
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { crmCompanyId: 55 },
      select: { id: true, crmCompanyId: true },
    });
    await expect(service.linkCrmCompany(2, 55, { id: 4, role: 'EMPLOYEE' })).rejects.toBeInstanceOf(ForbiddenException);
  });
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
    await expect(service.bulkRemove([2, 3], admin, false)).rejects.toThrow(
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
  it('requires a super administrator and exact confirmation for delete-all', async () => {
    const prisma: any = { customer: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() } };
    const service = new CustomerService(prisma);
    await expect(service.deleteAllForSuperAdmin(admin, 'DELETE ALL CUSTOMERS')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    await expect(service.deleteAllForSuperAdmin({ id: 1, role: 'SUPER_ADMIN' }, 'no')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });
  it('counts only active customer accounts for super administrators', async () => {
    const prisma: any = { customer: { count: jest.fn().mockResolvedValue(7) } };
    const service = new CustomerService(prisma);
    await expect(service.countActiveCustomersForSuperAdmin({ id: 1, role: 'SUPER_ADMIN' })).resolves.toEqual({ totalCustomers: 7 });
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });
  it('deletes only the active customer IDs returned in bounded batches', async () => {
    const customerIds = Array.from({ length: 205 }, (_, index) => index + 2);
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 206 }),
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          customerIds.filter((id) => id > where.id.gt && id <= where.id.lte).slice(0, 100).map((id) => ({ id })),
        )),
      },
    };
    const service = new CustomerService(prisma);
    const bulkRemove = jest.spyOn(service, 'bulkRemove').mockImplementation(async (ids) => ({ deletedCount: ids.length, ids }));

    await expect(service.deleteAllForSuperAdmin({ id: 1, role: 'SUPER_ADMIN' }, 'DELETE ALL CUSTOMERS')).resolves.toMatchObject({
      success: true,
      deletedCount: 205,
    });
    expect(bulkRemove.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5]);
    expect(bulkRemove.mock.calls.flatMap(([ids]) => ids)).toEqual(customerIds);
    expect(bulkRemove).toHaveBeenCalledWith(expect.any(Array), { id: 1, role: 'SUPER_ADMIN' }, true);
  });
  it('deletes only CRM records explicitly linked through selected customer mappings', async () => {
    const { service, tx } = setup([
      { id: 2, userId: null, deletedAt: null, crmCompanyId: 55 } as any,
      { id: 3, userId: null, deletedAt: null, crmCompanyId: null } as any,
    ]);
    tx.contact = { findMany: jest.fn().mockResolvedValue([{ id: 701 }, { id: 702 }]) };
    tx.invoice = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
    tx.contact.updateMany = jest.fn().mockResolvedValue({ count: 2 });
    tx.visit = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    tx.work = {
      findMany: jest.fn().mockResolvedValue([
        { entitlementId: 88, status: 'SCHEDULED' },
        { entitlementId: 88, status: 'ASSIGNED' },
        { entitlementId: 89, status: 'COMPLETED' },
      ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    tx.planEntitlement = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    tx.company = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };

    await expect(service.bulkRemove([2, 3], admin, true)).resolves.toEqual({
      deletedCount: 2,
      ids: [2, 3],
    });
    expect(tx.contact.findMany).toHaveBeenCalledWith({
      where: { companyId: { in: [55] } },
      select: { id: true },
    });
    expect(tx.invoice.deleteMany).toHaveBeenCalledWith({
      where: { contactId: { in: [701, 702] } },
    });
    expect(tx.contact.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [701, 702] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.visit.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { contactId: { in: [701, 702] } },
    });
    expect(tx.visit.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { companyId: { in: [55] } },
    });
    expect(tx.work.deleteMany).toHaveBeenCalledWith({
      where: { companyId: { in: [55] } },
    });
    expect(tx.planEntitlement.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.planEntitlement.updateMany).toHaveBeenCalledWith({
      where: { id: 88, scheduledQty: { gte: 2 } },
      data: { scheduledQty: { decrement: 2 } },
    });
    expect(tx.company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [55] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
  it('blocks unresolved checkouts and does not partially delete the batch', async () => {
    const { service, tx } = setup();
    tx.customerCheckout.findFirst.mockResolvedValue({ customerId: 2 });
    await expect(service.bulkRemove([2, 3], admin, false)).rejects.toThrow(
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
