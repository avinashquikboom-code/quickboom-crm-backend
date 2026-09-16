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

    it('resetModule throws ForbiddenException if non-superadmin attempts cross-tenant reset', async () => {
      const callerUser = { id: 2, customerId: 2, role: 'TENANT_ADMIN' };
      await expect(
        service.resetModule(
          1,
          2,
          'TENANT_ADMIN',
          { module: 'crm', confirmation: 'RESET CRM' },
          callerUser,
        ),
      ).rejects.toThrow(ForbiddenException);
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

    it('getEmployeeSummary throws ForbiddenException for cross-tenant access by non-superadmin', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee); // belongs to customer 1
      const callerUser = { id: 8, customerId: 2, role: 'TENANT_ADMIN' }; // customer 2

      await expect(service.getEmployeeSummary(2, 5, callerUser)).rejects.toThrow(ForbiddenException);
    });

    it('getEmployeeSummary succeeds for Super Admin without customer context', async () => {
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

      const superAdminUser = { id: 1, role: 'SUPER_ADMIN' };
      const result = await service.getEmployeeSummary(undefined as any, 5, superAdminUser);

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
});
