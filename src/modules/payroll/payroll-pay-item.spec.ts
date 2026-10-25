import { CanActivate, ConflictException, ExecutionContext, INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';

type Row = Record<string, any>;

function buildPrisma(itemOverrides: Row = {}, payrollOverrides: Row = {}) {
  const db = {
    item: {
      id: 141, customerId: 3, payrollId: 101, employeeId: 10, status: 'GENERATED',
      grossSalary: 30000, totalDeductions: 2000, netSalary: 28000,
      reimbursement: 500, loanDeduction: 1000, advanceDeduction: 0,
      calculationSnapshot: { payableDays: 30 }, salarySlips: [],
      ...itemOverrides,
    } as Row,
    payroll: { id: 101, customerId: 3, month: 9, year: 2026, status: 'GENERATED', ...payrollOverrides } as Row,
    loan: { id: 5, remainingBalance: 4000, status: 'ACTIVE' } as Row,
  };

  const tx = {
    payrollItem: {
      // Mirrors PostgreSQL row locking: the second writer re-evaluates the WHERE after the first commits.
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== db.item.id || where.customerId !== db.item.customerId || where.status !== db.item.status) {
          return { count: 0 };
        }
        Object.assign(db.item, data);
        return { count: 1 };
      }),
      count: jest.fn(async () => (db.item.status === 'PAID' ? 0 : 1)),
    },
    employeeClaim: { updateMany: jest.fn(async () => ({ count: 1 })) },
    employeeLoan: {
      findMany: jest.fn(async () => (db.loan.remainingBalance > 0 ? [{ ...db.loan }] : [])),
      update: jest.fn(async ({ data }: any) => Object.assign(db.loan, data)),
    },
    salarySlip: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
      update: jest.fn(),
    },
    commissionShare: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
    payroll: { update: jest.fn(async ({ data }: any) => Object.assign(db.payroll, data)) },
  };

  let queue = Promise.resolve();
  const prisma: any = {
    payrollItem: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === db.item.id && where.customerId === db.item.customerId
          ? { ...db.item, payroll: { ...db.payroll }, employee: { id: db.item.employeeId } }
          : null,
      ),
      update: jest.fn(),
    },
    salarySlip: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
    // Serialise transactions so concurrent callers observe each other's committed writes.
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<any>) => {
      const run = queue.then(() => cb(tx));
      queue = run.then(() => undefined, () => undefined);
      return run;
    }),
  };
  return { prisma, tx, db };
}

