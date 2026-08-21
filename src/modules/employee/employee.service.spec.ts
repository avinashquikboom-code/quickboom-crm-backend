import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('EmployeeService — Customer Data Isolation', () => {
  let service: EmployeeService;
  let prisma: {
    employee: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    department: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    designation: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      department: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      designation: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EmployeeService>(EmployeeService);
  });

  describe('findAll (Customer Isolation)', () => {
    it('Customer A: queries only customerId = 1 employees and counts with customerId = 1', async () => {
      const mockCustomerAEmployees = [
        {
          id: 101,
          customerId: 1,
          employeeCode: 'EMP-001',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@custA.com',
          phone: '+91 99999 11111',
          status: 'ACTIVE',
          joiningDate: new Date(),
          department: { name: 'Media' },
          designation: { name: 'Lead' },
        },
      ];

      prisma.employee.findMany.mockResolvedValue(mockCustomerAEmployees);
      prisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll({ customerId: 1, isSuperAdmin: false });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 1 }),
        }),
      );
      expect(prisma.employee.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ customerId: 1 }),
      });
      expect(result.items.length).toBe(1);
      expect(result.items[0].customerId).toBe(1);
    });

    it('Customer B: queries only customerId = 2 employees', async () => {
      const mockCustomerBEmployees = [
        {
          id: 201,
          customerId: 2,
          employeeCode: 'EMP-002',
          firstName: 'Bob',
          lastName: 'Jones',
          email: 'bob@custB.com',
          phone: '+91 99999 22222',
          status: 'ACTIVE',
          joiningDate: new Date(),
          department: { name: 'Sales' },
          designation: { name: 'Manager' },
        },
      ];

      prisma.employee.findMany.mockResolvedValue(mockCustomerBEmployees);
      prisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll({ customerId: 2, isSuperAdmin: false });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 2 }),
        }),
      );
      expect(prisma.employee.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ customerId: 2 }),
      });
      expect(result.items[0].customerId).toBe(2);
    });

    it('Missing customerId for non-SuperAdmin throws ForbiddenException and does NOT query all employees', async () => {
      await expect(service.findAll({ customerId: undefined, isSuperAdmin: false })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });

    it('SuperAdmin without customerId: can query across all customers', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(0);

      await service.findAll({ customerId: undefined, isSuperAdmin: true });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('SuperAdmin with customerId filter: scopes to specific customer', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.count.mockResolvedValue(0);

      await service.findAll({ customerId: 3, isSuperAdmin: true });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 3 }),
        }),
      );
    });
  });

  describe('findOne (Detail Isolation)', () => {
    it('Customer A fetching own employee succeeds', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        employeeCode: 'EMP-001',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@custA.com',
        attendances: [],
        works: [],
      });

      const result = await service.findOne({ id: 101, customerId: 1, isSuperAdmin: false });
      expect(result.id).toBe(101);
      expect(result.customerId).toBe(1);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 101, customerId: 1 },
        include: expect.any(Object),
      });
    });

    it('Customer B attempting to fetch Customer A employee throws NotFoundException', async () => {
      // findFirst returns null because customerId 2 does not match employee 101 belonging to customerId 1
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne({ id: 101, customerId: 2, isSuperAdmin: false }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 101, customerId: 2 },
        include: expect.any(Object),
      });
    });
  });

  describe('create (Ownership Enforcement)', () => {
    it('Customer A creating employee sets customerId: 1', async () => {
      prisma.department.findFirst.mockResolvedValue({ id: 10, customerId: 1, name: 'Media' });
      prisma.designation.findFirst.mockResolvedValue({ id: 20, customerId: 1, name: 'Lead' });
      prisma.employee.create.mockResolvedValue({
        id: 105,
        customerId: 1,
        employeeCode: 'EMP-105',
        firstName: 'New',
        lastName: 'Emp',
        email: 'new@custA.com',
      });

      const result = await service.create({
        customerId: 1,
        dto: {
          employeeCode: 'EMP-105',
          firstName: 'New',
          lastName: 'Emp',
          email: 'new@custA.com',
        },
      });

      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            employeeCode: 'EMP-105',
          }),
        }),
      );
      expect(result.customerId).toBe(1);
    });
  });

  describe('update & delete (Ownership Boundary)', () => {
    it('Customer B attempting to update Customer A employee is blocked', async () => {
      // findOne fails with NotFoundException because customerId mismatch
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.update({
          id: 101,
          customerId: 2,
          isSuperAdmin: false,
          dto: { firstName: 'Hacked' },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('Customer B attempting to delete Customer A employee is blocked', async () => {
      // findOne fails with NotFoundException
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.remove({
          id: 101,
          customerId: 2,
          isSuperAdmin: false,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.employee.update).not.toHaveBeenCalled();
    });
  });
});
