import { BadRequestException, NotFoundException } from '@nestjs/common';
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
          body: 'Hi {{leadName}}, your visit with {{companyName}} is confirmed for {{startDate}}.',
          category: 'UTILITY',
        },
        1,
      );

      expect(res.id).toBe(10);
      expect(res.templateName).toBe('visit_scheduled_notice');
      expect(res.variables).toEqual(expect.arrayContaining(['leadName', 'companyName', 'startDate']));
      expect(res.isLocalActive).toBe(true);
      expect(res.syncStatus).toBe('SYNCED');
      jest.restoreAllMocks();
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

  describe('remove (delete protection)', () => {
    it('prevents deletion if template is currently used by an active lead stage', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue({
        id: 3,
        name: 'Contacted Template',
        key: 'CONTACTED',
        isLocalActive: true,
      });

      mockPrisma.leadStage.findFirst.mockResolvedValue({
        id: 2,
        name: 'Contacted',
        key: 'CONTACTED',
        isActive: true,
      });

      await expect(service.remove(3, 1)).rejects.toThrow(
        /This template is currently in use for pipeline stage "Contacted" and cannot be deleted/,
      );
    });

    it('soft deletes template when not actively referenced by a stage', async () => {
      mockPrisma.metaTemplate.findFirst.mockResolvedValue({
        id: 4,
        name: 'Obsolete Template',
        key: 'OBSOLETE',
        isLocalActive: false,
      });
      mockPrisma.leadStage.findFirst.mockResolvedValue(null);
      mockPrisma.metaTemplate.update.mockResolvedValue({ id: 4, deletedAt: new Date() });

      const res = await service.remove(4, 1);
      expect(res.success).toBe(true);
      expect(mockPrisma.metaTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 4 },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
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
