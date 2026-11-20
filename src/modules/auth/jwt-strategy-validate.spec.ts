import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleType } from '@prisma/client';
import { EmployeeController } from '../employee/employee.controller';
import { DepartmentController } from '../department/department.controller';
import { DataManagementController } from '../data-management/data-management.controller';

describe('JwtStrategy.validate regression tests (No Employee.managerId mismatch)', () => {
  let strategy: JwtStrategy;
  let mockPrisma: any;
  let configService: ConfigService;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    configService = {
      get: jest.fn((key: string) => (key === 'JWT_SECRET' ? 'test-secret-key-123' : undefined)),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(configService, mockPrisma as unknown as PrismaService);
  });

  it('validates user without an Employee record (Super Admin / Customer account)', async () => {
    const mockUser = {
      id: 1,
      email: 'admin@quikboom.com',
      firstName: 'Super',
      lastName: 'Admin',
      customerId: 1,
      isActive: true,
      deletedAt: null,
      employee: null,
      customer: { id: 1, name: 'QuikBoom Corp', isActive: true },
      userRoles: [
        {
          role: {
            id: 1,
            name: 'Super Administrator',
            type: RoleType.SUPER_ADMIN,
            rolePermissions: [
              {
                permission: { id: 10, module: 'ALL', action: 'MANAGE' },
              },
            ],
          },
        },
      ],
    };

    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await strategy.validate({ sub: 1, role: 'SUPER_ADMIN' });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    const callArgs = mockPrisma.user.findUnique.mock.calls[0][0];

    // Assert that the query uses explicit select for employee and does NOT include managerId
    expect(callArgs.where).toEqual({ id: 1 });
    expect(callArgs.include.employee.select).toBeDefined();
    expect(callArgs.include.employee.select.managerId).toBeUndefined();

    // Verify validated user object
    expect(result.id).toBe(1);
    expect(result.email).toBe('admin@quikboom.com');
    expect(result.role).toBe('SUPER_ADMIN');
    expect(result.employee).toBeNull();
    expect(result.customerId).toBe(1);
  });

  it('validates user linked to an Employee without querying removed managerId column', async () => {
    const mockUser = {
      id: 2,
      email: 'john.doe@company.com',
      firstName: 'John',
      lastName: 'Doe',
      customerId: 10,
      isActive: true,
      deletedAt: null,
      employee: {
        id: 50,
        customerId: 10,
        userId: 2,
        employeeCode: 'QB-EMP-050',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@company.com',
        phone: '9876543210',
        gender: 'MALE',
        dob: new Date('1990-01-01'),
        joiningDate: new Date('2024-01-01'),
        departmentId: 5,
        designationId: 8,
        employmentType: 'FULL_TIME',
        employeeType: 'COMPANY',
        city: 'Mumbai',
        branch: 'Head Office',
        address: '123 Main St',
        emergencyContact: null,
        bankDetails: null,
        documents: null,
        status: 'ACTIVE',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        mobileLoginEnabled: true,
        permissionsUpdatedAt: new Date('2024-01-01'),
        officeId: null,
        shiftId: null,
        whatsappReportsOptIn: false,
        employeeModuleOverrides: [],
        designation: { id: 8, name: 'Sales Executive' },
        department: { id: 5, name: 'Sales', code: 'SALES' },
      },
      customer: { id: 10, name: 'Acme Corp', isActive: true },
      userRoles: [
        {
          role: {
            id: 2,
            name: 'Employee',
            type: RoleType.CUSTOM,
            rolePermissions: [
              {
                permission: { id: 20, module: 'LEADS', action: 'VIEW' },
              },
            ],
          },
        },
      ],
    };

    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await strategy.validate({ sub: 2, role: 'EMPLOYEE' });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    const callArgs = mockPrisma.user.findUnique.mock.calls[0][0];

    // Ensure managerId was not queried
    expect(callArgs.include.employee.select.managerId).toBeUndefined();

    // Verify validated employee data
    expect(result.id).toBe(2);
    expect(result.employee).toBeDefined();
    expect(result.employee.id).toBe(50);
    expect(result.employee.employeeCode).toBe('QB-EMP-050');
    expect(result.employee.customerId).toBe(10);
    expect((result.employee as any).managerId).toBeUndefined();
    expect(result.customerId).toBe(10);
    expect(result.customerCode).toBe('QB-CUST-010');
    expect(result.roles).toContain('EMPLOYEE');
  });

  it('adds only the authorized Sales Telecaller CRM permissions to a partial JWT role mapping', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 21,
      email: 'sales.telecaller@company.com',
      firstName: 'Sales',
      lastName: 'Telecaller',
      customerId: 10,
      isActive: true,
      deletedAt: null,
      employee: {
        id: 52,
        customerId: 10,
        userId: 21,
        status: 'ACTIVE',
        mobileLoginEnabled: true,
        department: { id: 5, name: 'Sales Department', code: 'SALES' },
        designation: { id: 8, name: 'Telecaller', code: 'TELECALLER', crmMobileAccess: true },
        employeeModuleOverrides: [],
      },
      customer: { id: 10, name: 'Acme Corp', isActive: true },
      userRoles: [{ role: {
        id: 3,
        name: 'TELECALLER',
        type: RoleType.CUSTOM,
        rolePermissions: [{ permission: { id: 30, module: 'LEADS', action: 'VIEW' } }],
      } }],
    });

    const result = await strategy.validate({ sub: 21, role: 'EMPLOYEE' });
    const granted = result.permissions.map((permission: any) => `${permission.module}:${permission.action}`);
    expect(granted).toEqual(expect.arrayContaining([
      'DATA_CAPTURE:VIEW',
      'DATA_CAPTURE:CREATE',
      'DATA_CAPTURE:EDIT',
      'LEADS:VIEW',
      'LEADS:CREATE',
      'LEADS:EDIT',
    ]));
    expect(granted).not.toContain('DATA_CAPTURE:DELETE');
    expect(granted).not.toContain('EMPLOYEES:MANAGE');
  });

  it('rejects invalid or inactive token subject', async () => {
    await expect(strategy.validate({ sub: null })).rejects.toThrow(UnauthorizedException);

    mockPrisma.user.findUnique.mockResolvedValue({ id: 99, isActive: false });
    await expect(strategy.validate({ sub: 99 })).rejects.toThrow(UnauthorizedException);

    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 100 })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an old access token after its linked employee is removed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101,
      isActive: false,
      deletedAt: null,
      employee: null,
      customer: { id: 9, isActive: true },
      userRoles: [],
    });

    await expect(strategy.validate({ sub: 101, role: 'EMPLOYEE' })).rejects.toThrow(
      'User account is inactive or no longer exists.',
    );
  });

  it('resolves tenant association and permissions for employee user', async () => {
    const mockUser = {
      id: 3,
      email: 'manager@tenant.com',
      firstName: 'Jane',
      lastName: 'Smith',
      customerId: null,
      isActive: true,
      deletedAt: null,
      employee: {
        id: 70,
        customerId: 25,
        userId: 3,
        employeeCode: 'QB-EMP-070',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'manager@tenant.com',
        status: 'ACTIVE',
        designationId: 3,
        designation: { id: 3, name: 'Operations Manager' },
        department: { id: 2, name: 'Operations', code: 'OPS' },
        employeeModuleOverrides: [],
      },
      customer: null,
      userRoles: [],
    };

    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await strategy.validate({ sub: 3, role: 'EMPLOYEE' });

    expect(result.customerId).toBe(25);
    expect(result.customerCode).toBe('QB-CUST-025');
    expect(result.employee.customerId).toBe(25);
    expect((result.employee as any).managerId).toBeUndefined();
  });
});

