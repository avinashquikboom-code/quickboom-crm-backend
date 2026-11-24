import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { MetaTemplateService } from './meta-template.service';

describe('MetaTemplateService', () => {
  let service: MetaTemplateService;
  let mockPrisma: any;
  let mockIntegrationSettingsService: any;
  let mockWhatsappService: any;

  beforeEach(() => {
    mockPrisma = {
      metaTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      leadStage: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockIntegrationSettingsService = {
      getIntegrationConfig: jest.fn().mockResolvedValue({
        isEnabled: true,
        credentials: {
          accessToken: 'EAABsampletoken12345',
          phoneNumberId: '1092837465',
          businessAccountId: '987654321',
        },
      }),
    };

    mockWhatsappService = {
      normalizePhoneNumber: jest.fn((phone) => {
        if (!phone) return null;
        const clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) return `91${clean}`;
        if (clean.length === 12) return clean;
        return clean.length >= 10 ? clean : null;
      }),
      maskPhone: jest.fn((phone) => '****1234'),
      sendTemplate: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.HBgLMTIzNDU2Nzg5MA==',
        provider: 'WHATSAPP',
      }),
    };

    service = new MetaTemplateService(mockPrisma, mockIntegrationSettingsService, mockWhatsappService);
  });

  describe('findAll', () => {
    it('returns filtered items and summary statistics', async () => {
      mockPrisma.metaTemplate.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Contacted Stage Notice',
          templateName: 'lead_stage_contacted',
          status: 'APPROVED',
          isLocalActive: true,
          category: 'UTILITY',
        },
      ]);
      mockPrisma.metaTemplate.count.mockResolvedValue(1);

      const result = await service.findAll(1, { search: 'Contacted' });

      expect(result.items.length).toBe(1);
      expect(result.items[0].templateName).toBe('lead_stage_contacted');
      expect(result.stats).toBeDefined();
      expect(result.meta.total).toBe(1);
    });

    it('does not reseed defaults when only archived templates remain', async () => {
      mockPrisma.metaTemplate.count.mockResolvedValue(1);
      await service.ensureDefaultTemplates(1);
      expect(mockPrisma.metaTemplate.count).toHaveBeenCalledWith({ where: {} });
      expect(mockPrisma.metaTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('formats template name and extracts variables from body', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.metaTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 10, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [] } } as any);
      jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { id: 'meta-10', status: 'PENDING' } } as any);

      const res = await service.create(
        {
          name: 'Visit Confirmation',
          templateName: 'Visit Scheduled Notice',
          body: 'Hi {{1}}, your visit with {{2}} is confirmed for {{3}}.',
          sampleValues: { '1': 'Rahul', '2': 'Acme', '3': 'Tomorrow' },
          category: 'UTILITY',
        },
        1,
      );

      expect(res.id).toBe(10);
      expect(res.templateName).toBe('visit_scheduled_notice');
      expect(res.variables).toEqual(expect.arrayContaining(['1', '2', '3']));
      expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ components: expect.arrayContaining([expect.objectContaining({ type: 'BODY', example: { body_text: [['Rahul', 'Acme', 'Tomorrow']] } })]) }), expect.any(Object));
      expect((axios.post as jest.Mock).mock.calls[0][1]).not.toHaveProperty('submitToMeta');
      expect(res.isLocalActive).toBe(true);
      expect(res.syncStatus).toBe('SYNCED');
      jest.restoreAllMocks();
    });

    it('sends four positional examples, header example and provider-only button fields', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.metaTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 11, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [] } } as any);
      const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { id: 'meta-11', status: 'PENDING' } } as any);
      await service.create({ name: 'Notice', templateName: 'notice', headerType: 'TEXT', headerContent: 'Dear {{1}}', body: 'Hello {{1}} {{2}} {{3}} {{4}}', sampleValues: { '1': 'A', '2': 'B', '3': 'C', '4': 'D' }, buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+919876543210', internal: 'ignored' }] }, 1);
      const payload = post.mock.calls[0][1] as any;
      expect(payload.components).toEqual(expect.arrayContaining([
        { type: 'HEADER', format: 'TEXT', text: 'Dear {{1}}', example: { header_text: ['A'] } },
        { type: 'BODY', text: 'Hello {{1}} {{2}} {{3}} {{4}}', example: { body_text: [['A', 'B', 'C', 'D']] } },
        { type: 'BUTTONS', buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '+919876543210' }] },
      ]));
      jest.restoreAllMocks();
    });

    it('does not invent a status when Meta omits it', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.metaTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 10, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [] } } as any);
      jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { id: 'meta-10' } } as any);
      const result = await service.create({ name: 'Welcome', templateName: 'welcome', body: 'Hello' }, 1);
      expect(result.status).toBe('UNKNOWN');
      jest.restoreAllMocks();
    });

    it('does not trust client supplied approval status or Meta ID for a draft', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.metaTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 12, ...data }));
      const result = await service.create({ name: 'Welcome', templateName: 'welcome', body: 'Hello', submitToMeta: false, status: 'APPROVED', metaTemplateId: 'fake' }, 1);
      expect(result.status).toBe('NOT_SYNCED');
      expect(result.metaTemplateId).toBeNull();
    });

    it('rejects gaps in positional variables', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      await expect(service.create({ name: 'Welcome', templateName: 'welcome', body: 'Hello {{1}} {{3}}', submitToMeta: false }, 1)).rejects.toThrow(/consecutive/);
    });

    it('requires examples for positional variables before sending to Meta', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(null);
      await expect(service.create({ name: 'Welcome', templateName: 'welcome', body: 'Hello {{1}}' }, 1)).rejects.toThrow(/sample value/);
    });

    it('rejects duplicate template name and language', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue({ id: 5, templateName: 'lead_welcome' });

      await expect(
        service.create(
          {
            name: 'Welcome',
            templateName: 'lead_welcome',
            body: 'Hello',
          },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    const synced = {
      id: 32, customerId: 1, name: 'Welcome', templateName: 'welcome_lead', key: 'WELCOME',
      language: 'en_US', category: 'UTILITY', status: 'APPROVED', metaTemplateId: 'meta-32',
      headerType: 'NONE', headerContent: null, body: 'Hello {{leadName}}', footer: null,
      buttons: [], variables: ['leadName'], isLocalActive: true, syncStatus: 'SYNCED',
    };

    it('requires a new Meta name or language for a submitted template content revision', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(synced);
      await expect(service.update(32, { body: 'Hi {{leadName}}' } as any, 1))
        .rejects.toThrow(/Choose a new Meta template name or language/);
      expect(mockPrisma.metaTemplate.update).not.toHaveBeenCalled();
    });

    it('saves revised content as not synced and clears the old Meta ID', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(synced);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...synced, ...data }));
      const result = await service.update(32, { templateName: 'welcome_lead_v2', body: 'Hi {{leadName}}' } as any, 1);
      expect(mockPrisma.metaTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'NOT_SYNCED', metaTemplateId: null, syncStatus: 'NOT_SYNCED', body: 'Hi {{leadName}}' }),
      }));
      expect(result.metaTemplateId).toBeNull();
      expect(result.body).toBe('Hi {{leadName}}');
    });
  });

  describe('Meta synchronization', () => {
    const localTemplate = {
      id: 24, customerId: 1, name: 'Welcome', templateName: 'welcome_lead', key: 'NEW',
      language: 'en_US', category: 'UTILITY', status: 'NOT_SYNCED', metaTemplateId: null,
      body: 'Hello {{leadName}}', headerType: 'NONE', headerContent: null, footer: null,
      buttons: null, variables: ['leadName'], isLocalActive: true, syncStatus: 'NOT_SYNCED',
    };

    it.each(['APPROVED', 'PENDING', 'REJECTED'])('persists the actual Meta %s status and rejection reason', async (status) => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(localTemplate);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...localTemplate, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [{ id: 'meta-24', name: 'welcome_lead', language: 'en_US', category: 'UTILITY', status, rejected_reason: status === 'REJECTED' ? 'Policy violation' : undefined }] } } as any);

      const result = await service.syncOne(24, 1);
      expect(result.status).toBe(status);
      expect(result.syncStatus).toBe('SYNCED');
      expect(result.metaTemplateId).toBe('meta-24');
      expect(result.lastSyncedAt).toEqual(expect.any(Date));
      expect(result.rejectionReason).toBe(status === 'REJECTED' ? 'Policy violation' : null);
      expect(mockPrisma.metaTemplate.update).toHaveBeenLastCalledWith(expect.objectContaining({
        where: { id: 24 }, data: expect.not.objectContaining({ body: expect.anything(), key: expect.anything(), variables: expect.anything() }),
      }));
      jest.restoreAllMocks();
    });

    it('keeps approval status and reports Not Synced when Meta does not contain the local template', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(localTemplate);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...localTemplate, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [] } } as any);

      const result = await service.syncOne(24, 1);
      expect(result.syncStatus).toBe('NOT_SYNCED');
      expect(result.status).toBe('NOT_SYNCED');
      expect(result.lastSyncedAt).toBeUndefined();
      jest.restoreAllMocks();
    });

    it('stores a sanitized Sync Failed error when Meta rejects the token', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(localTemplate);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...localTemplate, ...data }));
      jest.spyOn(axios, 'get').mockRejectedValueOnce({ response: { status: 401, data: { error: { code: 190, message: 'Invalid OAuth access token' } } } });

      await expect(service.syncOne(24, 1)).rejects.toThrow(/Meta rejected the access token/);
      expect(mockPrisma.metaTemplate.update).toHaveBeenLastCalledWith(expect.objectContaining({
        where: { id: 24 }, data: expect.objectContaining({ syncStatus: 'SYNC_FAILED', syncError: expect.stringContaining('Meta rejected the access token') }),
      }));
      jest.restoreAllMocks();
    });

    it('links an existing remote template rather than posting a duplicate', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(localTemplate);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...localTemplate, ...data }));
      const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [{ id: 'meta-24', name: 'welcome_lead', language: 'en_US', category: 'UTILITY', status: 'APPROVED' }] } } as any);
      const post = jest.spyOn(axios, 'post');

      const result = await service.submitOne(24, 1);
      expect(result.alreadyExists).toBe(true);
      expect(post).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    });

    it('syncs the complete WABA catalog without creating duplicates', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(localTemplate);
      mockPrisma.metaTemplate.findMany.mockResolvedValue([]);
      mockPrisma.metaTemplate.update.mockImplementation(({ data }) => Promise.resolve({ ...localTemplate, ...data }));
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [
        { id: 'meta-24', name: 'welcome_lead', language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [] },
      ] } } as any);

      const result = await service.syncFromMeta(1);
      expect(result.fetched).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.wabaId).toBe('987654321');
      expect(mockPrisma.metaTemplate.create).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });
  });

  describe('remove (two-system Meta + local deletion)', () => {
    const admin = { id: 7, customerId: 1, role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'], firstName: 'Ava', lastName: 'Admin' };
    const tenantAdmin = { id: 8, customerId: 1, role: 'TENANT_ADMIN', roles: ['TENANT_ADMIN'] };
    const otherTenantAdmin = { id: 9, customerId: 2, role: 'TENANT_ADMIN', roles: ['TENANT_ADMIN'] };
    const employee = { id: 10, customerId: 1, role: 'SALES_EXECUTIVE', roles: ['SALES_EXECUTIVE'] };

    const baseTemplate = {
      id: 40, customerId: 1, name: 'Welcome Lead', templateName: 'welcome_lead', key: 'WELCOME',
      language: 'en_US', category: 'UTILITY', status: 'APPROVED', metaTemplateId: '888160003829980',
      syncedWabaId: '987654321', body: 'Hello {{leadName}}', variables: ['leadName'], isLocalActive: true,
      isSystem: false, deletedAt: null, deletionState: 'NONE', deletionError: null, syncStatus: 'SYNCED',
    };

    let record: any;
    let tx: any;

    beforeEach(() => {
      record = { ...baseTemplate };
      mockPrisma.metaTemplate.findFirst.mockImplementation(({ where }: any) => {
        const allowed = where.OR
          ? where.OR.some((cond: any) =>
              cond.customerId === null || (record.customerId != null && cond.customerId === record.customerId))
          : where.customerId === record.customerId;
        return Promise.resolve(where.id === record.id && allowed ? record : null);
      });
      mockPrisma.metaTemplate.update.mockImplementation(({ data }: any) => {
        record = { ...record, ...data };
        return Promise.resolve(record);
      });
      mockPrisma.leadStage.findMany.mockResolvedValue([]);
      mockPrisma.leadStage.findMany.mockClear();
      mockPrisma.leadStage.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.whatsAppCampaign = { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
      mockPrisma.leadStageWhatsAppDelivery = { count: jest.fn().mockResolvedValue(3) };
      mockPrisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
      tx = {
        leadStage: { findMany: jest.fn().mockImplementation((args?: any) => mockPrisma.leadStage.findMany(args)), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        whatsAppCampaign: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        metaTemplate: { update: jest.fn().mockImplementation(({ data }: any) => { record = { ...record, ...data }; return Promise.resolve(record); }) },
      };
      mockPrisma.$transaction = jest.fn(async (work: any) => work(tx));
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [{ id: '888160003829980', name: 'welcome_lead', language: 'en_US', status: 'APPROVED' }] } } as any);
    });

    afterEach(() => jest.restoreAllMocks());

    it('deletes an approved template from Meta, then archives the local record and preserves delivery history', async () => {
      const del = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);

      const res = await service.remove(40, admin, { reason: 'Cleanup' });

      expect(del).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/987654321/message_templates',
        expect.objectContaining({
          headers: { Authorization: 'Bearer EAABsampletoken12345' },
          params: { hsm_id: '888160003829980', name: 'welcome_lead' },
          timeout: 20000,
        }),
      );
      expect(record.deletedAt).toEqual(expect.any(Date));
      expect(record.deletionState).toBe('LOCAL_DELETED');
      expect(record.deletedByName).toBe('Ava Admin');
      expect(record.isLocalActive).toBe(false);
      expect(res).toMatchObject({ success: true, message: expect.stringContaining('Template deleted successfully') });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'DELETE', entityId: '40', status: 'SUCCESS',
          details: expect.objectContaining({ deliveryRecordsPreserved: 3, metaResult: 'DELETED', deletedBy: 'Ava Admin' }),
        }),
      }));
      expect(tx.metaTemplate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    });

    it('deletes a rejected template the same way', async () => {
      record.status = 'REJECTED';
      record.rejectionReason = 'Policy';
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
      expect(record.deletedAt).toBeTruthy();
    });

    it('deletes a not-synced template locally without calling Meta', async () => {
      record.metaTemplateId = null;
      record.syncedWabaId = null;
      record.syncStatus = 'NOT_SYNCED';
      const del = jest.spyOn(axios, 'delete');
      const res = await service.remove(40, tenantAdmin);
      expect(del).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
      expect(res.metaResult).toBe('NOT_REQUIRED');
      expect(record.deletedAt).toBeTruthy();
      expect(record.deletionState).toBe('LOCAL_DELETED');
    });

    it('cleans up locally when Meta reports the template is already absent from the WABA', async () => {
      jest.spyOn(axios, 'delete').mockRejectedValue({ response: { status: 400, data: { error: { code: 100, message: '(#100) Object does not exist' } } } } as any);
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } } as any);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
      expect(record.deletedAt).toBeTruthy();
      expect(record.deletionState).toBe('LOCAL_DELETED');
    });

    it('retries Meta invalid-parameter deletion with the remote template ID only', async () => {
      const del = jest.spyOn(axios, 'delete')
        .mockRejectedValueOnce({ response: { status: 400, data: { error: { code: 100, message: 'Invalid parameter' } } } } as any)
        .mockResolvedValueOnce({ data: { success: true } } as any);
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [
        { id: 'remote-template-40', name: 'welcome_lead', language: 'en_US', status: 'APPROVED' },
      ] } } as any);

      const result = await service.remove(40, admin);

      expect(result.success).toBe(true);
      expect(del).toHaveBeenNthCalledWith(2,
        'https://graph.facebook.com/v21.0/987654321/message_templates',
        expect.objectContaining({ params: { hsm_id: 'remote-template-40', name: 'welcome_lead' } }),
      );
      expect(record.deletedAt).toBeTruthy();
    });

    it('does not treat Meta Invalid parameter as proof the template is absent', async () => {
      jest.spyOn(axios, 'delete').mockRejectedValue({
        response: { status: 400, data: { error: { code: 100, message: 'Invalid parameter' } } },
      } as any);
      jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [
        { id: 'remote-template-40', name: 'welcome_lead', language: 'en_US', status: 'APPROVED' },
      ] } } as any);

      await expect(service.remove(40, admin)).rejects.toThrow(/Template is still present in WABA 987654321/);
      expect(record.deletedAt).toBeNull();
      expect(record.deletionState).toBe('NONE');
    });

    it('refuses deletion when the connected WABA differs from the synced WABA', async () => {
      mockIntegrationSettingsService.getIntegrationConfig.mockResolvedValueOnce({
        isEnabled: true,
        credentials: { accessToken: 'EAABsampletoken12345', businessAccountId: '111222333' },
      });
      const del = jest.spyOn(axios, 'delete');
      await expect(service.remove(40, admin)).rejects.toThrow(/connected WABA is 111222333/);
      expect(del).not.toHaveBeenCalled();
      expect(record.deletedAt).toBeNull();
    });

    it('preserves the local record and surfaces the Meta permission error', async () => {
      jest.spyOn(axios, 'delete').mockRejectedValue({ response: { status: 403, data: { error: { code: 200, message: '(#200) Permissions error' } } } } as any);
      await expect(service.remove(40, admin)).rejects.toThrow(/Meta deletion failed; the local template was preserved/);
      expect(record.deletedAt).toBeNull();
      expect(record.deletionState).toBe('NONE');
    });

    it('verifies Meta after a network timeout and only cleans up when the template is gone', async () => {
      jest.spyOn(axios, 'delete').mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' } as any);
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } } as any);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
      expect(record.deletedAt).toBeTruthy();
    });

    it('does not assume success on timeout when Meta still lists the template', async () => {
      jest.spyOn(axios, 'delete').mockRejectedValue({ code: 'ETIMEDOUT' } as any);
      await expect(service.remove(40, admin)).rejects.toThrow(/did not confirm the deletion/);
      expect(record.deletedAt).toBeNull();
    });

    it('keeps a deletion-pending state when local cleanup fails after Meta deletion, and retries safely', async () => {
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('deadlock detected'));
      const first = await service.remove(40, admin);
      expect(first).toMatchObject({ success: false, deletionPending: true });
      expect(record.deletedAt).toBeNull();
      expect(record.deletionState).toBe('PENDING');
      expect(record.deletionError).toContain('deadlock detected');

      const del = jest.spyOn(axios, 'delete');
      del.mockClear();
      const second = await service.remove(40, admin);
      expect(second.success).toBe(true);
      expect(del).not.toHaveBeenCalled();
      expect(record.deletedAt).toBeTruthy();
      expect(record.deletionState).toBe('LOCAL_DELETED');
    });

    it('blocks deletion when an active lead stage is mapped to the template', async () => {
      const del = jest.spyOn(axios, 'delete');
      mockPrisma.leadStage.findMany
        .mockResolvedValueOnce([{ id: 5, name: 'Contacted', key: 'CONTACTED', isActive: true, whatsappTemplateId: 40, whatsappEnabled: true }])
        .mockResolvedValueOnce([]);
      await expect(service.remove(40, admin)).rejects.toThrow(/Lead stage "Contacted" is actively mapped/);
      expect(del).not.toHaveBeenCalled();
      expect(record.deletedAt).toBeNull();
    });

    it('does not block deletion for an active stage that is not WhatsApp-enabled or mapped', async () => {
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      mockPrisma.leadStage.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 5, name: 'New', key: 'WELCOME', isActive: true, whatsappTemplateId: null, whatsappEnabled: false }]);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
      expect(record.deletedAt).toBeTruthy();
    });

    it('unmaps inactive or key-only stage references during cleanup', async () => {
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      mockPrisma.leadStage.findMany
        .mockResolvedValueOnce([{ id: 6, name: 'Old', key: 'OLD', isActive: false, whatsappTemplateId: 40, whatsappEnabled: false }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 6 }]);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
      expect(tx.leadStage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { whatsappTemplateId: null, whatsappEnabled: false },
      }));
      expect(record.deletedAt).toBeTruthy();
    });

    it('scopes the lookup to the caller tenant so another tenant template is not found', async () => {
      const del = jest.spyOn(axios, 'delete');
      await expect(service.remove(40, otherTenantAdmin)).rejects.toThrow(NotFoundException);
      expect(del).not.toHaveBeenCalled();
    });

    it('does not call Meta for a template that was never submitted (seed placeholder)', async () => {
      record.metaTemplateId = 'seed_welcome_lead';
      const del = jest.spyOn(axios, 'delete');
      const res = await service.remove(40, admin);
      expect(del).not.toHaveBeenCalled();
      expect(res.metaResult).toBe('NOT_REQUIRED');
      expect(record.deletedAt).toBeTruthy();
    });

    it('prevents a tenant admin from deleting another tenant or a platform template', async () => {
      const del = jest.spyOn(axios, 'delete');
      // Other tenants' rows and platform rows are invisible to tenant admins (not found, no Meta call).
      await expect(service.remove(40, otherTenantAdmin)).rejects.toThrow(NotFoundException);
      record.customerId = null;
      await expect(service.remove(40, tenantAdmin)).rejects.toThrow(NotFoundException);
      expect(del).not.toHaveBeenCalled();
      expect(record.deletedAt).toBeNull();
    });

    it('allows a tenant admin to delete their own template', async () => {
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      const res = await service.remove(40, tenantAdmin);
      expect(res.success).toBe(true);
    });

    it('allows a super admin to delete a platform template', async () => {
      record.customerId = null;
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      const res = await service.remove(40, admin);
      expect(res.success).toBe(true);
    });

    it('reports references in the delete preview without changing anything', async () => {
      const del = jest.spyOn(axios, 'delete');
      mockPrisma.leadStage.findMany
        .mockResolvedValueOnce([{ id: 5, name: 'Contacted', key: 'CONTACTED', isActive: true, whatsappTemplateId: 40, whatsappEnabled: true }])
        .mockResolvedValueOnce([]);
      const preview = await service.previewDelete(40, admin);
      expect(preview).toMatchObject({
        id: 40, name: 'Welcome Lead', language: 'en_US', category: 'UTILITY', syncStatus: 'SYNCED',
        syncedToMeta: true, canDelete: false, whatsappCampaigns: 0, deliveryRecords: 3,
      });
      expect(preview.blockers[0]).toContain('Contacted');
      expect(preview.references.leadStages).toHaveLength(1);
      expect(del).not.toHaveBeenCalled();
      expect(record.deletedAt).toBeNull();
    });

    it('bulk deletes multiple eligible Meta templates with detailed report', async () => {
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      const res = await service.bulkRemove({ ids: [40, 40], reason: 'Bulk delete test' }, admin);
      expect(res.total).toBe(1); // deduplicated
      expect(res.deletedCount).toBe(1);
      expect(res.deletedIds).toEqual([40]);
      expect(res.failedCount).toBe(0);
    });

    it('handles partial failures gracefully in bulk delete', async () => {
      mockPrisma.metaTemplate.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === 40) return Promise.resolve(record);
        return Promise.resolve(null);
      });
      jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } } as any);
      const res = await service.bulkRemove({ ids: [40, 999] }, admin);
      expect(res.total).toBe(2);
      expect(res.deletedCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.failed[0].id).toBe(999);
    });
  });

  describe('preview', () => {
    it('interpolates sample variables accurately in body and header', async () => {
      const res = await service.preview({
        headerContent: 'Welcome {{companyName}}',
        body: 'Hello {{leadName}}, your agent is {{userName}}.',
      });

      expect(res.resolvedHeader).toContain('QUIKBOOM Digital Marketing Agency');
      expect(res.resolvedBody).toContain('Mr. Raj Sharma');
      expect(res.resolvedBody).toContain('Avinash');
    });
  });

  describe('getStats', () => {
    it('returns tenant-scoped statistics accurately', async () => {
      mockPrisma.metaTemplate.count
        .mockResolvedValueOnce(1)  // ensureDefaultTemplates count check
        .mockResolvedValueOnce(10) // totalAll
        .mockResolvedValueOnce(8)  // active
        .mockResolvedValueOnce(7)  // approved
        .mockResolvedValueOnce(2)  // pending
        .mockResolvedValueOnce(1); // rejected

      const stats = await service.getStats(1);

      expect(stats.total).toBe(10);
      expect(stats.active).toBe(8);
      expect(stats.approved).toBe(7);
      expect(stats.pending).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.inactive).toBe(2);
    });

    it('handles empty database safely with zero counts', async () => {
      mockPrisma.metaTemplate.count.mockResolvedValue(0);

      const stats = await service.getStats(null);

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.approved).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.inactive).toBe(0);
    });
  });

  describe('testSend', () => {
    const mockApprovedTemplate = {
      id: 10,
      customerId: 1,
      name: 'Appointment Notice',
      templateName: 'appointment_notice',
      language: 'en_US',
      status: 'APPROVED',
      isLocalActive: true,
      body: 'Hello {{1}}, your appointment is on {{2}}.',
      headerContent: null,
    };

    it('successfully dispatches a test WhatsApp template message and returns messageId', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue(mockApprovedTemplate);

      const result = await service.testSend(
        {
          templateId: 10,
          to: '+91 98200 10000',
          variables: { '1': 'Test Customer', '2': '25 Sep 2026' },
        },
        { id: 1, customerId: 1, firstName: 'Admin' },
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.HBgLMTIzNDU2Nzg5MA==');
      expect(result.status).toBe('SENT');
      expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
        '919820010000',
        'appointment_notice',
        [
          { type: 'text', text: 'Test Customer' },
          { type: 'text', text: '25 Sep 2026' },
        ],
        'en_US',
        undefined,
        'TEMPLATE_TEST',
        1,
        1,
        expect.objectContaining({
          templateId: '10',
          templateStatus: 'APPROVED',
          isApproved: true,
        }),
      );
    });

    it('rejects testing if template status is not APPROVED', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue({
        ...mockApprovedTemplate,
        status: 'PENDING',
      });

      await expect(
        service.testSend(
          {
            templateId: 10,
            to: '+91 98200 10000',
          },
          { id: 1, customerId: 1 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid recipient phone numbers', async () => {
      mockWhatsappService.normalizePhoneNumber.mockReturnValueOnce(null);

      await expect(
        service.testSend(
          {
            templateId: 10,
            to: 'invalid-number',
          },
          { id: 1, customerId: 1 },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
