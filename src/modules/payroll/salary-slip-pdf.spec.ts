import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceAccessGuard as PermissionsGuard } from '../../common/guards/workspace-access.guard';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';

describe('Salary slip PDF', () => {
  let service: PayrollService; let prisma: any; let res: any;
  const record: any = { id: 109, customerId: 3, employeeId: 10, payPeriod: 'August 2026',
    basicSalary: 10000, hra: 1000, allowances: 500, grossSalary: 11800, totalDeductions: 800, netSalary: 11000,
    generatedAt: new Date('2026-09-01'), employee: { id: 10, firstName: 'Fixture', salary: 99999 },
    payrollItem: { commission: 300, payroll: { month: 8, year: 2026 } } };
  beforeEach(() => {
    prisma = { salarySlip: { findFirst: jest.fn().mockResolvedValue(record) }, employee: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) } };
    service = new PayrollService(prisma);
    res = { headersSent: false, setHeader: jest.fn(), end: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res);
  });
  it('registers protected routes and rejects no token or SALARY permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PayrollController)).toBe('admin/payroll');
    expect(Reflect.getMetadata(PATH_METADATA, PayrollController.prototype.downloadSlip)).toBe('slips/:id/download');
    expect(Reflect.getMetadata(PATH_METADATA, PayrollController.prototype.downloadSlipPdf)).toBe('slips/:id/pdf');
    expect(Reflect.getMetadata(GUARDS_METADATA, PayrollController)).toContain(JwtAuthGuard);
    expect(() => new JwtAuthGuard(new Reflector()).handleRequest(null, null)).toThrow();
    const context: any = { getHandler: () => PayrollController.prototype.downloadSlip, getClass: () => PayrollController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'EMPLOYEE', permissions: [] } }) }) };
    expect(() => new PermissionsGuard(new Reflector()).canActivate(context)).toThrow();
  });
  it('renders persisted values into valid PDF with correct headers', async () => {
    const render = jest.spyOn(service, 'generateSalarySlipPdfBuffer');
    await service.downloadSalarySlipPdf(3, 109, res, { id: 2, role: 'COMPANY_ADMIN' });
    expect(prisma.salarySlip.findFirst.mock.calls[0][0].where).toEqual({ id: 109, customerId: 3 });
    expect(render.mock.calls[0][0]).toMatchObject({ basicSalary: 10000, grossSalary: 11800, netSalary: 11000, payPeriod: 'August 2026' });
    const bytes = res.end.mock.calls[0][0]; expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString().trimEnd().endsWith('%%EOF')).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', bytes.length);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="salary_slip_August_2026.pdf"');
  });
  it('returns JSON 404 for missing or cross-tenant slip', async () => {
    prisma.salarySlip.findFirst.mockResolvedValue(null);
    await service.downloadSalarySlipPdf(4, 109, res, { role: 'COMPANY_ADMIN' });
    expect(prisma.salarySlip.findFirst.mock.calls[0][0].where.customerId).toBe(4);
    expect(res.status).toHaveBeenCalledWith(404); expect(res.json).toHaveBeenCalledWith({ statusCode: 404, message: 'Salary slip not found' }); expect(res.end).not.toHaveBeenCalled();
  });
  it.each([null, { id: 11 }])('rejects missing or different employee ownership', async (employee) => {
    prisma.employee.findFirst.mockResolvedValue(employee);
    await service.downloadSalarySlipPdf(3, 109, res, { id: 2, role: 'EMPLOYEE' });
    expect(res.status).toHaveBeenCalledWith(403); expect(res.end).not.toHaveBeenCalled();
  });
  it('resolves owning employee from JWT user in tenant', async () => {
    await service.downloadSalarySlipPdf(3, 109, res, { id: 2, role: 'EMPLOYEE' });
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({ where: { userId: 2, customerId: 3 }, select: { id: true } }); expect(res.end).toHaveBeenCalled();
  });
});
