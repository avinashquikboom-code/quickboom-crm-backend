import { Test, TestingModule } from '@nestjs/testing';
import { MetaTemplateController } from './meta-template.controller';
import { MetaTemplateService } from './meta-template.service';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMetaTemplateDto, CreateMetaTemplateDto } from './dto/meta-template.dto';

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

    it('successfully validates CreateMetaTemplateDto with frontend payload (displayName, bodyText, etc.)', async () => {
      const rawBody = {
        name: 'test_lead_tpl',
        displayName: 'Test Lead Template',
        bodyText: 'Hello {{leadName}}, thanks for contacting us.',
        footerText: 'Reply STOP to unsub',
        category: 'UTILITY',
        language: 'en_US',
        headerType: 'NONE',
        isActive: true,
      };

      const dto = plainToInstance(CreateMetaTemplateDto, rawBody);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
      expect(dto.displayName).toBe('Test Lead Template');
      expect(dto.bodyText).toContain('Hello {{leadName}}');
      expect(dto.footerText).toBe('Reply STOP to unsub');
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
