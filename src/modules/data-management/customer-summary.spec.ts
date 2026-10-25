import { DataManagementService } from './data-management.service';

describe('DataManagementService customer summary', () => {
  it('returns aggregate counts for active customers and directly linked records only', async () => {
    const prisma: any = {
      customer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 12, crmCompanyId: 42, userId: 72 },
          { id: 13, crmCompanyId: null, userId: null },
        ]),
      },
      contact: { findMany: jest.fn().mockResolvedValue([{ id: 101 }, { id: 102 }]) },
      deal: { findMany: jest.fn().mockResolvedValue([{ id: 201 }]) },
      work: { count: jest.fn().mockResolvedValue(3) },
      task: { count: jest.fn().mockResolvedValue(4) },
      visit: { count: jest.fn().mockResolvedValue(5) },
      invoice: { count: jest.fn().mockResolvedValue(6) },
      customerSubscription: { count: jest.fn().mockResolvedValue(7) },
      quotation: { count: jest.fn().mockResolvedValue(8) },
      supportTicket: { count: jest.fn().mockResolvedValue(9) },
    };
    const service = new DataManagementService(prisma);

    await expect(service.getCustomersSummaryAll()).resolves.toEqual({
      totalCustomers: 2,
      totalRelatedRecords: 45,
      breakdown: {
        works: 3,
        tasks: 4,
        monthlySchedules: null,
        visits: 5,
        invoices: 6,
        subscriptions: 7,
        contacts: 2,
        deals: 1,
        quotations: 8,
        tickets: 9,
      },
    });

    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { id: true, crmCompanyId: true, userId: true },
    });
    expect(prisma.work.count).toHaveBeenCalledWith({
      where: { companyId: { in: [42] } },
    });
    expect(prisma.task.count).toHaveBeenCalledWith({
      where: { OR: [{ createdById: { in: [72] } }, { assignedToId: { in: [72] } }] },
    });
  });
});
