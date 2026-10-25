import { ForbiddenException } from '@nestjs/common';
import { LeadService } from './lead.service';

const admin = { id: 1, accountType: 'ADMIN' };
const employeeA = { id: 100, accountType: 'EMPLOYEE', employee: { id: 7, status: 'ACTIVE' } };
const employeeB = { id: 200, accountType: 'EMPLOYEE', employee: { id: 8, status: 'ACTIVE' } };

function fixture() {
  let lead: any = { id: 966, companyName: 'Contract fixture', source: 'GOOGLE_PLACES', status: 'NEW', createdById: employeeA.id, assignedToId: null, deletedAt: null };
  const matches = (where: any): boolean => (!where.AND || where.AND.every(matches)) &&
    (where.assignedToId === undefined || where.assignedToId === lead.assignedToId) &&
    (where.deletedAt === undefined || where.deletedAt === lead.deletedAt);
  const prisma: any = {
    employee: { findFirst: jest.fn(async ({ where }) => [7, 8].includes(where.id) ? { id: where.id } : null) },
    lead: {
      findFirst: jest.fn(async () => lead),
      findMany: jest.fn(async ({ where }) => matches(where) ? [lead] : []),
      count: jest.fn(async ({ where }) => matches(where) ? 1 : 0),
      update: jest.fn(async ({ data }) => {
        const { assignedTo, ...fields } = data;
        lead = { ...lead, ...fields, ...(assignedTo ? { assignedToId: assignedTo.connect?.id ?? null } : {}) };
        return lead;
      }),
    },
    $transaction: jest.fn(async operation => typeof operation === 'function' ? operation(prisma) : Promise.all(operation)),
  };
  return { prisma, service: new LeadService(prisma), getLead: () => lead };
}

describe('Assigned To is the employee lead access authority', () => {
  it('assignment and reassignment control list/detail access, regardless of creator or source', async () => {
    const { service, prisma } = fixture();
    // Unassigned records are not employee records, including for their creator.
    expect((await service.findAll({ page: 1, limit: 20 }, employeeA)).data).toEqual([]);
    await expect(service.findOne(966, employeeA)).rejects.toBeInstanceOf(ForbiddenException);
    await service.update(966, { assignedToId: 8 }, admin);
    expect(prisma.lead.update.mock.calls[0][0].data).toEqual({ assignedTo: { connect: { id: 8 } } });
    expect((await service.findAll({ page: 1, limit: 20 }, employeeB)).data).toHaveLength(1);
    expect(await service.findOne(966, employeeB)).toMatchObject({ assignedToId: 8, source: 'GOOGLE_PLACES', createdById: 100 });
    expect((await service.findAll({ page: 1, limit: 20 }, employeeA)).data).toEqual([]);
    await expect(service.findOne(966, employeeA)).rejects.toBeInstanceOf(ForbiddenException);
    await service.update(966, { assignedToId: 7 }, admin);
    expect((await service.findAll({ page: 1, limit: 20 }, employeeA)).data).toHaveLength(1);
    expect((await service.findAll({ page: 1, limit: 20 }, employeeB)).data).toEqual([]);
    await expect(service.findOne(966, employeeB)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.findAll({ page: 1, limit: 20 }, admin)).data).toHaveLength(1);
  });

  it('an employee cannot reassign their lead to another employee', async () => {
    const { service, prisma } = fixture();
    await service.update(966, { assignedToId: 7 }, admin);
    prisma.lead.update.mockClear();
    await expect(service.update(966, { assignedToId: 8 }, employeeA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('keeps search/status and pagination combined with assignment scope', async () => {
    const { service, prisma } = fixture();
    await service.findAll({ page: 2, limit: 10, search: 'Contract', status: 'NEW' }, employeeB);
    const options = prisma.lead.findMany.mock.calls[0][0];
    expect(options.where.AND).toEqual([{ deletedAt: null }, { assignedToId: 8 }]);
    expect(options.where.status).toBe('NEW');
    expect(options.where.OR).toContainEqual({ companyName: { contains: 'Contract', mode: 'insensitive' } });
    expect(options).toMatchObject({ skip: 10, take: 10 });
  });

  it('allows Super Admin full lead visibility across all records', async () => {
    const { service } = fixture();
    const superAdmin = { id: 2, accountType: 'SUPER_ADMIN' };
    const result = await service.findAll({ page: 1, limit: 20 }, superAdmin);
    expect(result.data).toHaveLength(1);
    expect(await service.findOne(966, superAdmin)).toMatchObject({ id: 966 });
  });

  it('allows admin to unassign a lead which immediately hides it from previous employee', async () => {
    const { service, prisma } = fixture();
    await service.update(966, { assignedToId: 8 }, admin);
    expect((await service.findAll({ page: 1, limit: 20 }, employeeB)).data).toHaveLength(1);
    await service.update(966, { assignedToId: null }, admin);
    expect(prisma.lead.update.mock.calls[1][0].data).toEqual({ assignedTo: { disconnect: true } });
    expect((await service.findAll({ page: 1, limit: 20 }, employeeB)).data).toEqual([]);
    await expect(service.findOne(966, employeeB)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.findAll({ page: 1, limit: 20 }, admin)).data).toHaveLength(1);
  });

  it('rejects assigning an inactive or non-existent employee', async () => {
    const { service, prisma } = fixture();
    const { BadRequestException } = require('@nestjs/common');
    await expect(service.update(966, { assignedToId: 999 }, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });
});
