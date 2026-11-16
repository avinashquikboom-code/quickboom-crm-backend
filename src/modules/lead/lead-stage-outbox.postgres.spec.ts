import { PrismaClient } from '@prisma/client';
import { LeadRepository } from './lead.repository';
import { LeadStageEmailDeliveryService } from './lead-stage-email-delivery.service';

// Explicitly opt in with a disposable database; never uses the application URL.
const url = process.env.STAGE_OUTBOX_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('stage outbox PostgreSQL integration', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://invalid/invalid' } } });
  let customer: any, user: any, lead: any, from: any, to: any;
  beforeAll(async () => {
    customer = await db.customer.create({ data: { name: 'Outbox isolated test' } });
    user = await db.user.create({ data: { customerId: customer.id, email: `outbox-${Date.now()}@example.invalid`, passwordHash: 'not-a-real-credential', firstName: 'Test', lastName: 'User' } });
    from = await db.leadStage.create({ data: { customerId: customer.id, name: 'New', key: 'NEW' } });
    to = await db.leadStage.create({ data: { customerId: customer.id, name: 'Connected', key: 'CONNECTED' } });
    lead = await db.lead.create({ data: { customerId: customer.id, createdById: user.id, title: 'Test', firstName: 'Test', lastName: 'Lead', stageId: from.id } });
  });
  afterAll(async () => { await db.$disconnect(); });
  it('rolls back stage and history when a delivery insert fails', async () => {
    const repo = new LeadRepository(db as any);
    await expect(repo.updateStatus(customer.id, lead.id, 'NEW', 'CONTACTED', 2147483647, undefined, to.id, from.id, to.name, false, lead.updatedAt, { previousStage: 'New', newStage: 'Connected' })).rejects.toThrow();
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stageId).toBe(from.id);
    expect(await db.leadStatusHistory.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await db.leadStageWhatsAppDelivery.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await db.leadStageEmailDelivery.count({ where: { leadId: lead.id } })).toBe(0);
  });
  it('commits both deliveries and allows only one concurrent claim', async () => {
    const repo = new LeadRepository(db as any);
    const id = await repo.updateStatus(customer.id, lead.id, 'NEW', 'CONTACTED', user.id, undefined, to.id, from.id, to.name, false, lead.updatedAt, { previousStage: 'New', newStage: 'Connected' });
    expect(id).toBeDefined();
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stageId).toBe(to.id);
    expect(await db.leadStatusHistory.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await db.leadStageWhatsAppDelivery.count({ where: { leadId: lead.id } })).toBe(1);
    const row = await db.leadStageEmailDelivery.findFirstOrThrow({ where: { leadId: lead.id } });
    const a = new LeadStageEmailDeliveryService(db as any), b = new LeadStageEmailDeliveryService(db as any);
    const claims = await Promise.all([a.claimQueued(row.id), b.claimQueued(row.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await db.leadStageEmailDelivery.findUniqueOrThrow({ where: { id: row.id } })).attemptCount).toBe(1);
  });
});
