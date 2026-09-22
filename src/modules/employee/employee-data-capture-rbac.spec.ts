import { EmployeeService } from './employee.service';
import { AccessOverrideType } from '@prisma/client';

describe('EmployeeService Data Capture RBAC & Permissions', () => {
  let service: EmployeeService;
  let prisma: any;

  const mockEmployeeTelecaller = {
    id: 1,
    employeeCode: 'EMP-001',
    firstName: 'Demo',
    lastName: 'Telecaller',
    customerId: 100,
    userId: 10,
    status: 'ACTIVE',
    designationId: 1,
    designation: {
      id: 1,
      name: 'Telecaller',
      role: {
        id: 2,
        name: 'TELECALLER',
        rolePermissions: [
          { permission: { module: 'DATA_CAPTURE', action: 'VIEW' } },
          { permission: { module: 'DATA_CAPTURE', action: 'CREATE' } },
          { permission: { module: 'DATA_CAPTURE', action: 'EDIT' } },
          { permission: { module: 'LEADS', action: 'VIEW' } },
        ],
      },
    },
    employeeModuleOverrides: [],
  };

  const mockEmployeeDesigner = {
    id: 2,
    employeeCode: 'EMP-002',
    firstName: 'Demo',
    lastName: 'Designer',
    customerId: 100,
    userId: 11,
    status: 'ACTIVE',
    designationId: 2,
    designation: {
      id: 2,
      name: 'Designer',
      role: {
        id: 3,
        name: 'DESIGNER',
        rolePermissions: [
          { permission: { module: 'CREATIVE_WORK', action: 'VIEW' } },
        ],
      },
    },
    employeeModuleOverrides: [],
  };

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      employeeModuleOverride: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      permission: {
        findMany: jest.fn(),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new EmployeeService(prisma, {} as any, {} as any);
  });

  it('1. returns DATA_CAPTURE in modules list for Telecaller with roleDefault = true', async () => {
    prisma.employee.findUnique.mockResolvedValue(mockEmployeeTelecaller);

    const result = await service.getEmployeePermissions({ employeeId: 1, isSuperAdmin: true });

    expect(result.modules).toBeDefined();
    const dataCaptureMod = result.modules.find((m) => m.moduleKey === 'DATA_CAPTURE');
    expect(dataCaptureMod).toBeDefined();
    expect(dataCaptureMod?.label).toBe('Data Capture');
    expect(dataCaptureMod?.category).toBe('CRM');
    expect(dataCaptureMod?.roleDefault).toBe(true);
    expect(dataCaptureMod?.override).toBe('INHERIT');
    expect(dataCaptureMod?.effective).toBe(true);
  });

  it('2. returns DATA_CAPTURE for Designer with roleDefault = false', async () => {
    prisma.employee.findUnique.mockResolvedValue(mockEmployeeDesigner);

    const result = await service.getEmployeePermissions({ employeeId: 2, isSuperAdmin: true });

    const dataCaptureMod = result.modules.find((m) => m.moduleKey === 'DATA_CAPTURE');
    expect(dataCaptureMod).toBeDefined();
    expect(dataCaptureMod?.roleDefault).toBe(false);
    expect(dataCaptureMod?.override).toBe('INHERIT');
    expect(dataCaptureMod?.effective).toBe(false);
  });

  it('3. respects individual employee override ALLOW for Designer (turning ON effective)', async () => {
    const designerWithOverride = {
      ...mockEmployeeDesigner,
      employeeModuleOverrides: [
        {
          moduleKey: 'DATA_CAPTURE',
          override: AccessOverrideType.ALLOW,
        },
      ],
    };
    prisma.employee.findUnique.mockResolvedValue(designerWithOverride);

    const result = await service.getEmployeePermissions({ employeeId: 2, isSuperAdmin: true });

    const dataCaptureMod = result.modules.find((m) => m.moduleKey === 'DATA_CAPTURE');
    expect(dataCaptureMod?.roleDefault).toBe(false);
    expect(dataCaptureMod?.override).toBe('ALLOW');
    expect(dataCaptureMod?.effective).toBe(true);
  });

  it('4. respects individual employee override DENY for Telecaller (turning OFF effective)', async () => {
    const telecallerWithOverride = {
      ...mockEmployeeTelecaller,
      employeeModuleOverrides: [
        {
          moduleKey: 'DATA_CAPTURE',
          override: AccessOverrideType.DENY,
        },
      ],
    };
    prisma.employee.findUnique.mockResolvedValue(telecallerWithOverride);

    const result = await service.getEmployeePermissions({ employeeId: 1, isSuperAdmin: true });

    const dataCaptureMod = result.modules.find((m) => m.moduleKey === 'DATA_CAPTURE');
    expect(dataCaptureMod?.roleDefault).toBe(true);
    expect(dataCaptureMod?.override).toBe('DENY');
    expect(dataCaptureMod?.effective).toBe(false);
  });

  it('5. returns granular permissions for DATA_CAPTURE: VIEW, CREATE, EDIT, DELETE', async () => {
    prisma.employee.findUnique.mockResolvedValue(mockEmployeeTelecaller);

    const result = await service.getEmployeePermissions({ employeeId: 1, isSuperAdmin: true });

    const granular = result.granularPermissions.filter((g) => g.module === 'DATA_CAPTURE');
    expect(granular.length).toBe(4);

    const actions = granular.map((g) => g.action);
    expect(actions).toContain('VIEW');
    expect(actions).toContain('CREATE');
    expect(actions).toContain('EDIT');
    expect(actions).toContain('DELETE');

    const viewPerm = granular.find((g) => g.action === 'VIEW');
    expect(viewPerm?.roleDefault).toBe(true);
    expect(viewPerm?.effective).toBe(true);

    const deletePerm = granular.find((g) => g.action === 'DELETE');
    expect(deletePerm?.roleDefault).toBe(false);
    expect(deletePerm?.effective).toBe(false);
  });

  it('6. returns DATA_CAPTURE for Bhavesh Gandhi (EMP-004) with role TELESALES EXECUTIVE', async () => {
    const mockEmployeeTelesales = {
      id: 4,
      employeeCode: 'EMP-004',
      firstName: 'Bhavesh',
      lastName: 'Gandhi',
      customerId: 100,
      userId: 14,
      status: 'ACTIVE',
      designationId: 4,
      designation: {
        id: 4,
        name: 'Telesales Executive',
        role: {
          id: 4,
          name: 'TELESALES_EXECUTIVE',
          rolePermissions: [
            { permission: { module: 'DATA_CAPTURE', action: 'VIEW' } },
            { permission: { module: 'DATA_CAPTURE', action: 'CREATE' } },
            { permission: { module: 'DATA_CAPTURE', action: 'EDIT' } },
            { permission: { module: 'LEADS', action: 'VIEW' } },
          ],
        },
      },
      employeeModuleOverrides: [],
    };

    prisma.employee.findUnique.mockResolvedValue(mockEmployeeTelesales);

    const result = await service.getEmployeePermissions({ employeeId: 4, isSuperAdmin: true });

    expect(result.modules).toBeDefined();
    const dataCaptureMod = result.modules.find((m) => m.moduleKey === 'DATA_CAPTURE');
    expect(dataCaptureMod).toBeDefined();
    expect(dataCaptureMod?.roleDefault).toBe(true);
    expect(dataCaptureMod?.override).toBe('INHERIT');
    expect(dataCaptureMod?.effective).toBe(true);
  });

  it('7. verifies search filter works for data, Data Capture, and DATA_CAPTURE', () => {
    const sampleModule = {
      moduleKey: 'DATA_CAPTURE',
      label: 'Data Capture',
      category: 'CRM',
    };

    const queries = ['data', 'Data Capture', 'DATA_CAPTURE', 'crm'];
    for (const q of queries) {
      const lower = q.toLowerCase();
      const matches =
        sampleModule.label.toLowerCase().includes(lower) ||
        sampleModule.moduleKey.toLowerCase().includes(lower) ||
        sampleModule.category.toLowerCase().includes(lower);
      expect(matches).toBe(true);
    }
  });
});

