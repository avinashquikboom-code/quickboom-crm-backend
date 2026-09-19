import { Test, TestingModule } from '@nestjs/testing';
import { EmailTemplateService } from './email-template.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmailTemplateService', () => {
  let service: EmailTemplateService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      emailTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EmailTemplateService>(EmailTemplateService);
  });

  describe('interpolate', () => {
    it('should correctly interpolate placeholders', () => {
      const template = 'Hello {{userName}}, your OTP is {{otp}} for {{companyName}}.';
      const variables = {
        userName: 'Priya',
        otp: '951234',
        companyName: 'QuickBoom',
      };
      const result = service.interpolate(template, variables);
      expect(result).toBe('Hello Priya, your OTP is 951234 for QuickBoom.');
    });

    it('should keep untouched unmatched placeholders', () => {
      const template = 'Hello {{userName}}, code: {{code}}';
      const result = service.interpolate(template, { userName: 'Amit' });
      expect(result).toBe('Hello Amit, code: {{code}}');
    });
  });

  describe('findByKey', () => {
    it('should return hardcoded system fallback if DB returns null', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);
      const res = await service.findByKey('EMAIL_OTP', 1);
      expect(res).toBeDefined();
      expect(res?.key).toBe('EMAIL_OTP');
      expect(res?.subject).toContain('{{companyName}}');
      expect(res?.body).toContain('{{otp}}');
    });

    it('should return customer-specific template if found in DB', async () => {
      const mockCustom = {
        id: 10,
        customerId: 1,
        key: 'EMAIL_OTP',
        subject: 'Custom OTP',
        body: 'OTP: {{otp}}',
        isActive: true,
      };
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockCustom);
      const res = await service.findByKey('EMAIL_OTP', 1);
      expect(res).toEqual(mockCustom);
    });
  });

  describe('preview', () => {
    it('should interpolate sample values for preview', () => {
      const preview = service.preview({
        subject: 'Welcome to {{companyName}}',
        body: 'Hi {{userName}}, your code is {{otp}}',
      });
      expect(preview.subject).toBe('Welcome to QuickBoom Technologies');
      expect(preview.body).toContain('Hi John Doe, your code is 682941');
    });
  });
});
