import { LeadRepository } from './lead.repository';

describe('lead name enrichment and stage concurrency', () => {
  const initial = new Date('2026-11-15T11:00:00.000Z');
  const enriched = new Date('2026-11-15T11:00:01.000Z');
  const lead = () => ({ id: 7, customerId: 3, updatedAt: initial, title: 'New Lead', companyName: null, source: 'WEBSITE', createdFrom: 'MOBILE_APP', status: 'NEW', stageId: 1 });

  it('waits for enrichment and uses its updated version for the stage transition', async () => {
    const db: any = {
      lead: { update: jest.fn().mockResolvedValue({ updatedAt: enriched }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      leadStatusHistory: { create: jest.fn().mockResolvedValue({ id: 10 }) },
      leadActivityTimeline: { create: jest.fn().mockResolvedValue({}) },
    };
    const repository = new LeadRepository(db);
    const row = lead();
    await (repository as any).applyResolvedBusinessName(row, { businessName: 'Example' });
    expect(db.lead.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, customerId: 3, updatedAt: initial } }));
    expect(row.updatedAt).toEqual(enriched);
    await repository.updateStatus(3, 7, 'NEW' as any, 'CONTACTED' as any, 4, undefined, 2, 1, 'Contacted', true, row.updatedAt);
    expect(db.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 3, updatedAt: enriched, status: 'NEW', stageId: 1 }) }));
    expect(db.leadStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('does not write history when a concurrent change wins', async () => {
    const db: any = { lead: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, leadStatusHistory: { create: jest.fn() }, leadActivityTimeline: { create: jest.fn() } };
    const repository = new LeadRepository(db);
    await expect(repository.updateStatus(3, 7, 'NEW' as any, 'CONTACTED' as any, 4, undefined, 2, 1, 'Contacted', true, initial)).rejects.toThrow('Lead changed while saving');
    expect(db.leadStatusHistory.create).not.toHaveBeenCalled();
  });

  it('matches leads whose persisted stageId is NULL (resolved stage must not be used in the guard)', async () => {
    const db: any = {
      lead: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      leadStatusHistory: { create: jest.fn().mockResolvedValue({ id: 11 }) },
      leadActivityTimeline: { create: jest.fn().mockResolvedValue({}) },
    };
    const repository = new LeadRepository(db);
    // Simulates a lead whose DB stageId column is NULL while the resolved DTO
    // reported a stage derived from the legacy status key.
    await repository.updateStatus(3, 7, 'NEW' as any, 'CONTACTED' as any, 4, undefined, 2, null, 'Contacted', true, initial);
    expect(db.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stageId: null }) }));
    expect(db.leadStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite an already resolved name on every read', async () => {
    const db: any = { lead: { update: jest.fn() } };
    const repository = new LeadRepository(db);
    const row = { ...lead(), title: 'Example', companyName: 'Example' };
    await (repository as any).applyResolvedBusinessName(row, { businessName: 'Example' });
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});
