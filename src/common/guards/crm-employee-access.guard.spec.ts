import { ForbiddenException } from '@nestjs/common';
import { CrmEmployeeAccessGuard } from './crm-employee-access.guard';

function contextFor(user: any, method = 'GET', handlerName = 'findAll', query: any = {}) {
  const handler = function handler() { return undefined; };
  Object.defineProperty(handler, 'name', { value: handlerName });
  return {
    getHandler: () => handler,
    getClass: () => class LeadController {},
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        method,
        query,
        originalUrl: '/leads',
        url: '/leads',
      }),
    }),
  } as any;
}

describe('CrmEmployeeAccessGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(undefined),
  };
  const prisma = {
    employee: { findFirst: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const guard = new CrmEmployeeAccessGuard(reflector as any, prisma as any);

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(undefined);
  });

  it('allows a BPO employee to open CRM leads', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      id: 9,
      department: { name: 'BPO', code: 'BPO' },
      designation: { name: 'BPO Executive', code: 'BPO' },
    });
    await expect(guard.canActivate(contextFor({ id: 3, role: 'EMPLOYEE' }))).resolves.toBe(true);
  });

  it('allows a Visitor employee to open shared CRM reads', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      id: 8,
      department: { name: 'Field', code: 'FIELD' },
      designation: { name: 'Visitor', code: 'VISITOR' },
    });
    await expect(guard.canActivate(contextFor({ id: 4, role: 'EMPLOYEE' }))).resolves.toBe(true);
  });

  it('returns 403 for any other employee', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      id: 11,
      department: { name: 'Creative', code: 'CREATIVE' },
      designation: { name: 'Designer', code: 'DESIGNER' },
    });
    await expect(guard.canActivate(contextFor({ id: 5, role: 'EMPLOYEE' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 403 when a Visitor calls a BPO-only API', async () => {
    reflector.getAllAndOverride.mockReturnValue(['BPO']);
    prisma.employee.findFirst.mockResolvedValue({
      id: 8,
      designation: { name: 'Visitor', code: 'VISITOR' },
      department: { name: 'Field', code: 'FIELD' },
    });
    await expect(guard.canActivate(contextFor({ id: 4, role: 'EMPLOYEE' }, 'POST'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 403 when a BPO employee calls a Visitor-only API', async () => {
    reflector.getAllAndOverride.mockReturnValue(['VISITOR']);
    prisma.employee.findFirst.mockResolvedValue({
      id: 9,
      department: { name: 'BPO', code: 'BPO' },
      designation: { name: 'BPO Executive', code: 'BPO' },
    });
    await expect(guard.canActivate(contextFor({ id: 3, role: 'EMPLOYEE' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 403 when an employee requests another employee id', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      id: 9,
      department: { name: 'BPO', code: 'BPO' },
      designation: { name: 'BPO Executive', code: 'BPO' },
    });
    await expect(
      guard.canActivate(contextFor({ id: 3, role: 'EMPLOYEE', permissions: [] }, 'GET', 'findAll', { employeeId: '44' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not block company admins on the same CRM routes', async () => {
    await expect(guard.canActivate(contextFor({ id: 1, role: 'COMPANY_ADMIN' }))).resolves.toBe(true);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });
});
