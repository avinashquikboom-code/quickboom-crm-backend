import { DataGovernanceService } from './data-governance.service';
import { tablesForModules } from './data-governance.catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaClient } from '@prisma/client';

describe('Data Management Reset – MetaTemplate & RESTRICT Foreign Key PostgreSQL Integration', () => {
  let prisma: PrismaService;
  let service: DataGovernanceService;
  let tenantAId: number;
  let tenantBId: number;

  beforeAll(async () => {
    prisma = new PrismaService();
    service = new DataGovernanceService(prisma);

    // Ensure we have two distinct test tenants
    const existing = await prisma.customer.findMany({ take: 2 });
    if (existing.length >= 2) {
      tenantAId = existing[0].id;
      tenantBId = existing[1].id;
    } else {
      const createdA = await prisma.customer.create({
        data: { name: 'Integration Test Tenant A ' + Date.now() },
      });
      const createdB = await prisma.customer.create({
        data: { name: 'Integration Test Tenant B ' + Date.now() },
      });
      tenantAId = createdA.id;
      tenantBId = createdB.id;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper to clean up any remaining test data for a given prefix
  async function cleanupPrefix(prefix: string) {
    const templates = await prisma.metaTemplate.findMany({
      where: { templateName: { startsWith: prefix } },
      select: { id: true },
    });
    const templateIds = templates.map((t) => t.id);
    if (templateIds.length) {
      const campaigns = await prisma.whatsAppCampaign.findMany({
        where: { metaTemplateId: { in: templateIds } },
        select: { id: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      if (campaignIds.length) {
        await prisma.whatsAppCampaignRecipient.deleteMany({
          where: { campaignId: { in: campaignIds } },
        });
        await prisma.whatsAppCampaign.deleteMany({
          where: { id: { in: campaignIds } },
        });
      }
      await prisma.metaTemplate.deleteMany({
        where: { id: { in: templateIds } },
      });
    }
  }

  describe('1. Delete campaigns and templates together', () => {
    const prefix = 'int_test_1_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('deletes child campaigns before parent templates without RESTRICT violation', async () => {
      const template = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Template 1',
          templateName: `${prefix}t1_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const campaign = await prisma.whatsAppCampaign.create({
        data: {
          customerId: tenantAId,
          name: 'Campaign 1',
          metaTemplateId: template.id,
          status: 'DRAFT',
        },
      });

      const recipient = await prisma.whatsAppCampaignRecipient.create({
        data: {
          campaignId: campaign.id,
          phone: '+1234567890',
          status: 'PENDING',
        },
      });

      // Verify deletion ordering in tablesForModules: child before parent
      const tables = tablesForModules(['templates', 'whatsapp-campaigns']);
      const campaignIdx = tables.findIndex((t) => t.model === 'whatsAppCampaign');
      const recipientIdx = tables.findIndex((t) => t.model === 'whatsAppCampaignRecipient');
      const templateIdx = tables.findIndex((t) => t.model === 'metaTemplate');

      expect(recipientIdx).toBeLessThan(campaignIdx);
      expect(campaignIdx).toBeLessThan(templateIdx);

      const preview = await service.previewReset(tenantAId, {
        modules: ['templates', 'whatsapp-campaigns'],
      });

      expect(preview.metaTemplateAnalysis.totalCampaignsReferencing).toBeGreaterThanOrEqual(1);
      expect(preview.metaTemplateAnalysis.blockedTemplates).toBe(0);
      expect(preview.metaTemplateAnalysis.eligibleTemplates).toBeGreaterThanOrEqual(1);

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates', 'whatsapp-campaigns'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-1-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');

      // Verify in PostgreSQL that records are deleted
      const foundTemplate = await prisma.metaTemplate.findUnique({ where: { id: template.id } });
      const foundCampaign = await prisma.whatsAppCampaign.findUnique({ where: { id: campaign.id } });
      const foundRecipient = await prisma.whatsAppCampaignRecipient.findUnique({ where: { id: recipient.id } });

      expect(foundTemplate).toBeNull();
      expect(foundCampaign).toBeNull();
      expect(foundRecipient).toBeNull();
    });
  });

  describe('2. Select templates without campaigns', () => {
    const prefix = 'int_test_2_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('preserves templates referenced by unselected campaigns and deletes unreferenced templates', async () => {
      // Template with campaign
      const tWithCamp = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Template With Campaign',
          templateName: `${prefix}with_camp_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const campaign = await prisma.whatsAppCampaign.create({
        data: {
          customerId: tenantAId,
          name: 'Campaign For T1',
          metaTemplateId: tWithCamp.id,
          status: 'DRAFT',
        },
      });

      // Template without campaign
      const tWithoutCamp = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Template Free',
          templateName: `${prefix}free_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const preview = await service.previewReset(tenantAId, {
        modules: ['templates'],
      });

      expect(preview.metaTemplateAnalysis.blockedTemplates).toBeGreaterThanOrEqual(1);
      const metaTemplateTable = preview.tables.find((t) => t.model === 'metaTemplate');
      expect(metaTemplateTable?.preservedRecords).toBeGreaterThanOrEqual(1);

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-2-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');

      // The unreferenced template was deleted
      const foundFree = await prisma.metaTemplate.findUnique({ where: { id: tWithoutCamp.id } });
      expect(foundFree).toBeNull();

      // The referenced template and campaign remain intact in PostgreSQL
      const foundWithCamp = await prisma.metaTemplate.findUnique({ where: { id: tWithCamp.id } });
      const foundCamp = await prisma.whatsAppCampaign.findUnique({ where: { id: campaign.id } });
      expect(foundWithCamp).not.toBeNull();
      expect(foundCamp).not.toBeNull();
    });
  });

  describe('3. Protected campaigns referencing templates', () => {
    const prefix = 'int_test_3_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('preserves protected/running campaigns and their referenced templates', async () => {
      const template = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Template Protected',
          templateName: `${prefix}prot_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const runningCampaign = await prisma.whatsAppCampaign.create({
        data: {
          customerId: tenantAId,
          name: 'Running Campaign',
          metaTemplateId: template.id,
          status: 'RUNNING',
        },
      });

      const preview = await service.previewReset(tenantAId, {
        modules: ['templates', 'whatsapp-campaigns'],
      });

      expect(preview.metaTemplateAnalysis.protectedCampaigns).toBeGreaterThanOrEqual(1);
      expect(preview.metaTemplateAnalysis.blockedTemplates).toBeGreaterThanOrEqual(1);

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates', 'whatsapp-campaigns'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-3-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');

      // Running campaign and its template are preserved
      const foundTemplate = await prisma.metaTemplate.findUnique({ where: { id: template.id } });
      const foundCampaign = await prisma.whatsAppCampaign.findUnique({ where: { id: runningCampaign.id } });
      expect(foundTemplate).not.toBeNull();
      expect(foundCampaign).not.toBeNull();
    });
  });

  describe('4. Cross-tenant campaign references', () => {
    const prefix = 'int_test_4_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('preserves cross-tenant campaigns and blocks deletion of referenced templates', async () => {
      // Tenant A template
      const templateA = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Template Owned By A',
          templateName: `${prefix}t_a_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      // Tenant B campaign referencing Tenant A's template
      const campaignB = await prisma.whatsAppCampaign.create({
        data: {
          customerId: tenantBId,
          name: 'Campaign Owned By B',
          metaTemplateId: templateA.id,
          status: 'DRAFT',
        },
      });

      // Tenant A resets
      const previewA = await service.previewReset(tenantAId, {
        modules: ['templates', 'whatsapp-campaigns'],
      });

      expect(previewA.metaTemplateAnalysis.crossTenantCampaigns).toBeGreaterThanOrEqual(1);
      expect(previewA.metaTemplateAnalysis.blockedTemplates).toBeGreaterThanOrEqual(1);

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates', 'whatsapp-campaigns'],
        previewToken: previewA.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-4-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');

      // Tenant A's template was preserved because Tenant B's campaign references it
      const foundTemplateA = await prisma.metaTemplate.findUnique({ where: { id: templateA.id } });
      const foundCampaignB = await prisma.whatsAppCampaign.findUnique({ where: { id: campaignB.id } });
      expect(foundTemplateA).not.toBeNull();
      expect(foundCampaignB).not.toBeNull();
    });
  });

  describe('5. Multiple campaigns referencing one template', () => {
    const prefix = 'int_test_5_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('handles multiple campaigns referencing a single template correctly', async () => {
      const template = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Multi Campaign Template',
          templateName: `${prefix}multi_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const c1 = await prisma.whatsAppCampaign.create({
        data: { customerId: tenantAId, name: 'C1', metaTemplateId: template.id, status: 'DRAFT' },
      });
      const c2 = await prisma.whatsAppCampaign.create({
        data: { customerId: tenantAId, name: 'C2', metaTemplateId: template.id, status: 'COMPLETED' },
      });

      // Case A: When only templates selected -> template is preserved
      const previewTemplatesOnly = await service.previewReset(tenantAId, { modules: ['templates'] });
      expect(previewTemplatesOnly.metaTemplateAnalysis.totalCampaignsReferencing).toBeGreaterThanOrEqual(2);
      expect(previewTemplatesOnly.metaTemplateAnalysis.blockedTemplates).toBeGreaterThanOrEqual(1);

      // Case B: When both selected -> both campaigns deleted first, template deleted afterward
      const previewBoth = await service.previewReset(tenantAId, { modules: ['templates', 'whatsapp-campaigns'] });
      expect(previewBoth.metaTemplateAnalysis.blockedTemplates).toBe(0);

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates', 'whatsapp-campaigns'],
        previewToken: previewBoth.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-5-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');
      const foundT = await prisma.metaTemplate.findUnique({ where: { id: template.id } });
      const foundC1 = await prisma.whatsAppCampaign.findUnique({ where: { id: c1.id } });
      const foundC2 = await prisma.whatsAppCampaign.findUnique({ where: { id: c2.id } });
      expect(foundT).toBeNull();
      expect(foundC1).toBeNull();
      expect(foundC2).toBeNull();
    });
  });

  describe('6. Multiple templates referenced by campaigns', () => {
    const prefix = 'int_test_6_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('handles multiple templates referenced by multiple campaigns', async () => {
      const t1 = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T1', templateName: `${prefix}t1_${Date.now()}`, body: 'B1', isSystem: false },
      });
      const t2 = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T2', templateName: `${prefix}t2_${Date.now()}`, body: 'B2', isSystem: false },
      });
      const tFree = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T3 Free', templateName: `${prefix}t3_${Date.now()}`, body: 'B3', isSystem: false },
      });

      const c1 = await prisma.whatsAppCampaign.create({
        data: { customerId: tenantAId, name: 'C1', metaTemplateId: t1.id, status: 'DRAFT' },
      });
      const c2 = await prisma.whatsAppCampaign.create({
        data: { customerId: tenantAId, name: 'C2', metaTemplateId: t2.id, status: 'DRAFT' },
      });

      // When only templates selected: t1 and t2 preserved, tFree deleted
      const preview = await service.previewReset(tenantAId, { modules: ['templates'] });
      expect(preview.metaTemplateAnalysis.blockedTemplates).toBeGreaterThanOrEqual(2);

      await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-6-${Date.now()}`,
      });

      expect(await prisma.metaTemplate.findUnique({ where: { id: tFree.id } })).toBeNull();
      expect(await prisma.metaTemplate.findUnique({ where: { id: t1.id } })).not.toBeNull();
      expect(await prisma.metaTemplate.findUnique({ where: { id: t2.id } })).not.toBeNull();

      // Clean up remaining
      await prisma.whatsAppCampaign.deleteMany({ where: { id: { in: [c1.id, c2.id] } } });
      await prisma.metaTemplate.deleteMany({ where: { id: { in: [t1.id, t2.id] } } });
    });
  });

  describe('7. Transaction rollback on deletion failure', () => {
    const prefix = 'int_test_7_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('rolls back the complete reset transaction if an unexpected error occurs', async () => {
      const template = await prisma.metaTemplate.create({
        data: {
          customerId: tenantAId,
          name: 'Rollback Template',
          templateName: `${prefix}rb_${Date.now()}`,
          body: 'Body text',
          isSystem: false,
        },
      });

      const campaign = await prisma.whatsAppCampaign.create({
        data: {
          customerId: tenantAId,
          name: 'Rollback Campaign',
          metaTemplateId: template.id,
          status: 'DRAFT',
        },
      });

      const preview = await service.previewReset(tenantAId, {
        modules: ['templates', 'whatsapp-campaigns'],
      });

      // Inject a failure inside the transaction on metaTemplate.deleteMany
      const origTransaction = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: any, options: any) => {
        return origTransaction(async (tx: any) => {
          tx.metaTemplate.deleteMany = jest.fn().mockRejectedValue(new Error('Simulated database error during metaTemplate deletion'));
          return fn(tx);
        }, options);
      });

      try {
        await expect(
          service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
            modules: ['templates', 'whatsapp-campaigns'],
            previewToken: preview.previewToken,
            confirmation: 'RESET',
            idempotencyKey: `test-7-${Date.now()}`,
          }),
        ).rejects.toThrow('Simulated database error during metaTemplate deletion');
      } finally {
        jest.restoreAllMocks();
      }

      // Verify that after rollback, template and campaign are STILL IN DATABASE
      const foundTemplate = await prisma.metaTemplate.findUnique({ where: { id: template.id } });
      const foundCampaign = await prisma.whatsAppCampaign.findUnique({ where: { id: campaign.id } });
      expect(foundTemplate).not.toBeNull();
      expect(foundCampaign).not.toBeNull();
    });
  });

  describe('8. Preview versus execution count consistency', () => {
    const prefix = 'int_test_8_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('maintains strict consistency between preview eligible counts and execution deleted counts', async () => {
      const t1 = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T1', templateName: `${prefix}t1_${Date.now()}`, body: 'B1', isSystem: false },
      });
      const t2 = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T2', templateName: `${prefix}t2_${Date.now()}`, body: 'B2', isSystem: false },
      });
      const camp = await prisma.whatsAppCampaign.create({
        data: { customerId: tenantAId, name: 'C1', metaTemplateId: t1.id, status: 'DRAFT' },
      });

      // Preview templates only
      const preview = await service.previewReset(tenantAId, { modules: ['templates'] });
      const tTable = preview.tables.find((t) => t.model === 'metaTemplate');
      expect(tTable?.preservedRecords).toBe(1); // t1 is blocked
      const expectedEligible = tTable?.eligibleRecords;

      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-8-${Date.now()}`,
      });

      expect((result as any).tables['metaTemplate']).toBe(expectedEligible);
      expect((result as any).preservedCounts['metaTemplate']).toBe(1);

      // Clean up
      await prisma.whatsAppCampaign.delete({ where: { id: camp.id } });
      await prisma.metaTemplate.deleteMany({ where: { id: { in: [t1.id, t2.id] } } });
    });
  });

  describe('9. Retry after failed reset', () => {
    const prefix = 'int_test_9_';
    beforeEach(async () => cleanupPrefix(prefix));
    afterEach(async () => cleanupPrefix(prefix));

    it('allows a safe, idempotent retry after a failed reset attempt', async () => {
      const t = await prisma.metaTemplate.create({
        data: { customerId: tenantAId, name: 'T Retry', templateName: `${prefix}retry_${Date.now()}`, body: 'B', isSystem: false },
      });

      const preview1 = await service.previewReset(tenantAId, { modules: ['templates'] });

      // First attempt with invalid confirmation fails
      await expect(
        service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
          modules: ['templates'],
          previewToken: preview1.previewToken,
          confirmation: 'WRONG_CONFIRMATION',
          idempotencyKey: `test-9-${Date.now()}`,
        }),
      ).rejects.toThrow('Type RESET to confirm deletion.');

      // Second attempt (retry) with fresh preview and valid confirmation succeeds
      const preview2 = await service.previewReset(tenantAId, { modules: ['templates'] });
      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['templates'],
        previewToken: preview2.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-9-retry-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');
      expect(await prisma.metaTemplate.findUnique({ where: { id: t.id } })).toBeNull();
    });
  });

  describe('10. Other RESTRICT foreign-key dependencies (Contact & Invoice)', () => {
    it('deletes invoices before contacts when both billing and customers are selected', async () => {
      const tables = tablesForModules(['billing', 'customers']);
      const invoiceItemIdx = tables.findIndex((t) => t.model === 'invoiceItem');
      const invoiceIdx = tables.findIndex((t) => t.model === 'invoice');
      const contactIdx = tables.findIndex((t) => t.model === 'contact');

      expect(invoiceItemIdx).toBeLessThan(invoiceIdx);
      expect(invoiceIdx).toBeLessThan(contactIdx);

      // Contact referenced by Invoice:
      const contact = await prisma.contact.create({
        data: {
          customerId: tenantAId,
          firstName: 'Contact',
          lastName: 'Invoice' + Date.now(),
        },
      });

      const invoice = await prisma.invoice.create({
        data: {
          customerId: tenantAId,
          contactId: contact.id,
          invoiceNo: 'INV-' + Date.now(),
          issueDate: new Date(),
          dueDate: new Date(),
          subTotal: 100,
          taxAmount: 18,
          totalAmount: 118,
        },
      });

      // When only customers selected: dependency warning is generated
      const previewCustomersOnly = await service.previewReset(tenantAId, { modules: ['customers'] });
      const invoiceWarning = previewCustomersOnly.dependencyWarnings.find((w) => w.model === 'invoice');
      expect(invoiceWarning).toBeDefined();

      // When both billing and customers selected: invoice deleted first, contact deleted afterward
      const previewBoth = await service.previewReset(tenantAId, { modules: ['billing', 'customers'] });
      const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
        modules: ['billing', 'customers'],
        previewToken: previewBoth.previewToken,
        confirmation: 'RESET',
        idempotencyKey: `test-10-${Date.now()}`,
      });

      expect(result.status).toBe('SUCCESS');
      expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
      expect(await prisma.contact.findUnique({ where: { id: contact.id } })).toBeNull();
    });
  });
});
