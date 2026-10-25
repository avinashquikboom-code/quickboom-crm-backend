import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadService } from './lead.service';

const admin = { id: 1, accountType: 'ADMIN' };
const employee = { id: 100, accountType: 'EMPLOYEE', employee: { id: 7, status: 'ACTIVE' } };
const other = { id: 200, accountType: 'EMPLOYEE', employee: { id: 8, status: 'ACTIVE' } };

function setup() {
  let lead: any;
  const capture: any = { id: 101, businessName: 'Capture fixture', phone: '123', email: 'fixture@example.test', status: 'VALIDATED', source: 'GOOGLE_PLACES', googlePlaceId: 'fixture-place' };
  const matches = (where: any): boolean => (!where.AND || where.AND.every(matches)) &&
    (!where.assignedToId || where.assignedToId === lead?.assignedToId) &&
    (!where.status || where.status === lead?.status);
  const prisma: any = {
    $queryRaw: jest.fn(async () => []),
    dataCapturePlace: {
      findFirst: jest.fn(async () => capture),
      update: jest.fn(async ({ data }) => Object.assign(capture, data)),
    },
    employee: { findFirst: jest.fn(async ({ where }) => [7, 8].includes(where.id) ? { id: where.id } : null) },
    lead: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => lead = { id: 55, ...data }),
      findFirst: jest.fn(async () => lead),
      findMany: jest.fn(async ({ where }) => lead && matches(where) ? [lead] : []),
      count: jest.fn(async ({ where }) => lead && matches(where) ? 1 : 0),
      update: jest.fn(async ({ data }) => lead = { ...lead, assignedToId: data.assignedTo.connect.id }),
    },
    $transaction: async (op: any) => typeof op === 'function' ? op(prisma) : Promise.all(op),
  };
  return { prisma, service: new LeadService(prisma) };
}

describe('Imported lead assignment and mobile visibility', () => {
  it('admin import remains private until assigned through the existing update API', async () => {
    const { service } = setup();
    const imported = await service.importCapture(101, admin, 'ADMIN_PANEL');
    expect(imported.lead).toMatchObject({ id: 55, assignedToId: null, status: 'NEW', stageId: 1, companyName: 'Capture fixture', phone: '123', email: 'fixture@example.test', source: 'Google Places' });
    expect((await service.findAll({ page: 1, limit: 20 }, employee)).total).toBe(0);
    await service.update(55, { assignedToId: 7 }, admin);
    expect((await service.findAll({ page: 1, limit: 20, status: 'NEW' }, employee)).data).toHaveLength(1);
    expect(await service.findOne(55, employee)).toMatchObject({ assignedToId: 7, stageId: 1 });
    expect((await service.findAll({ page: 1, limit: 20 }, other)).total).toBe(0);
    await expect(service.findOne(55, other)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('employee import assigns the employee ID rather than the user ID', async () => {
    const { service, prisma } = setup();
    const result = await service.importCapture(101, employee, 'MOBILE_APP');
    expect(result.lead.assignedToId).toBe(7);
    expect(prisma.lead.create.mock.calls[0][0].data.createdById).toBe(100);
    expect((await service.findAll({ page: 1, limit: 20 }, employee)).total).toBe(1);
  });

  it.each([100, 0, -1, 7.5])('rejects invalid assignee %s instead of silently creating an unassigned lead', async assignedToId => {
    const { service, prisma } = setup();
    await expect(service.importCapture(101, admin, 'ADMIN_PANEL', { assignedToId })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.dataCapturePlace.update).not.toHaveBeenCalled();
  });
});
