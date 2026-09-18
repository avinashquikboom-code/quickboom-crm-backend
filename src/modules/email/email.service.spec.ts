import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer');

describe('EmailService', () => {
  let service: EmailService;
  let mockPrisma: any;
  let mockIntegrationSettings: any;
  let mockSendMail: jest.Mock;

  beforeEach(async () => {
    mockSendMail = jest.fn().mockResolvedValue({
      messageId: '<test-message-id@smtp.quickboom.com>',
      envelope: { from: 'support@quickboom.com', to: ['client@example.com'] },
    });

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
      verify: jest.fn().mockResolvedValue(true),
    });

    mockPrisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      communicationHistory: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    mockIntegrationSettings = {
      getSmtpConfig: jest.fn().mockResolvedValue({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        security: 'TLS',
        username: 'support@quickboom.com',
        password: 'secure-app-password',
        fromEmail: 'support@quickboom.com',
        fromName: 'QuickBoom Support',
        isEnabled: true,
        isConfigured: true,
        source: 'DATABASE',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettings },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return masked smtp status without exposing password', async () => {
    const status = await service.getSmtpStatus();
    expect(status.isConfigured).toBe(true);
    expect(status.host).toBe('smtp.gmail.com');
    expect(status.port).toBe(587);
    expect(status.fromEmail).toBe('support@quickboom.com');
    expect((status as any).password).toBeUndefined();
  });

  it('should throw BadRequestException if SMTP is not configured', async () => {
    mockIntegrationSettings.getSmtpConfig.mockResolvedValueOnce({
      isConfigured: false,
      host: '',
    });

    await expect(
      service.sendEmail({
        to: 'client@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException if SMTP is disabled', async () => {
    mockIntegrationSettings.getSmtpConfig.mockResolvedValueOnce({
      isConfigured: true,
      host: 'smtp.gmail.com',
      isEnabled: false,
    });

    await expect(
      service.sendEmail({
        to: 'client@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException for invalid recipient email', async () => {
    await expect(
      service.sendEmail({
        to: 'not-an-email',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should successfully send email and record audit log', async () => {
    const res = await service.sendEmail(
      {
        to: 'client@example.com',
        subject: 'Welcome to QuickBoom',
        body: 'Hello World',
        recordType: 'lead',
        recordId: '101',
      },
      { id: 5, customerId: 10 },
    );

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('<test-message-id@smtp.quickboom.com>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
      }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"QuickBoom Support" <support@quickboom.com>',
        to: 'client@example.com',
        subject: 'Welcome to QuickBoom',
        text: 'Hello World',
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('should record contact communication history when recordType is contact', async () => {
    await service.sendEmail({
      to: 'contact@example.com',
      subject: 'Contract Discussion',
      body: 'Details here',
      recordType: 'contact',
      recordId: 42,
    });

    expect(mockPrisma.communicationHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: 42,
        type: 'EMAIL',
        summary: 'Contract Discussion',
      }),
    });
  });

  it('should throw BadRequestException with actual SMTP failure message on nodemailer error', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'));

    await expect(
      service.sendEmail({
        to: 'client@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    ).rejects.toThrow('Failed to send email via SMTP (smtp.gmail.com:587): Invalid login');
  });
});
