import { Test, TestingModule } from '@nestjs/testing';
import { ContactService } from './contact.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ContactService', () => {
  let service: ContactService;

  const mockPrisma = {
    contact: {
      count: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'Default Enterprise' }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
  });

  describe('findAll', () => {
    it('omits customerId from where clause when customerId is undefined (Super Admin global view)', async () => {
      mockPrisma.contact.count.mockResolvedValue(2);
      mockPrisma.contact.findMany.mockResolvedValue([
        { id: 1, firstName: 'John', lastName: 'Doe', customerId: 101 },
        { id: 2, firstName: 'Jane', lastName: 'Smith', customerId: 102 },
      ]);

      // SUPER_ADMIN with no explicit customerId: decorator returns undefined
      const result = await service.findAll(undefined, { page: 1, limit: 50 }, { role: 'SUPER_ADMIN' });

      expect(mockPrisma.contact.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          skip: 0,
          take: 50,
        }),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it('scopes SUPER_ADMIN to explicit customerId when one is provided', async () => {
      mockPrisma.contact.count.mockResolvedValue(1);
      mockPrisma.contact.findMany.mockResolvedValue([
        { id: 1, firstName: 'Admin', lastName: 'User', customerId: 3 },
      ]);

      // SUPER_ADMIN with explicit target customer
      const result = await service.findAll('3', { page: 1, limit: 20 }, { role: 'SUPER_ADMIN' });

      expect(mockPrisma.contact.count).toHaveBeenCalledWith({
        where: { customerId: 3, deletedAt: null },
      });

      expect(result.data).toHaveLength(1);
    });

    it('scopes query strictly to customerId when customerId is provided (Tenant context)', async () => {
      mockPrisma.contact.count.mockResolvedValue(1);
      mockPrisma.contact.findMany.mockResolvedValue([
        { id: 1, firstName: 'John', lastName: 'Doe', customerId: 5 },
      ]);

      const result = await service.findAll('5', { page: 1, limit: 20 }, { role: 'CUSTOMER', customerId: 5 });

      expect(mockPrisma.contact.count).toHaveBeenCalledWith({
        where: { customerId: 5, deletedAt: null },
      });

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 5, deletedAt: null },
        }),
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('searches linked company names together with contact fields and applies type/status filters', async () => {
      mockPrisma.contact.count.mockResolvedValue(0);
      mockPrisma.contact.findMany.mockResolvedValue([]);

      await service.findAll('7', { page: 2, limit: 20, search: 'Northwind', type: 'PARTNER', status: 'ACTIVE' }, { role: 'CUSTOMER', customerId: 7 });

      const expectedWhere = expect.objectContaining({
        customerId: 7,
        deletedAt: null,
        type: 'PARTNER',
        status: 'ACTIVE',
        OR: expect.arrayContaining([
          { company: { is: { name: { contains: 'Northwind', mode: 'insensitive' } } } },
        ]),
      });
      expect(mockPrisma.contact.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere, skip: 20, take: 20 }));
    });
  });

  describe('getMetrics', () => {
    it('allows Super Admin to view platform wide metrics without customerId filter', async () => {
      mockPrisma.contact.count.mockResolvedValue(10);

      // SUPER_ADMIN with no explicit customer → global platform view
      const metrics = await service.getMetrics(undefined, { role: 'SUPER_ADMIN' });

      expect(metrics.total).toBe(10);
      expect(metrics.active).toBe(10);

      // Verify no customerId was set in the where clause
      expect(mockPrisma.contact.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });

    it('returns tenant scoped company, phone, and email counts from contact records', async () => {
      mockPrisma.contact.count
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(6);
      mockPrisma.contact.groupBy.mockResolvedValue([{ companyId: 3 }, { companyId: 9 }]);

      const metrics = await service.getMetrics('12', { role: 'CUSTOMER', customerId: 12 });

      expect(metrics).toMatchObject({ total: 8, active: 5, companies: 2, phoneContacts: 7, emailContacts: 6 });
      expect(mockPrisma.contact.groupBy).toHaveBeenCalledWith({
        by: ['companyId'],
        where: { customerId: 12, deletedAt: null, companyId: { not: null } },
      });
    });
  });
});
