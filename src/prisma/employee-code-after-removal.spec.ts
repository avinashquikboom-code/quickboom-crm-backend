import { EmployeeService } from '../modules/employee/employee.service';

describe('employee codes after Customer removal', () => {
  it('allocates employee codes across the organization without looking up Customer', async () => {
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([{ employeeCode: 'EMP-003' }, { employeeCode: 'EMP-008' }]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new EmployeeService(prisma as any);
    await expect(service.getNextEmployeeCode(undefined, 'EMP')).resolves.toEqual({ nextEmployeeId: 'EMP-009', prefix: 'EMP' });
    expect(prisma.employee.findMany.mock.calls[0][0].where).not.toHaveProperty('customerId');
  });

});
