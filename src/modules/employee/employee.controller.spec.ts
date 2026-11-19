import { EmployeeController } from './employee.controller';

describe('EmployeeController tenant context', () => {
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

  it('keeps the global Super Admin employee directory unscoped', async () => {
    await controller.findAll({ role: 'SUPER_ADMIN', customerId: null }, undefined);

    expect(employeeService.resolveDefaultCustomerId).not.toHaveBeenCalled();
    expect(employeeService.findAll).toHaveBeenCalledWith(expect.objectContaining({
      customerId: null,
      isSuperAdmin: true,
    }));
  });

  it('uses the authenticated tenant context for regular tenant employee lists', async () => {
    await controller.findAll({ role: 'CUSTOMER_ADMIN', customerId: 8 }, 8);

    expect(employeeService.findAll).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 8,
      isSuperAdmin: false,
    }));
  });

  it('uses the default tenant for a global Super Admin employee create', async () => {
    await controller.create({} as any, { role: 'SUPER_ADMIN', customerId: null }, undefined);

    expect(employeeService.resolveDefaultCustomerId).toHaveBeenCalledTimes(1);
    expect(employeeService.create).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 7,
      dto: {},
    }));
  });
});