describe('PayrollService.payPayrollItem', () => {
  it('pays an eligible item once and settles its claims, loans and audit trail', async () => {
    const { prisma, tx, db } = buildPrisma();
    const service = new PayrollService(prisma);

    const result = await service.payPayrollItem(3, 141, { id: 1 });

    expect(result.success).toBe(true);
    expect(tx.payrollItem.updateMany).toHaveBeenCalledWith({
      where: { id: 141, customerId: 3, status: 'GENERATED' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(tx.employeeClaim.updateMany).toHaveBeenCalledTimes(1);
    expect(db.loan.remainingBalance).toBe(3000);
    expect(tx.salarySlip.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payrollItemId: 141, grossSalary: 30000, totalDeductions: 2000, netSalary: 28000, status: 'PAID' }),
    });
    expect(db.item.calculationSnapshot).toEqual({ payableDays: 30 });
    expect(db.payroll.status).toBe('PAID');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 3, entityId: '141' }) }),
    );
  });

  it('returns 404 for an item that does not exist or belongs to another tenant', async () => {
    const { prisma } = buildPrisma();
    const service = new PayrollService(prisma);

    await expect(service.payPayrollItem(3, 999, { id: 1 })).rejects.toThrow(NotFoundException);
    await expect(service.payPayrollItem(4, 141, { id: 1 })).rejects.toThrow('Payroll item #141 not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an already-paid item with 409 and does not settle anything again', async () => {
    const { prisma, tx } = buildPrisma({ status: 'PAID' });
    const service = new PayrollService(prisma);

    await expect(service.payPayrollItem(3, 141, { id: 1 })).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.employeeLoan.update).not.toHaveBeenCalled();
  });

  it('rejects items of a cancelled payroll batch', async () => {
    const { prisma } = buildPrisma({}, { status: 'CANCELLED' });
    const service = new PayrollService(prisma);

    await expect(service.payPayrollItem(3, 141, { id: 1 })).rejects.toThrow('cannot be paid');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('settles at most once when two pay requests race', async () => {
    const { prisma, tx, db } = buildPrisma();
    const service = new PayrollService(prisma);

    const results = await Promise.allSettled([
      service.payPayrollItem(3, 141, { id: 1 }),
      service.payPayrollItem(3, 141, { id: 2 }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(tx.employeeClaim.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.employeeLoan.update).toHaveBeenCalledTimes(1);
    expect(db.loan.remainingBalance).toBe(3000);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    if (!raw) throw new UnauthorizedException('Invalid or expired authentication token');
    req.user = JSON.parse(String(raw));
    return true;
  }
}

describe('POST /admin/payroll/items/:itemId/pay', () => {
  let app: INestApplication;
  const payrollService = { payPayrollItem: jest.fn() };
  const admin = { id: 1, customerId: 3, role: 'COMPANY_ADMIN', roles: ['COMPANY_ADMIN'], permissions: [] };
  const employee = {
    id: 2, customerId: 3, role: 'EMPLOYEE', roles: ['EMPLOYEE'],
    permissions: [{ module: 'SALARY', action: 'VIEW' }, { module: 'SALARY', action: 'DOWNLOAD' }],
  };
  const as = (user: any) => ({ 'x-test-user': JSON.stringify(user) });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PayrollController],
      providers: [{ provide: PayrollService, useValue: payrollService }],
    })
      .overrideGuard(JwtAuthGuard).useValue(new HeaderAuthGuard())
      .overrideGuard(CustomerGuard).useValue(new CustomerGuard(undefined, new Reflector()))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => payrollService.payPayrollItem.mockReset());

  it('is registered under /api/v1/admin/payroll and pays for an authorized payroll admin', async () => {
    payrollService.payPayrollItem.mockResolvedValue({ success: true, message: 'Payroll marked as paid', data: { id: 141 } });

    const res = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/141/pay').set(as(admin)).send({});

    expect(res.status).toBe(201);
    expect(payrollService.payPayrollItem).toHaveBeenCalledWith(3, 141, expect.objectContaining({ id: 1 }));
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/141/pay').send({});
    expect(res.status).toBe(401);
    expect(payrollService.payPayrollItem).not.toHaveBeenCalled();
  });

  it('rejects an employee who can only view salary slips with 403', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/141/pay').set(as(employee)).send({});
    expect(res.status).toBe(403);
    expect(payrollService.payPayrollItem).not.toHaveBeenCalled();
  });

  it('distinguishes a missing record (404 with item message) from a missing route', async () => {
    payrollService.payPayrollItem.mockRejectedValue(new NotFoundException('Payroll item #999 not found'));

    const record = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/999/pay').set(as(admin)).send({});
    expect(record.status).toBe(404);
    expect(record.body.message).toBe('Payroll item #999 not found');

    const route = await request(app.getHttpServer()).post('/api/v1/admin/payroll/item/999/pay').set(as(admin)).send({});
    expect(route.status).toBe(404);
    expect(route.body.message).toContain('Cannot POST');
  });

  it('returns 409 for an already-paid item and 400 for a non-numeric id', async () => {
    payrollService.payPayrollItem.mockRejectedValue(new ConflictException('Payroll item #141 is already paid'));
    const paid = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/141/pay').set(as(admin)).send({});
    expect(paid.status).toBe(409);
    expect(paid.body.message).toBe('Payroll item #141 is already paid');

    const bad = await request(app.getHttpServer()).post('/api/v1/admin/payroll/items/abc/pay').set(as(admin)).send({});
    expect(bad.status).toBe(400);
  });
});
