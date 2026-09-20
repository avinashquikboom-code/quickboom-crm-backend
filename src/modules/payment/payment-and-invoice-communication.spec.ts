import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { NotificationService } from '../notification/notification.service';
import { SubscriptionService } from '../subscription/subscription.service';

describe('Payment & Invoice Communications', () => {
  let paymentService: PaymentService;
  let prisma: any;
  let emailService: any;
  let emailTemplateService: any;
  let whatsappService: any;
  let invoiceService: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 42,
          name: 'Tech Innovations Ltd',
          companyName: 'Tech Innovations Ltd',
          email: 'finance@techinnovations.com',
          phone: '+919123456780',
          users: [{ email: 'admin@techinnovations.com', phone: '+919123456780' }],
        }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 88,
          invoiceNo: 'INV-2026-000088',
          customerId: 42,
          totalAmount: 11799,
          contact: { firstName: 'Finance', lastName: 'Dept' },
        }),
      },
    };

    emailService = {
      sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-abc' }),
    };

    emailTemplateService = {
      findByKey: jest.fn().mockImplementation(async (key: string) => {
        if (key === 'PAYMENT_SUCCESS') {
          return {
            id: 1,
            subject: 'Payment Confirmation: ₹{{amount}} for {{planName}}',
            body: '<p>Payment of ₹{{amount}} received.</p>',
          };
        }
        if (key === 'INVOICE_GENERATED') {
          return {
            id: 2,
            subject: 'Tax Invoice #{{invoiceNo}} from {{companyName}}',
            body: '<p>Attached is your invoice #{{invoiceNo}}.</p>',
          };
        }
        return null;
      }),
    };

    whatsappService = {
      sendPaymentSuccessMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wa-pay-1' }),
      sendDocumentMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wa-doc-1' }),
    };

    invoiceService = {
      generateInvoicePdfBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 Mock Invoice Content')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleService, useValue: {} },
        { provide: WorkService, useValue: {} },
        { provide: IntegrationSettingsService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: EmailService, useValue: emailService },
        { provide: EmailTemplateService, useValue: emailTemplateService },
        { provide: WhatsappService, useValue: whatsappService },
        { provide: InvoiceService, useValue: invoiceService },
      ],
    }).compile();

    paymentService = module.get<PaymentService>(PaymentService);
  });

  it('should send Payment Success Email, Payment Success WhatsApp, Invoice Email with PDF, and WhatsApp Invoice Document', async () => {
    await paymentService.sendPaymentAndInvoiceCommunications({
      customerId: 42,
      paymentId: 'pay_ABC123456',
      amount: 11799,
      planName: 'Standard Package',
      transactionId: 'txn_987654321',
      orderId: 'order_123456',
      paymentMethod: 'UPI / Razorpay',
      invoiceNo: 'INV-2026-000088',
    });

    // 1. Check Payment Success Email
    expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
    const paymentEmailCall = emailService.sendEmail.mock.calls[0][0];
    expect(paymentEmailCall.to).toBe('finance@techinnovations.com');
    expect(paymentEmailCall.eventType).toBe('PAYMENT_SUCCESS');
    expect(paymentEmailCall.subject).toContain('₹11799');

    // 2. Check Payment Success WhatsApp
    expect(whatsappService.sendPaymentSuccessMessage).toHaveBeenCalledTimes(1);
    const waPaymentCall = whatsappService.sendPaymentSuccessMessage.mock.calls[0][0];
    expect(waPaymentCall.to).toBe('+919123456780');
    expect(waPaymentCall.amount).toBe(11799);
    expect(waPaymentCall.planName).toBe('Standard Package');

    // 3. Check Invoice PDF generation
    expect(invoiceService.generateInvoicePdfBuffer).toHaveBeenCalledTimes(1);

    // 4. Check Invoice Email with PDF attachment
    const invoiceEmailCall = emailService.sendEmail.mock.calls[1][0];
    expect(invoiceEmailCall.to).toBe('finance@techinnovations.com');
    expect(invoiceEmailCall.eventType).toBe('INVOICE_GENERATED');
    expect(invoiceEmailCall.attachments).toBeDefined();
    expect(invoiceEmailCall.attachments.length).toBe(1);
    expect(invoiceEmailCall.attachments[0].filename).toBe('Invoice-INV-2026-000088.pdf');

    // 5. Check WhatsApp Invoice Document dispatch
    expect(whatsappService.sendDocumentMessage).toHaveBeenCalledTimes(1);
    const waDocCall = whatsappService.sendDocumentMessage.mock.calls[0][0];
    expect(waDocCall.to).toBe('+919123456780');
    expect(waDocCall.filename).toBe('Invoice-INV-2026-000088.pdf');
    expect(Buffer.isBuffer(waDocCall.pdfBuffer)).toBe(true);
  });

  describe('SubscriptionService Offline Communications', () => {
    it('should send Offline Payment Success Email, WhatsApp, Invoice Email and WhatsApp document', async () => {
      const subscriptionService = new SubscriptionService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        emailService,
        emailTemplateService,
        whatsappService,
        invoiceService,
      );

      await subscriptionService.sendOfflinePaymentCommunications({
        customerId: 42,
        paymentId: 99,
        amount: 11799,
        planName: 'Standard Package',
        transactionId: 'REC-2026-000099',
        orderId: 'ORD-99',
        paymentMethod: 'Offline / Bank Transfer',
        invoiceNo: 'INV-2026-000088',
      });

      // Assert Email calls
      expect(emailService.sendEmail).toHaveBeenCalled();
      // Assert WhatsApp calls
      expect(whatsappService.sendPaymentSuccessMessage).toHaveBeenCalled();
      expect(whatsappService.sendDocumentMessage).toHaveBeenCalled();
    });
  });
});