describe('API Controller regression checks with validated user context', () => {
  it('Employee list handler succeeds with validated user context', async () => {
    const mockEmployeeService = {
      findAll: jest.fn().mockResolvedValue({
        data: [{ id: 1, employeeCode: 'QB-EMP-001', firstName: 'Alice' }],
        meta: { total: 1, page: 1, limit: 100 },
      }),
    };

    const controller = new EmployeeController(mockEmployeeService as any, {} as any);
    const mockUser = { id: 1, customerId: 10, role: 'SUPER_ADMIN', permissions: ['*'] };

    const result = await controller.findAll(mockUser, 10, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '1', '100');
    expect(mockEmployeeService.findAll).toHaveBeenCalled();
    expect(result).toHaveProperty('data');
  });

  it('Department list handler succeeds with validated user context', async () => {
    const mockDepartmentService = {
      findAll: jest.fn().mockResolvedValue([
        { id: 1, name: 'Sales', code: 'SALES', customerId: 10, isActive: true },
      ]),
    };

    const controller = new DepartmentController(mockDepartmentService as any);
    const mockUser = { id: 1, customerId: 10, role: 'SUPER_ADMIN' };

    const result = await controller.findAll(mockUser, 10, undefined, undefined, 'true');

    expect(mockDepartmentService.findAll).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });

  it('Data Management overview, modules, and reset history succeed with validated user context', async () => {
    const mockGovernanceService = {
      overview: jest.fn().mockResolvedValue({ tables: 156, records: 1200 }),
      listModules: jest.fn().mockReturnValue([{ id: 'employees', name: 'Employees' }]),
      history: jest.fn().mockResolvedValue([{ id: 'h-1', action: 'DATA_RESET', status: 'SUCCESS' }]),
    };

    const controller = new DataManagementController(
      {} as any,
      mockGovernanceService as any,
    );

    const overview = await controller.overview('10');
    expect(mockGovernanceService.overview).toHaveBeenCalledWith('10');
    expect(overview).toEqual({ tables: 156, records: 1200 });

    const modules = controller.modules();
    expect(mockGovernanceService.listModules).toHaveBeenCalled();
    expect(modules).toEqual([{ id: 'employees', name: 'Employees' }]);

    const history = await controller.resetHistory('10');
    expect(mockGovernanceService.history).toHaveBeenCalledWith('10');
    expect(history).toEqual([{ id: 'h-1', action: 'DATA_RESET', status: 'SUCCESS' }]);
  });
});
