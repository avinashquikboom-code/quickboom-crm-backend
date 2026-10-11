import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { JwtStrategy } from '../../modules/auth/jwt.strategy';
import { EmployeeController } from '../../modules/employee/employee.controller';
import { EmployeeService } from '../../modules/employee/employee.service';
import { WorkService } from '../../modules/work/work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';

const SECRET = 'unit-test-access-secret';

const customers: Record<number, any> = {
  16: { id: 16, name: 'Tenant 16', email: 't16@example.test', isActive: true, deletedAt: null },
  17: { id: 17, name: 'Tenant 17', email: 't17@example.test', isActive: true, deletedAt: null },
};

const users: Record<number, any> = {
  5: {
    id: 5,
    email: 'admin16@example.test',
    isActive: true,
    deletedAt: null,
    customerId: 16,
    employee: null,
    customer: customers[16],
    userRoles: [{ role: { type: 'CUSTOMER_ADMIN', name: 'Customer Admin', rolePermissions: [] } }],
  },
  6: {
    id: 6,
    email: 'disabled16@example.test',
    isActive: false,
    deletedAt: null,
    customerId: 16,
    employee: null,
    customer: customers[16],
    userRoles: [],
  },
};

function modelMock(overrides: Record<string, jest.Mock> = {}) {
  return new Proxy(overrides, {
    get: (target, prop: string) =>
      target[prop] ?? (prop === 'findMany' ? jest.fn().mockResolvedValue([]) : jest.fn().mockResolvedValue(null)),
  });
}

const prismaMock: any = new Proxy(
  {
    user: modelMock({
      findUnique: jest.fn(({ where }) => Promise.resolve(users[where.id] ?? null)),
    }),
    customer: modelMock({
      findFirst: jest.fn(({ where }) => {
        const c = customers[Number(where?.id)];
        if (!c) return Promise.resolve(null);
        if (where.isActive === true && !c.isActive) return Promise.resolve(null);
        return Promise.resolve(c);
      }),
      findUnique: jest.fn(({ where }) => Promise.resolve(customers[Number(where?.id)] ?? null)),
    }),
  } as Record<string, any>,
  { get: (target, prop: string) => target[prop] ?? modelMock() },
);

const employeeServiceMock = {
  findOne: jest.fn(({ id, customerId }) =>
    Promise.resolve({ id: Number(id), customerId: Number(customerId), name: 'Employee' }),
  ),
};

function sign(payload: Record<string, any>, secret = SECRET, options: jwt.SignOptions = { expiresIn: '1h' }) {
  return jwt.sign(payload, secret, options);
}

const adminPayload = { sub: 5, userId: 5, customerId: 16, role: 'CUSTOMER_ADMIN', roleType: 'CUSTOMER_ADMIN' };

describe('JwtAuthGuard + JwtStrategy on GET /employees/:id', () => {
  let app: INestApplication;
  let warnSpy: jest.SpyInstance;
  const originalEnvSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [EmployeeController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined) } },
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmployeeService, useValue: employeeServiceMock },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    process.env.JWT_SECRET = originalEnvSecret;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const authLogs = () => warnSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('[JWT_AUTH_FAILURE]'));

  it('1. valid token reaches the employee endpoint scoped to the caller tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees/12')
      .set('Authorization', `Bearer ${sign(adminPayload)}`);

    expect(res.status).toBe(200);
    expect(employeeServiceMock.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: '12', customerId: 16, isSuperAdmin: false }),
    );
  });

  it('2. missing token returns 401 TOKEN_MISSING and never reaches the service', async () => {
    const res = await request(app.getHttpServer()).get('/employees/12');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_MISSING');
    expect(res.headers['x-correlation-id']).toBeTruthy();
    expect(employeeServiceMock.findOne).not.toHaveBeenCalled();
    expect(authLogs().join('\n')).toContain('category=missing');
  });

  it('3. expired token returns 401 TOKEN_EXPIRED so the client refreshes', async () => {
    const expired = sign({ ...adminPayload, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {});
    const res = await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
    expect(employeeServiceMock.findOne).not.toHaveBeenCalled();
    const log = authLogs().join('\n');
    expect(log).toContain('category=expired');
    expect(log).toMatch(/tokenExp=\d{4}-\d{2}-\d{2}T/);
  });

  it('4. token signed with a different secret returns 401 TOKEN_INVALID', async () => {
    const forged = sign(adminPayload, 'attacker-controlled-secret');
    const res = await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
    expect(employeeServiceMock.findOne).not.toHaveBeenCalled();
    expect(authLogs().join('\n')).toContain('category=invalid_signature');
  });

  it('5. malformed bearer value returns 401 and is categorised as malformed', async () => {
    const res = await request(app.getHttpServer()).get('/employees/12').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
    expect(authLogs().join('\n')).toContain('category=malformed');
  });

  it('6. deactivated user with a validly signed token cannot read employee records', async () => {
    const token = sign({ ...adminPayload, sub: 6, userId: 6 });
    const res = await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(employeeServiceMock.findOne).not.toHaveBeenCalled();
  });

  it('7. tenant user cannot switch tenant via customerId query', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees/12?customerId=17')
      .set('Authorization', `Bearer ${sign(adminPayload)}`);

    expect(res.status).toBe(403);
    expect(employeeServiceMock.findOne).not.toHaveBeenCalled();
  });

  it('8. auth failure logs never contain the bearer token', async () => {
    const forged = sign(adminPayload, 'attacker-controlled-secret');
    const expired = sign({ ...adminPayload, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {});
    await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${forged}`);
    await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${expired}`);

    const allLogs = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(allLogs).not.toContain(forged);
    expect(allLogs).not.toContain(expired);
    expect(allLogs).not.toContain(forged.split('.')[2]);
  });

  it('9. echoes a safe incoming correlation id and ignores unsafe ones', async () => {
    const ok = await request(app.getHttpServer()).get('/employees/12').set('x-request-id', 'req-abc_123');
    expect(ok.headers['x-correlation-id']).toBe('req-abc_123');

    const bad = await request(app.getHttpServer()).get('/employees/12').set('x-request-id', 'bad id\r\ninjected');
    expect(bad.headers['x-correlation-id']).not.toContain('injected');
  });

  it('10. other employee routes keep working with the same valid token', async () => {
    const token = sign(adminPayload);
    const first = await request(app.getHttpServer()).get('/employees/12').set('Authorization', `Bearer ${token}`);
    const second = await request(app.getHttpServer()).get('/employees/13').set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(employeeServiceMock.findOne).toHaveBeenCalledTimes(2);
  });
});
