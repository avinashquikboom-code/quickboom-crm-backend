import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { RecordCreatedFrom } from '@prisma/client';
import { LeadService } from './lead.service';

const admin = { id: 2, accountType: 'ADMIN' };
const employee = { id: 4, accountType: 'EMPLOYEE', employee: { id: 7, status: 'ACTIVE' } };
const platform = RecordCreatedFrom.ADMIN_PANEL;

function setup(status = 'VALIDATED') {
  let capture: any = { id: 11, businessName: 'Captured business', status, isImported: false, importedLeadId: null,
    googlePlaceId: 'test-place-id', phone: '123', email: 'test@example.test', website: 'https://example.test',
    address: 'Example address', category: 'Design', latitude: 18, longitude: 73, rawData: { city: 'Test City', state: 'Test State', country: 'Test Country', pincode: '123456' } };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    dataCapturePlace: { findFirst: jest.fn(async () => capture), update: jest.fn(async ({ data }) => (capture = { ...capture, ...data })) },
    lead: {
      create: jest.fn(async ({ data }) => ({ id: 31, ...data })),
      findFirst: jest.fn(async () => ({ id: 31, createdById: admin.id, assignedToId: null })),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new LeadService({ $transaction: (fn) => fn(tx) } as any);
  return { service, tx, getCapture: () => capture };
}

describe('independent Lead creation and Data Capture conversion', () => {
  it('creates and links a real Lead before marking the record imported', async () => {
    const { service, tx } = setup();
    const result = await service.importCapture(11, admin, platform);
    expect(result.lead).toMatchObject({ id: 31, companyName: 'Captured business', source: 'DATA_CAPTURE', createdFrom: 'ADMIN_PANEL', status: 'NEW', city: 'Test City', latitude: 18, createdById: 2, deletedAt: null });
    expect(result.capture).toMatchObject({ status: 'LEAD_IMPORTED', importedLeadId: 31, isImported: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('maps Google Places address components without guessing from the formatted address', async () => {
    const { service, getCapture } = setup();
    getCapture().rawData = { addressComponents: [
      { types: ['locality'], longText: 'Google City' },
      { types: ['administrative_area_level_1'], longText: 'Google State' },
      { types: ['country'], longText: 'Google Country' },
      { types: ['postal_code'], longText: '654321' },
    ] };
    const result = await service.importCapture(11, admin, platform);
    expect(result.lead).toMatchObject({ city: 'Google City', state: 'Google State', country: 'Google Country', pincode: '654321' });
  });

  it('reuses the linked Lead on repeated requests', async () => {
    const { service, tx } = setup();
    const first = await service.importCapture(11, admin, platform);
    const retry = await service.importCapture(11, admin, platform);
    expect(retry.lead.id).toBe(first.lead.id);
    expect(retry.alreadyImported).toBe(true);
    expect(tx.lead.create).toHaveBeenCalledTimes(1);
  });

  it.each(['CAPTURED', 'PENDING', 'NEW', 'REJECTED', 'DUPLICATE'])('rejects %s conversion without changing capture state', async (status) => {
    const { service, tx } = setup(status);
    await expect(service.importCapture(11, admin, platform)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(tx.dataCapturePlace.update).not.toHaveBeenCalled();
  });

  it('links an accessible Lead with the same Google Place instead of creating a duplicate', async () => {
    const { service, tx } = setup();
    tx.lead.findUnique.mockResolvedValue({ id: 32, createdById: 2, assignedToId: null } as any);
    const result = await service.importCapture(11, admin, platform);
    expect(result.capture.importedLeadId).toBe(32);
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it('does not create a false imported state when Lead creation fails', async () => {
    const { service, tx } = setup();
    tx.lead.create.mockRejectedValueOnce(new Error('storage failure'));
    await expect(service.importCapture(11, admin, platform)).rejects.toThrow('storage failure');
    expect(tx.dataCapturePlace.update).not.toHaveBeenCalled();
  });

  it('does not guess whether a legacy imported flag without a Lead link represents a real Lead', async () => {
    const { service, tx, getCapture } = setup();
    getCapture().isImported = true;
    await expect(service.importCapture(11, admin, platform)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it('assigns employee imports to the authenticated employee', async () => {
    const { service } = setup();
    const result = await service.importCapture(11, employee, platform);
    expect(result.lead).toMatchObject({ createdById: 4, assignedToId: 7 });
  });

  it('prevents employees from linking Leads outside their assignment/creator scope', async () => {
    const { service, tx } = setup();
    tx.lead.findUnique.mockResolvedValue({ id: 32, createdById: 99, assignedToId: 99 } as any);
    await expect(service.importCapture(11, employee, platform)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.dataCapturePlace.update).not.toHaveBeenCalled();
  });

  it('lists all nondeleted sources newest first, including manually created Leads', async () => {
    const prisma = { lead: { findMany: jest.fn().mockReturnValue([{ id: 31, source: 'MANUAL' }, { id: 32, source: 'DATA_CAPTURE' }]), count: jest.fn().mockReturnValue(2) }, $transaction: jest.fn(async (queries) => Promise.all(queries)) };
    const result = await new LeadService(prisma as any).findAll({ page: 1, limit: 20 }, admin);
    expect(result.data.map((lead) => lead.id)).toEqual([31, 32]);
    const options = prisma.lead.findMany.mock.calls[0][0];
    expect(options.where).not.toHaveProperty('source');
    expect(options.where.AND).toContainEqual({ deletedAt: null });
    expect(options.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('creates manual Leads with MANUAL/NEW and no soft deletion or tenant fields', async () => {
    const prisma = { lead: { create: jest.fn(async ({ data }) => ({ id: 44, ...data })) } };
    const result = await new LeadService(prisma as any).create({ companyName: ' Manual business ' }, admin, platform);
    expect(result).toMatchObject({ id: 44, companyName: 'Manual business', source: 'MANUAL', status: 'NEW', createdFrom: 'ADMIN_PANEL', deletedAt: null, createdById: 2 });
    expect(result).not.toHaveProperty('customerId');
  });

  it('provides all 11 CRM lead pipeline stages in the exact required order', () => {
    const service = new LeadService({} as any);
    const stages = service.getStages();
    expect(stages).toHaveLength(11);
    expect(stages.map((s) => ({ order: s.sortOrder, key: s.key, name: s.name }))).toEqual([
      { order: 1, key: 'NEW', name: 'New' },
      { order: 2, key: 'CONTACTED', name: 'Contacted' },
      { order: 3, key: 'DETAILS_SEND', name: 'Details send' },
      { order: 4, key: 'FOLLOW_UP', name: 'Follow-up' },
      { order: 5, key: 'VISIT_SCHEDULED', name: 'Visit Scheduled' },
      { order: 6, key: 'VISIT_DONE', name: 'Visit Done' },
      { order: 7, key: 'PROPOSAL_SENT', name: 'Proposal Sent' },
      { order: 8, key: 'NEGOTIATION', name: 'Negotiation' },
      { order: 9, key: 'FINAL_CALL', name: 'Final Call' },
      { order: 10, key: 'WON', name: 'Won' },
      { order: 11, key: 'LOST', name: 'Lost' },
    ]);
  });

  it('updates lead stage and returns mapped stage info with permissions check', async () => {
    const existingLead = { id: 50, createdById: 2, assignedToId: null, status: 'NEW', deletedAt: null, notes: 'Original note' };
    const updatedLead = { ...existingLead, status: 'DETAILS_SEND', notes: 'Original note\nSent catalog' };
    const prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue(existingLead),
        update: jest.fn().mockResolvedValue(updatedLead),
      },
    };
    const service = new LeadService(prisma as any);
    const result = await service.updateStage(50, { status: 'DETAILS_SEND', notes: 'Sent catalog' }, admin);
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 50 },
        data: { status: 'DETAILS_SEND', notes: 'Original note\nSent catalog' },
      }),
    );
    expect(result.status).toBe('DETAILS_SEND');
    expect(result.stageId).toBe(3);
    expect(result.stage).toMatchObject({ id: 3, key: 'DETAILS_SEND', name: 'Details send', sortOrder: 3 });
  });
});



describe('selected Data Capture bulk import', () => {
  it('reports partial outcomes, deduplicates IDs and continues after failures', async () => {
    const service = new LeadService({} as any);
    const importOne = jest.spyOn(service, 'importCapture');
    importOne.mockImplementation(async (id) => {
      if (id === 3) throw new BadRequestException('Only validated records can be imported');
      if (id === 4) throw new Error('Database unavailable');
      return { lead: { id: 100 + id }, capture: { id }, alreadyImported: id === 1 } as any;
    });
    const result = await service.importSelectedCaptures([1, 2, 2, 3, 4, 5], admin, platform);
    expect(result.imported).toEqual([{ captureId: 2, leadId: 102 }, { captureId: 5, leadId: 105 }]);
    expect(result.alreadyImported).toEqual([{ captureId: 1, leadId: 101 }]);
    expect(result.skipped).toEqual([{ captureId: 3, reason: 'Only validated records can be imported' }]);
    expect(result.failed).toEqual([{ captureId: 4, reason: 'Database unavailable' }]);
    expect(importOne).toHaveBeenCalledTimes(5);
  });

  it('keeps imported Leads visible under the shared Admin and Mobile list scope', async () => {
    const { service, tx } = setup();
    const imported = await service.importCapture(11, admin, platform);
    const prisma = { lead: { findMany: jest.fn().mockResolvedValue([imported.lead]), count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async queries => Promise.all(queries)) };
    const list = new LeadService(prisma as any);
    for (const user of [admin, employee]) {
      const result = await list.findAll({ page: 1, limit: 20 }, user);
      expect(result.data[0]).toMatchObject({ id: 31, status: 'NEW', stage: { key: 'NEW' }, assignedToId: null });
      const where = prisma.lead.findMany.mock.calls[prisma.lead.findMany.mock.calls.length - 1][0].where;
      expect(where).not.toHaveProperty('createdFrom');
      expect(where.AND).toContainEqual({ deletedAt: null });
      if (user === employee) expect(where.AND).toContainEqual({ OR: [
        { createdById: 4 }, { assignedToId: 7 }, { assignedToId: null },
      ] });
    }
  });
});


it('prevents an employee import from assigning a Lead to another employee', async () => {
  const { service, tx } = setup();
  await expect(service.importCapture(11, employee, platform, { assignedToId: 99 })).rejects.toBeInstanceOf(ForbiddenException);
  expect(tx.lead.create).not.toHaveBeenCalled();
});
