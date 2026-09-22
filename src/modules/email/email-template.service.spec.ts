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
      expect(res).toEqual(expect.objectContaining(mockCustom));
      expect(res?.identifierKey).toBe('EMAIL_OTP');
    });

    it('should retrieve QUIKBOOM templates by identifierKey from predefined fallback', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);
      const res = await service.findByKey('QUIKBOOM_NEW_LEAD');
      expect(res).toBeDefined();
      expect(res?.key).toBe('QUIKBOOM_NEW_LEAD');
      expect(res?.identifierKey).toBe('QUIKBOOM_NEW_LEAD');
      expect(res?.subject).toBe('Thank You for Connecting with QUIKBOOM');
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

    it('should preview QUIKBOOM CRM templates with exact sample data and no raw placeholders', () => {
      const preview = service.preview({
        subject: 'Your Meeting with QUIKBOOM is Scheduled',
        body: `Dear {{leadTitle}},
Meeting Details:
Date: {{startDate}}
Time: {{startTime}}
Regards,
{{userName}}
QUIKBOOM Digital Marketing Agency`,
      });

      expect(preview.subject).toBe('Your Meeting with QUIKBOOM is Scheduled');
      expect(preview.body).toContain('Dear Mr. Raj Sharma');
      expect(preview.body).toContain('Date: 25 September 2026');
      expect(preview.body).toContain('Time: 11:30 AM');
      expect(preview.body).toContain('Regards,\nAvinash');
      expect(preview.body).not.toContain('{{');
      expect(preview.body).not.toContain('}}');
      expect(preview.to).toBe('sales@quikboom.com');
    });
  });

  describe('renderEmailTemplate (Centralized Variable Engine)', () => {
    it('should replace single variable correctly', () => {
      const res = service.renderEmailTemplate(
        { subject: 'Hello', body: 'Dear {{leadTitle}}' },
        { leadTitle: 'Mr. Sharma' },
      );
      expect(res.body).toBe('Dear Mr. Sharma');
    });

    it('should correctly replace multiple variables: leadTitle, userName, email, startDate, startTime', () => {
      const template = {
        subject: 'Meeting for {{leadTitle}} with {{userName}}',
        body: 'Lead: {{leadTitle}}, Host: {{userName}}, Email: {{email}}, Date: {{startDate}}, Time: {{startTime}}',
      };
      const variables = {
        leadTitle: 'Sunrise Corp',
        userName: 'Avinash',
        email: 'sales@quikboom.com',
        startDate: '25 September 2026',
        startTime: '11:30 AM',
      };
      const res = service.renderEmailTemplate(template, variables);
      expect(res.subject).toBe('Meeting for Sunrise Corp with Avinash');
      expect(res.body).toBe(
        'Lead: Sunrise Corp, Host: Avinash, Email: sales@quikboom.com, Date: 25 September 2026, Time: 11:30 AM',
      );
      expect(res.missingVariables).toEqual([]);
    });

    it('should never send raw placeholders to customers when variables are missing', () => {
      const template = {
        subject: 'Inquiry from {{leadTitle}}',
        body: 'Hello {{leadTitle}}, date: {{startDate}}, custom: {{unsupportedVar}}',
      };
      const res = service.renderEmailTemplate(template, {});
      expect(res.subject).not.toContain('{{');
      expect(res.body).not.toContain('{{');
      expect(res.body).not.toContain('}}');
      expect(res.missingVariables).toContain('leadTitle');
      expect(res.missingVariables).toContain('startDate');
    });

    it('should inject dynamic primary color and absolute HTTPS logo into rendered email template', () => {
      const template = {
        subject: 'Welcome',
        body: '<p>Click <a href="#" style="background-color: {{primaryColor}}">CTA</a></p><img src="cid:quikboom-logo" />',
      };
      const res = service.renderEmailTemplate(template, {
        primaryColor: '#16A34A',
        logoUrl: 'https://admin.qbapp.online/logo.png',
      });
      expect(res.body).toContain('background-color: #16A34A');
      expect(res.body).toContain('src="https://admin.qbapp.online/logo.png"');
      expect(res.body).not.toContain('cid:quikboom-logo');
    });
  });

  describe('wrapInQuikboomEmailHtml (Dynamic Primary Color, Public HTTPS Logo & Responsive Design)', () => {
    it('should dynamically render the configured primary color into inline header and button styles with responsive layout', () => {
      const customPrimaryColor = '#7C3AED';
      const html = service.wrapInQuikboomEmailHtml('Welcome to our service.\n\nVisit QUIKBOOM Website', {
        primaryColor: customPrimaryColor,
        logoSrc: 'https://admin.qbapp.online/logo.png',
        companyName: 'Madhuban Hotel',
      });

      // Header background must use email-safe inline style with primary color
      expect(html).toContain(`style="background-color: ${customPrimaryColor}; background: ${customPrimaryColor}; padding: 32px 24px; text-align: center; color: #ffffff;"`);
      // Button must use email-safe inline style with primary color
      expect(html).toContain(`background-color: ${customPrimaryColor}`);
      // Logo must be absolute public HTTPS URL with 200px width and email-logo class
      expect(html).toContain('src="https://admin.qbapp.online/logo.png"');
      expect(html).toContain('width="200"');
      expect(html).toContain('class="email-logo"');
      // Must NOT contain the old squishing max-height
      expect(html).not.toContain('max-height: 48px');
      expect(html).not.toContain('max-height: 52px');
      // Must contain responsive meta and media queries
      expect(html).toContain('@media only screen and (max-width: 600px)');
      expect(html).toContain('.email-logo { width: 160px !important;');
      // Must contain client company name
      expect(html).toContain('Madhuban Hotel');
      // No CSS variables or broken CIDs
      expect(html).not.toContain('var(--');
      expect(html).not.toContain('hsl(');
      expect(html).not.toContain('cid:quikboom-logo');
      expect(html).not.toContain('linear-gradient(135deg, #0f172a, #1e293b)');
    });

    it('should use default primary color (#16A34A) and public HTTPS logo when options are omitted', () => {
      const html = service.wrapInQuikboomEmailHtml('Hello World');

      expect(html).toContain('style="background-color: #16A34A; background: #16A34A;');
      expect(html).toContain('src="https://admin.qbapp.online/logo.png"');
      expect(html).toContain('width="200"');
      expect(html).not.toContain('cid:quikboom-logo');
      expect(html).not.toContain('#0f172a');
    });
  });
});
