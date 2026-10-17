import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

const secret = 'lead-status-http-test-only';
describe('authenticated BPO Lead stage HTTP contract', () => {
  let app: INestApplication;
  let stored: any;
  const users: any = {
    7: { id: 7, isActive: true, deletedAt: null, accountType: 'EMPLOYEE', employee: { id: 70, status: 'ACTIVE', designation: { name: 'BPO' } } },
    1: { id: 1, isActive: true, deletedAt: null, accountType: 'ADMIN' },
    8: { id: 8, isActive: true, deletedAt: null, accountType: 'CUSTOMER' },
  };
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }) => users[where.id]) },
    lead: { findFirst: jest.fn(async () => stored), update: jest.fn(async ({ data }) => (stored = { ...stored, ...data })) },
  };
  const token = (id: number, expiresIn = 3600) => jwt.sign({ sub: id }, secret, { expiresIn });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule], controllers: [LeadController], providers: [
      LeadService, JwtStrategy,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { get: (key: string) => key === 'JWT_SECRET' ? secret : undefined } },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { stored = { id: 943, createdById: 1, assignedToId: 70, status: 'NEW', notes: 'Prior notes', deletedAt: null }; jest.clearAllMocks(); });
  it('authenticates BPO, persists stage and returns the same stage to Admin', async () => {
    const update = await request(app.getHttpServer()).patch('/api/v1/leads/943/status').set('Authorization', `Bearer ${token(7)}`).send({ status: 'CONTACTED', stageId: 2 });
    expect(update.status).toBe(200);
    expect(update.body.data).toMatchObject({ id: 943, status: 'CONTACTED', stage: { key: 'CONTACTED', name: 'Contacted' }, notes: 'Prior notes' });
    const admin = await request(app.getHttpServer()).get('/api/v1/leads/943').set('Authorization', `Bearer ${token(1)}`);
    expect(admin.body.data).toMatchObject({ id: 943, status: 'CONTACTED' });
    expect(prisma.lead.update).toHaveBeenCalledTimes(1);
  });
  it('returns all 11 stages identically to BPO and Admin', async () => {
    const read = (id: number) => request(app.getHttpServer()).get('/api/v1/leads/stages').set('Authorization', `Bearer ${token(id)}`);
    const bpo = await read(7), admin = await read(1);
    expect(bpo.status).toBe(200); expect(bpo.body.data).toEqual(admin.body.data); expect(bpo.body.data).toHaveLength(11);
  });
  it('rejects expired credentials before any mutation', async () => {
    const response = await request(app.getHttpServer()).patch('/api/v1/leads/943/status').set('Authorization', `Bearer ${token(7, -60)}`).send({ status: 'CONTACTED' });
    expect(response.status).toBe(401); expect(response.body.success).toBe(false); expect(prisma.lead.update).not.toHaveBeenCalled();
  });
  it('rejects a role without an active employee profile', async () => {
    const response = await request(app.getHttpServer()).patch('/api/v1/leads/943/status').set('Authorization', `Bearer ${token(8)}`).send({ status: 'CONTACTED' });
    expect(response.status).toBe(401); expect(prisma.lead.update).not.toHaveBeenCalled();
  });
  it('denies a BPO user another employee Lead', async () => {
    stored.assignedToId = 99;
    const response = await request(app.getHttpServer()).patch('/api/v1/leads/943/status').set('Authorization', `Bearer ${token(7)}`).send({ status: 'CONTACTED' });
    expect(response.status).toBe(403); expect(prisma.lead.update).not.toHaveBeenCalled();
  });
  it('reports mismatching stage identifiers as a 400', async () => {
    const response = await request(app.getHttpServer()).patch('/api/v1/leads/943/status').set('Authorization', `Bearer ${token(7)}`).send({ status: 'NEW', stageId: 2 });
    expect(response.status).toBe(400); expect(prisma.lead.update).not.toHaveBeenCalled();
  });
});
