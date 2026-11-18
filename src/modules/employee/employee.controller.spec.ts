import { EmployeeController } from './employee.controller';

describe('EmployeeController reporting-manager tenant context', () => {
  let controller: EmployeeController;
  let employeeService: {
    findAll: jest.Mock;
    create: jest.Mock;
    resolveDefaultCustomerId: jest.Mock;
  };

  beforeEach(() => {
    employeeService = {
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      create: jest.fn().mockResolvedValue({ id: 100 }),
      resolveDefaultCustomerId: jest.fn().mockResolvedValue(7),
    };
    controller = new EmployeeController(employeeService as any, {} as any);
  });

  it('scopes global Super Admin manager options to the same default tenant as create', async () => {
    await controller.findAll(
      { role: 'SUPER_ADMIN', customerId: null },
      undefined,
      undefined,
      undefined,
      'ACTIVE',
      undefined,
      undefined,
      undefined,
      undefined,
      '1',
      '100',
      undefined,
      undefined,
      'true',
    );

    expect(employeeService.resolveDefaultCustomerId).toHaveBeenCalledTimes(1);
    expect(employeeService.findAll).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 7,
      isSuperAdmin: true,
      status: 'ACTIVE',
    }));
  });

  it('keeps the global Super Admin directory unscoped unless manager options are requested', async () => {
    await controller.findAll({ role: 'SUPER_ADMIN', customerId: null }, undefined);

    expect(employeeService.resolveDefaultCustomerId).not.toHaveBeenCalled();
    expect(employeeService.findAll).toHaveBeenCalledWith(expect.objectContaining({
      customerId: undefined,
      isSuperAdmin: true,
    }));
  });

  it('uses the authenticated tenant context for regular tenant manager options', async () => {
    await controller.findAll(
      { role: 'CUSTOMER_ADMIN', customerId: 8 },
      8,
      '999',
      undefined,
      'ACTIVE',
      undefined,
      undefined,
      undefined,
      undefined,
      '1',
      '100',
      undefined,
      undefined,
      'true',
    );

    expect(employeeService.resolveDefaultCustomerId).not.toHaveBeenCalled();
    expect(employeeService.findAll).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 8,
      isSuperAdmin: false,
    }));
  });

  it('uses the same default tenant for a global Super Admin create', async () => {
    await controller.create(
      { managerId: 22 } as any,
      { role: 'SUPER_ADMIN', customerId: null },
      undefined,
    );

    expect(employeeService.resolveDefaultCustomerId).toHaveBeenCalledTimes(1);
    expect(employeeService.create).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 7,
      dto: { managerId: 22 },
    }));
  });
});
