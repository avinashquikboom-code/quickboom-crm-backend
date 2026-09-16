import { Test, TestingModule } from '@nestjs/testing';
import { DataManagementService } from './data-management.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';

describe('DataManagementService', () => {
  let service: DataManagementService;
  let prisma: any;

  const mockPrismaService = () => ({
    customer: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    lead: { count: jest.fn() },
    contact: { count: jest.fn() },
    company: { count: jest.fn() },
    deal: { count: jest.fn() },
    task: { count: jest.fn() },
    attendance: { count: jest.fn() },
    attendanceBreak: { count: jest.fn() },
    leaveRequest: { count: jest.fn() },
    remoteRequest: { count: jest.fn() },
    visit: { count: jest.fn() },
    payroll: { count: jest.fn() },
    salarySlip: { count: jest.fn() },
    payrollItem: { count: jest.fn() },
    notification: { count: jest.fn() },
    employeeLocation: { count: jest.fn() },
    employeeClaim: { count: jest.fn() },
    employeeLoan: { count: jest.fn() },
    work: { count: jest.fn() },
    workTask: { count: jest.fn() },
    monthlySchedule: { count: jest.fn() },
    supportTicket: { count: jest.fn() },
    department: { count: jest.fn() },
    designation: { count: jest.fn() },
    user: { count: jest.fn() },
    auditLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
  });

  beforeEach(async () => {
    prisma = mockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataManagementService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DataManagementService>(DataManagementService);
  });

  describe('Customer Data Management', () => {
    it('getSummary returns correct counts for customer', async () => {
      prisma.lead.count.mockResolvedValue(10);
      prisma.contact.count.mockResolvedValue(5);
      prisma.company.count.mockResolvedValue(2);
      prisma.deal.count.mockResolvedValue(3);
      prisma.task.count.mockResolvedValue(7);
      prisma.attendance.count.mockResolvedValue(20);
      prisma.attendanceBreak.count.mockResolvedValue(15);
      prisma.leaveRequest.count.mockResolvedValue(4);
      prisma.remoteRequest.count.mockResolvedValue(1);
      prisma.visit.count.mockResolvedValue(6);
      prisma.payroll.count.mockResolvedValue(2);
      prisma.salarySlip.count.mockResolvedValue(8);
      prisma.notification.count.mockResolvedValue(12);
      prisma.employeeLocation.count.mockResolvedValue(100);
      prisma.work.count.mockResolvedValue(9);
      prisma.monthlySchedule.count.mockResolvedValue(3);
      prisma.supportTicket.count.mockResolvedValue(2);
      prisma.employeeClaim.count.mockResolvedValue(1);
      prisma.employeeLoan.count.mockResolvedValue(0);
      prisma.employee.count.mockResolvedValue(5);
      prisma.department.count.mockResolvedValue(2);
      prisma.designation.count.mockResolvedValue(3);
      prisma.user.count.mockResolvedValue(6);
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.getSummary(1);
      expect(result.transactional.crm.total).toBe(27);
      expect(result.transactional.crm.leads).toBe(10);
      expect(result.transactional.attendance.total).toBe(35);
      expect(result.masterDataProtected.employees).toBe(5);
    });

    it('resetModule throws error on confirmation mismatch', async () => {
      await expect(
        service.resetModule(1, 1, 'SUPER_ADMIN', {
          module: 'crm',
          confirmation: 'WRONG CONFIRMATION',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resetModule throws BadRequestException for unsupported module', async () => {
      await expect(
        service.resetModule(
          1,
          1,
          'SUPER_ADMIN',
          { module: 'invalid_module' as any, confirmation: 'RESET INVALID MODULE' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('getCustomerSummary returns customer profile and module counts', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 1,
        name: 'ACME Corp',
        companyName: 'ACME Industries',
        email: 'admin@acme.com',
        phone: '1234567890',
        isActive: true,
      });

      prisma.lead.count.mockResolvedValue(10);
      prisma.contact.count.mockResolvedValue(5);
      prisma.company.count.mockResolvedValue(2);
      prisma.deal.count.mockResolvedValue(3);
      prisma.task.count.mockResolvedValue(7);
      prisma.attendance.count.mockResolvedValue(20);
      prisma.attendanceBreak.count.mockResolvedValue(15);
      prisma.leaveRequest.count.mockResolvedValue(4);
      prisma.remoteRequest.count.mockResolvedValue(1);
      prisma.visit.count.mockResolvedValue(6);
      prisma.payroll.count.mockResolvedValue(2);
      prisma.salarySlip.count.mockResolvedValue(8);
      prisma.notification.count.mockResolvedValue(12);
      prisma.employeeLocation.count.mockResolvedValue(100);
      prisma.work.count.mockResolvedValue(9);
      prisma.monthlySchedule.count.mockResolvedValue(3);
      prisma.supportTicket.count.mockResolvedValue(2);
      prisma.employeeClaim.count.mockResolvedValue(1);
      prisma.employeeLoan.count.mockResolvedValue(0);
      prisma.employee.count.mockResolvedValue(5);
      prisma.department.count.mockResolvedValue(2);
      prisma.designation.count.mockResolvedValue(3);
      prisma.user.count.mockResolvedValue(6);
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.getCustomerSummary(1);
      expect(result.customer.id).toBe(1);
      expect(result.customer.companyName).toBe('ACME Industries');
      expect(result.transactional.crm.total).toBe(27);
    });

    it('resetCustomerData performs atomic reset of all customer application data', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 1,
        name: 'ACME Corp',
        companyName: 'ACME Industries',
        email: 'admin@acme.com',
      });
      prisma.customer.update = jest.fn().mockResolvedValue({});
      prisma.auditLog = { create: jest.fn().mockResolvedValue({ id: 1 }) };
      prisma.lead = {
        deleteMany: jest.fn().mockResolvedValue({ count: 10 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.attendance = {
        deleteMany: jest.fn().mockResolvedValue({ count: 20 }),
        count: jest.fn().mockResolvedValue(0),
      };

      const result = await service.resetCustomerData(1, '1', 'SUPER_ADMIN');
      expect(result.success).toBe(true);
      expect(result.customerId).toBe(1);
      expect(result.message).toContain('Successfully reset all application data');
    });
  });

  describe('Employee Data Management', () => {
    const mockEmployee = {
      id: 5,
      customerId: 1,
      userId: 10,
      employeeCode: 'EMP-005',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '9999999999',
      department: { name: 'Engineering' },
      designation: { name: 'Developer' },
      status: 'ACTIVE',
      joiningDate: new Date(),
    };

    it('getEmployeeSummary returns employee profile and record counts', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendance.count.mockResolvedValue(15);
      prisma.attendanceBreak.count.mockResolvedValue(10);
      prisma.leaveRequest.count.mockResolvedValue(2);
      prisma.remoteRequest.count.mockResolvedValue(1);
      prisma.visit.count.mockResolvedValue(4);
      prisma.salarySlip.count.mockResolvedValue(3);
      prisma.payrollItem.count.mockResolvedValue(3);
      prisma.employeeLocation.count.mockResolvedValue(50);
      prisma.employeeClaim.count.mockResolvedValue(1);
      prisma.employeeLoan.count.mockResolvedValue(0);
      prisma.task.count.mockResolvedValue(6);
      prisma.workTask.count.mockResolvedValue(2);
      prisma.notification.count.mockResolvedValue(5);

      const result = await service.getEmployeeSummary(1, 5);

      expect(result.employee.employeeCode).toBe('EMP-005');
      expect(result.employee.name).toBe('John Doe');
      expect(result.counts.attendance).toBe(25);
      expect(result.counts.leave).toBe(2);
      expect(result.counts.tasks).toBe(6);
      expect(result.counts.total).toBe(102);
    });

    it('getEmployeeSummary throws NotFoundException when employee does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(service.getEmployeeSummary(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('getEmployeeSummary throws ForbiddenException for cross-tenant access', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee); // belongs to customer 1

      await expect(service.getEmployeeSummary(2, 5)).rejects.toThrow(ForbiddenException);
    });

    it('getEmployeeSummary succeeds without customer context', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);
      prisma.attendance.count.mockResolvedValue(5);
      prisma.attendanceBreak.count.mockResolvedValue(2);
      prisma.leaveRequest.count.mockResolvedValue(1);
      prisma.remoteRequest.count.mockResolvedValue(0);
      prisma.visit.count.mockResolvedValue(0);
      prisma.salarySlip.count.mockResolvedValue(1);
      prisma.payrollItem.count.mockResolvedValue(1);
      prisma.employeeLocation.count.mockResolvedValue(0);
      prisma.employeeClaim.count.mockResolvedValue(0);
      prisma.employeeLoan.count.mockResolvedValue(0);
      prisma.task.count.mockResolvedValue(2);
      prisma.workTask.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getEmployeeSummary(undefined as any, 5);

      expect(result.employee.employeeCode).toBe('EMP-005');
      expect(result.counts.total).toBe(12);
    });

    it('resetEmployeeModule rejects mismatched confirmation', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);

      await expect(
        service.resetEmployeeModule(1, 1, 'SUPER_ADMIN', 5, {
          module: 'attendance',
          confirmation: 'WRONG',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resetEmployeeAllTransactional performs full atomic employee data reset with verification', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);

      // Setup transactional mock delegate methods
      prisma.task = { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) };
      prisma.taskHistory = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
      prisma.taskProof = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.taskReview = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.workTask = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
      prisma.workAccessRequest = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.work = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.attendanceBreak = { deleteMany: jest.fn().mockResolvedValue({ count: 10 }) };
      prisma.attendance = {
        deleteMany: jest.fn().mockResolvedValue({ count: 15 }),
        count: jest.fn().mockResolvedValue(0), // Pre-commit verification: 0 remaining
      };
      prisma.leaveAdjustmentHistory = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.employeeLeaveBalance = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
      prisma.leaveRequest = {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.remoteRequest = {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.visit = {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.salarySlip = {
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.payrollItem = { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) };
      prisma.salaryStructure = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.employeeClaim = {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.employeeLoan = {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.locationTrackingSetting = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.employeeLocation = {
        deleteMany: jest.fn().mockResolvedValue({ count: 25 }),
        count: jest.fn().mockResolvedValue(0),
      };
      prisma.employeeModuleOverride = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.employeeLeadLimit = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.lead = { updateMany: jest.fn().mockResolvedValue({ count: 3 }) };
      prisma.monthlySchedule = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.team = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.department = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.customer = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.userDeviceToken = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      prisma.notification = { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) };
      prisma.auditLog = { create: jest.fn().mockResolvedValue({ id: 100 }) };

      const result = await service.resetEmployeeAllTransactional(1, 1, 'SUPER_ADMIN', 5, {
        confirmation: 'RESET ALL DATA FOR EMPLOYEE',
      });

      expect(result.success).toBe(true);
      expect(result.employeeId).toBe(5);
      expect(result.recordsDeleted).toBeGreaterThan(0);

      // Verify unlinking occurred
      expect(prisma.lead.updateMany).toHaveBeenCalledWith({
        where: { customerId: 1, employeeId: 5 },
        data: { employeeId: null },
      });
      expect(prisma.team.updateMany).toHaveBeenCalledWith({
        where: { customerId: 1, leaderId: 5 },
        data: { leaderId: null },
      });
      expect(prisma.work.updateMany).toHaveBeenCalled();
    });

    it('resetEmployeeAllTransactional throws InternalServerErrorException and rolls back if verification fails', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);

      prisma.attendance = {
        deleteMany: jest.fn().mockResolvedValue({ count: 15 }),
        count: jest.fn().mockResolvedValue(2), // Verification fails: 2 remaining!
      };
      prisma.leaveRequest = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.remoteRequest = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.visit = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.salarySlip = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.employeeLocation = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.task = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.workTask = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.employeeClaim = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      prisma.employeeLoan = { deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0) };

      await expect(
        service.resetEmployeeAllTransactional(1, 1, 'SUPER_ADMIN', 5, {
          confirmation: 'RESET ALL DATA FOR EMPLOYEE',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('Bin / Trash Management', () => {
    it('getBinItems returns empty array when no deleted records exist', async () => {
      prisma.customer.findMany = jest.fn().mockResolvedValue([]);
      prisma.employee.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.getBinItems();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      expect((result as any).customers).toEqual([]);
      expect((result as any).employees).toEqual([]);
      expect((result as any).totalCount).toBe(0);
    });

    it('getBinItems returns deleted customers and employees from database', async () => {
      prisma.customer.findMany = jest.fn().mockResolvedValue([
        {
          id: 10,
          name: 'Deleted Corp',
          companyName: 'Deleted Corp LLC',
          email: 'deleted@corp.com',
          isActive: false,
          deletedAt: new Date('2026-09-01T00:00:00.000Z'),
          _count: { leads: 3, contacts: 2, deals: 1, tasks: 4, employees: 2 },
          auditLogs: [{ createdAt: new Date(), user: { firstName: 'Admin', lastName: 'User', email: 'admin@qb.com' } }],
        },
      ]);
      prisma.employee.findMany = jest.fn().mockResolvedValue([
        {
          id: 20,
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@smith.com',
          employeeCode: 'EMP-020',
          customerId: 1,
          updatedAt: new Date('2026-09-02T00:00:00.000Z'),
          department: { name: 'Sales' },
          designation: { name: 'Executive' },
          _count: { attendances: 5, leaveRequests: 1, remoteRequests: 0, employeeLocations: 10, payrollItems: 2 },
          customer: { name: 'Main Corp', companyName: 'Main Corp' },
        },
      ]);

      const result = await service.getBinItems();
      expect(result.length).toBe(2);
      expect((result as any).totalCount).toBe(2);
      expect((result as any).customers.length).toBe(1);
      expect((result as any).employees.length).toBe(1);
      expect(result[0].type).toBe('CUSTOMER');
      expect(result[1].type).toBe('EMPLOYEE');
    });
  });
});
