import { Test, TestingModule } from '@nestjs/testing';
import { MetaTemplateController } from './meta-template.controller';
import { MetaTemplateService } from './meta-template.service';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMetaTemplateDto, CreateMetaTemplateDto, TestSendMetaTemplateDto } from './dto/meta-template.dto';

describe('MetaTemplateController & DTO Validation', () => {
  let controller: MetaTemplateController;
  let service: MetaTemplateService;

  const mockMetaTemplateService = {
    findAll: jest.fn().mockImplementation((customerId, query) => {
      return Promise.resolve({
        items: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
        stats: { total: 0, active: 0, approved: 0, pending: 0, rejected: 0 },
      });
    }),
    getStats: jest.fn().mockImplementation((customerId) => {
      return Promise.resolve({
        success: true,
        data: { total: 0, active: 0, approved: 0, pending: 0, rejected: 0, inactive: 0 },
        total: 0,
        active: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        inactive: 0,
      });
    }),
    create: jest.fn().mockImplementation((dto, customerId) => {
      return Promise.resolve({
        id: 1,
        ...dto,
        customerId,
      });
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetaTemplateController],
      providers: [
        {
          provide: MetaTemplateService,
          useValue: mockMetaTemplateService,
        },
      ],
    }).compile();

    controller = module.get<MetaTemplateController>(MetaTemplateController);
    service = module.get<MetaTemplateService>(MetaTemplateService);
  });

  describe('ValidationPipe with forbidNonWhitelisted', () => {
    it('successfully validates QueryMetaTemplateDto with canonical and alias parameters', async () => {
      const rawQuery = {
        metaStatus: 'APPROVED',
        isActive: 'true',
        search: 'lead',
        page: '1',
        limit: '50',
      };

      const dto = plainToInstance(QueryMetaTemplateDto, rawQuery);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.metaStatus).toBe('APPROVED');
      expect(dto.isActive).toBe('true');
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(50);
    });

    it('safely handles undefined/null strings without failing validation or throwing 400', async () => {
      const rawQuery = {
        page: 'undefined',
        limit: 'undefined',
        status: 'undefined',
        category: 'undefined',
        search: 'undefined',
      };

      const dto = plainToInstance(QueryMetaTemplateDto, rawQuery);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.page).toBeUndefined();
      expect(dto.limit).toBeUndefined();
      expect(dto.status).toBeUndefined();
      expect(dto.category).toBeUndefined();
      expect(dto.search).toBeUndefined();
    });

    it('whitelists type, channel, provider, offset, and sort parameters', async () => {
      const rawQuery = {
        type: 'meta',
        channel: 'whatsapp',
        provider: 'meta',
        offset: '0',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      const dto = plainToInstance(QueryMetaTemplateDto, rawQuery);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.type).toBe('meta');
      expect(dto.channel).toBe('whatsapp');
      expect(dto.provider).toBe('meta');
      expect(dto.offset).toBe(0);
      expect(dto.sortBy).toBe('createdAt');
      expect(dto.sortOrder).toBe('desc');
    });

    it('safely handles boolean isLocalActive and isActive values', async () => {
      const rawQuery = {
        isLocalActive: true as any,
        isActive: false as any,
      };

      const dto = plainToInstance(QueryMetaTemplateDto, rawQuery);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.isLocalActive).toBe('true');
      expect(dto.isActive).toBe('false');
    });

    it('successfully validates CreateMetaTemplateDto with canonical backend contract', async () => {
      const rawBody = {
        name: 'Test Lead Template',
        templateName: 'test_lead_tpl',
        body: 'Hello {{leadName}}, thanks for contacting us.',
        footer: 'Reply STOP to unsub',
        category: 'UTILITY',
        language: 'en_US',
        headerType: 'NONE',
        isLocalActive: true,
      };

      const dto = plainToInstance(CreateMetaTemplateDto, rawBody);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.name).toBe('Test Lead Template');
      expect(dto.body).toContain('Hello {{leadName}}');
      expect(dto.footer).toBe('Reply STOP to unsub');
      expect(dto.isLocalActive).toBe(true);
    });

    it('strictly rejects non-whitelisted UI-only properties (displayName, bodyText, footerText, isActive)', async () => {
      const rawBody = {
        name: 'Test Lead Template',
        body: 'Hello {{leadName}}, thanks for contacting us.',
        displayName: 'Test Lead Template',
        bodyText: 'Hello {{leadName}}, thanks for contacting us.',
        footerText: 'Reply STOP to unsub',
        isActive: true,
      };

      const dto = plainToInstance(CreateMetaTemplateDto, rawBody);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
      const propertyErrors = errors.map((e) => e.property);
      expect(propertyErrors).toContain('displayName');
      expect(propertyErrors).toContain('bodyText');
      expect(propertyErrors).toContain('footerText');
      expect(propertyErrors).toContain('isActive');
    });

    it('successfully validates TestSendMetaTemplateDto with canonical fields and numeric templateId', async () => {
      const rawPayload = {
        templateId: 1,
        templateName: 'lead_stage_new',
        to: '+91 98200 10000',
        language: 'en_US',
        variables: { leadName: 'John Doe', companyName: 'Acme' },
      };
      const dto = plainToInstance(TestSendMetaTemplateDto, rawPayload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.templateId).toBe(1);
      expect(dto.to).toBe('+91 98200 10000');
    });

    it('transforms string templateId and trims to phone in TestSendMetaTemplateDto', async () => {
      const rawPayload = {
        templateId: '15',
        to: ' +91 98765 43210 ',
      };
      const dto = plainToInstance(TestSendMetaTemplateDto, rawPayload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.templateId).toBe(15);
      expect(dto.to).toBe('+91 98765 43210');
    });

    it('supports phoneNumber alias in TestSendMetaTemplateDto without failing validation', async () => {
      const rawPayload = {
        templateId: 15,
        phoneNumber: '+91 98765 43210',
      };
      const dto = plainToInstance(TestSendMetaTemplateDto, rawPayload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.phoneNumber).toBe('+91 98765 43210');
    });

    it('rejects TestSendMetaTemplateDto when recipient phone number is missing or empty', async () => {
      const rawPayload = {
        templateId: 1,
        to: '   ',
      };
      const dto = plainToInstance(TestSendMetaTemplateDto, rawPayload);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('to');
    });
  });

  describe('Controller Execution', () => {
    it('findAll returns 200 with empty list when no templates exist without throwing 400', async () => {
      const mockUser = { id: 1, customerId: 101 };
      const queryDto = new QueryMetaTemplateDto();
      queryDto.status = 'APPROVED';
      const mockReq = { method: 'GET', url: '/api/v1/templates/meta' };

      const result = await controller.findAll(mockUser, queryDto, mockReq);
      expect(result).toBeDefined();
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(service.findAll).toHaveBeenCalledWith(101, queryDto);
    });

    it('getStats operates independently and returns 200 with zero counts', async () => {
      const mockUser = { id: 1, customerId: 101 };
      const mockReq = { method: 'GET', url: '/api/v1/templates/meta/stats' };

      const result = await controller.getStats(mockUser, mockReq);
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(service.getStats).toHaveBeenCalledWith(101);
    });
  });
});
