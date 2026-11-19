import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PlanScheduleGateway } from '../work/plan-schedule.gateway';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('EmployeeService — Customer Data Isolation', () => {
  let service: EmployeeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      department: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      office: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customer: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lead: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      deal: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employeeDocument: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employeeShiftAssignment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employeeSalaryComponent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      overtimeRecord: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      attendance: {
        count: jest.fn().mockResolvedValue(0),
      },
      salarySlip: {
        count: jest.fn().mockResolvedValue(0),
      },
      payrollItem: {
        count: jest.fn().mockResolvedValue(0),
      },
      salaryStructure: {
        count: jest.fn().mockResolvedValue(0),
      },
      employeeClaim: {
        count: jest.fn().mockResolvedValue(0),
      },
      employeeLoan: {
        count: jest.fn().mockResolvedValue(0),
      },
      commission: {
        count: jest.fn().mockResolvedValue(0),
      },
      commissionWithdrawal: {
        count: jest.fn().mockResolvedValue(0),
      },
      leaveRequest: {
        count: jest.fn().mockResolvedValue(0),
      },
      employeeDeduction: {
        count: jest.fn().mockResolvedValue(0),
      },
      userSession: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      designation: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10, email: 'test@example.com' }),
        update: jest.fn().mockResolvedValue({ id: 10 }),
        delete: jest.fn().mockResolvedValue({ id: 10 }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, type: 'CUSTOM' }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      userRole: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      branchGeofence: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1, name: 'Head Office' }),
      },
      $transaction: jest.fn((cb: any) => typeof cb === 'function' ? cb(prisma) : Promise.all(cb)),
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as any;

    for (const model of [
      'remoteRequest', 'overtimeRequest', 'visit', 'employeeLocation', 'employeeLeaveBalance',
      'leaveAdjustmentHistory', 'teamMember', 'employeeModuleOverride', 'employeeLeadLimit',
      'locationTrackingSetting', 'workAccessRequest', 'overtimeNotificationEvent', 'dataCaptureSearch',
      'commissionConfig', 'salaryTargetPolicy', 'salaryTargetReview', 'hrmEmployeeMonthlyReport',
      'hrmLeaveMonthlySnapshot', 'hrmNotificationDelivery', 'hrmCommissionMonthlySnapshot',
      'work', 'team', 'monthlySchedule', 'task', 'visitPhoto', 'workTask', 'taskProof',
    ]) {
      prisma[model] = { count: jest.fn().mockResolvedValue(0) };
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PlanAccessService,
          useValue: {
            checkUserLimit: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PlanScheduleGateway,
          useValue: {
            emitPlanUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmployeeService>(EmployeeService);
  });

  describe('employee creation duplicate validation', () => {
    it('returns the existing same-tenant employee ID for an active duplicate', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce({
        id: 41, customerId: 1, employeeCode: 'EMP-041', status: 'ACTIVE',
      });

      await expect((service as any).assertNoExistingEmployee(
        prisma, 1, { id: 9 }, 'person@example.com',
      )).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'EMPLOYEE_ALREADY_EXISTS', existingEmployeeId: 41,
        }),
      });
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ customerId: 1 }),
      }));
    });

    it('reports inactive or deleted employees without creating a second record', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce({
        id: 42, customerId: 1, employeeCode: 'EMP-042', status: 'DELETED',
      });

      await expect((service as any).assertNoExistingEmployee(
        prisma, 1, { id: 10 }, 'deleted@example.com',
      )).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'EMPLOYEE_ALREADY_EXISTS_INACTIVE', existingEmployeeId: 42,
          employeeStatus: 'DELETED',
        }),
      });
    });

    it('does not disclose or treat another tenant email as a same-tenant duplicate', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce(null);
      prisma.employee.findUnique.mockResolvedValueOnce({ id: 88, customerId: 2 });

      await expect((service as any).assertNoExistingEmployee(
        prisma, 1, { id: 12 }, 'person@example.com',
      )).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'EMPLOYEE_ACCOUNT_BELONGS_TO_ANOTHER_TENANT' }),
      });
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ customerId: 1 }),
      }));
    });

    it('allows an existing user without an employee profile to be reused', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce(null);
      prisma.employee.findUnique.mockResolvedValueOnce(null);

      await expect((service as any).assertNoExistingEmployee(
        prisma, 1, { id: 13 }, 'existing-user@example.com',
      )).resolves.toBeUndefined();
    });
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
          // SuperAdmin with no status filter — DELETED employees are excluded by default
          where: expect.objectContaining({ status: { not: 'DELETED' } }),
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
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 1 }),
          include: expect.any(Object),
        }),
      );
    });

    it('Customer B attempting to fetch Customer A employee throws NotFoundException', async () => {
      // findFirst returns null because customerId 2 does not match employee 101 belonging to customerId 1
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne({ id: 101, customerId: 2, isSuperAdmin: false }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 2 }),
          include: expect.any(Object),
        }),
      );
    });
  });

  describe('create (Ownership Enforcement)', () => {
    it('Customer A creating employee always receives a system-generated employeeCode', async () => {
      // Backend generates the code inside the transaction; mock the resolved value
      // findMany is called by getNextEmployeeCode to find existing EMP-prefixed codes
      prisma.employee.findMany.mockResolvedValue([]); // no existing codes → generates EMP-001
      // findUnique is called by the duplicate guard — null means no existing employee for this user
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.department.findFirst.mockResolvedValue({ id: 10, customerId: 1, name: 'Media' });
      prisma.designation.findFirst.mockResolvedValue({ id: 20, customerId: 1, name: 'Lead' });
      prisma.employee.create.mockResolvedValue({
        id: 105,
        customerId: 1,
        employeeCode: 'EMP-001',  // backend-generated code
        firstName: 'New',
        lastName: 'Emp',
        email: 'new@custA.com',
      });

      const result = await service.create({
        customerId: 1,
        dto: {
          // employeeCode intentionally NOT provided — backend always generates it
          firstName: 'New',
          lastName: 'Emp',
          email: 'new@custA.com',
        },
      });

      // Verify the employee was created with the correct tenant and an EMP-prefixed code
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            employeeCode: expect.stringMatching(/^EMP-\d{3,}$/),
          }),
        }),
      );
      expect(result.customerId).toBe(1);
    });

    it('Creating employee with email that already has an Employee record throws ConflictException (409)', async () => {
      // findMany for getNextEmployeeCode
      prisma.employee.findMany.mockResolvedValue([]);
      // Duplicate email matching is tenant-scoped and now uses findFirst.
      prisma.employee.findFirst.mockResolvedValueOnce({
        id: 99,
        employeeCode: 'EMP-001',
        customerId: 1,
        status: 'ACTIVE',
      });

      await expect(
        service.create({
          customerId: 1,
          dto: {
            firstName: 'Duplicate',
            lastName: 'User',
            email: 'existing@custA.com',
          },
        }),
      ).rejects.toThrow(ConflictException);

      // employee.create must NEVER be called when user already has an Employee record
      expect(prisma.employee.create).not.toHaveBeenCalled();
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

  describe('deactivate, activate & remove operations', () => {
    const mockEmployee = {
      id: 50,
      employeeCode: 'EMP-050',
      customerId: 1,
      userId: 10,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      status: 'ACTIVE',
      mobileLoginEnabled: true,
    };

    it('deactivate: sets status to INACTIVE, disables mobileLogin, invalidates sessions, returns DEACTIVATED', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);

      const result = await service.deactivate({
        id: 50,
        customerId: 1,
        isSuperAdmin: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('DEACTIVATED');
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            status: 'INACTIVE',
            mobileLoginEnabled: false,
          }),
        }),
      );
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 10 } });
    });

    it('activate: sets status to ACTIVE, enables mobileLogin, returns ACTIVATED', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        status: 'INACTIVE',
        mobileLoginEnabled: false,
      });

      const result = await service.activate({
        id: 50,
        customerId: 1,
        isSuperAdmin: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('ACTIVATED');
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            status: 'ACTIVE',
            mobileLoginEnabled: true,
          }),
        }),
      );
    });

    it('blocks permanent deletion when protected history exists without archiving or mutating records', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendance.count.mockResolvedValue(5); // Employee has 5 attendance records

      await expect(service.remove({
        id: 50,
        customerId: 1,
        isSuperAdmin: false,
      })).rejects.toThrow(BadRequestException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });

    it('blocks deletion when a dependent cascade record is outside a selected reset workflow', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.workAccessRequest.count.mockResolvedValue(2);

      await expect(service.remove({
        id: 50,
        customerId: 1,
        isSuperAdmin: false,
      })).rejects.toThrow('Work access requests: 2');
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });

    it('does not delete when protected-history audit fails', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendance.count.mockRejectedValue(new Error('database unavailable'));
      await expect(service.remove({ id: 50, customerId: 1, isSuperAdmin: false })).rejects.toThrow('database unavailable');
      expect(prisma.employee.delete).not.toHaveBeenCalled();
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('remove (without protected history): permanently deletes employee record and cleans up user account', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      // All counts are 0
      prisma.attendance.count.mockResolvedValue(0);
      prisma.salarySlip.count.mockResolvedValue(0);
      prisma.payrollItem.count.mockResolvedValue(0);
      prisma.salaryStructure.count.mockResolvedValue(0);
      prisma.employeeClaim.count.mockResolvedValue(0);
      prisma.employeeLoan.count.mockResolvedValue(0);
      prisma.commission.count.mockResolvedValue(0);
      prisma.commissionWithdrawal.count.mockResolvedValue(0);
      prisma.leaveRequest.count.mockResolvedValue(0);
      prisma.employeeDeduction.count.mockResolvedValue(0);

      const result = await service.remove({
        id: 50,
        customerId: 1,
        isSuperAdmin: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('DELETED');
      expect(prisma.employee.delete).toHaveBeenCalledWith({
        where: { id: 50 },
      });
    });
  });
});
