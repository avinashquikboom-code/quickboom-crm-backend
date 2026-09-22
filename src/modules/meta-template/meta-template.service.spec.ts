import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MetaTemplateService } from './meta-template.service';

describe('MetaTemplateService', () => {
  let service: MetaTemplateService;
  let mockPrisma: any;
  let mockIntegrationSettingsService: any;

  beforeEach(() => {
    mockPrisma = {
      metaTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        update: jest.fn(),
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

    service = new MetaTemplateService(mockPrisma, mockIntegrationSettingsService);
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

  describe('getVariables', () => {
    it('returns CRM variables registry', () => {
      const vars = service.getVariables();
      expect(vars.length).toBeGreaterThan(5);
      expect(vars.some((v) => v.key === 'leadName')).toBe(true);
      expect(vars.some((v) => v.key === 'companyName')).toBe(true);
    });
  });
});
