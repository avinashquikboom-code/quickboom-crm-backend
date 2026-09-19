import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { SendEmailDto } from './dto/send-email.dto';
import { EmailTemplateService, PREDEFINED_SYSTEM_TEMPLATES } from './email-template.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    private readonly emailTemplateService: EmailTemplateService,
  ) {}

  /**
   * Retrieves the current SMTP integration status without exposing credentials.
   */
  async getSmtpStatus() {
    const config = await this.integrationSettingsService.getSmtpConfig();
    return {
      isConfigured: config.isConfigured,
      isEnabled: config.isEnabled,
      source: config.source,
      host: config.host || null,
      port: config.port || null,
      security: config.security,
      fromEmail: config.fromEmail || null,
      fromName: config.fromName || null,
    };
  }

  /**
   * Sends an email via the configured SMTP server.
   */
  async sendEmail(dto: SendEmailDto, user?: any) {
    // 1. Fetch dynamic SMTP configuration
    const config = await this.integrationSettingsService.getSmtpConfig();

    if (!config.isConfigured || !config.host) {
      throw new BadRequestException(
        'SMTP Email Integration is not configured. Please configure SMTP host, port, credentials, and from email in Admin Panel → Settings → SMTP Email Integration.',
      );
    }

    if (!config.isEnabled) {
      throw new BadRequestException(
        'SMTP Email Integration is currently disabled. Please enable it under Admin Panel → Settings → SMTP Email Integration.',
      );
    }

    // 2. Validate recipient email
    const recipient = (dto.to || '').trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!recipient || !emailRegex.test(recipient)) {
      throw new BadRequestException(`Invalid recipient email address: "${recipient}"`);
    }

    // 2b. Validate template if provided
    if (dto.templateId) {
      const template = await this.prisma.emailTemplate.findFirst({
        where: { id: Number(dto.templateId), deletedAt: null },
      });
      if (!template) {
        throw new BadRequestException('Selected email template was not found');
      }
      if (!template.isActive) {
        throw new BadRequestException('The selected email template is inactive or has been disabled');
      }
    }

    // 3. Validate content
    const subject = (dto.subject || '').trim();
    if (!subject) {
      throw new BadRequestException('Email subject cannot be empty');
    }

    const htmlContent = dto.html || (dto.body && dto.body.includes('<') ? dto.body : undefined);
    const textContent = dto.text || (!htmlContent ? dto.body : undefined);

    if (!htmlContent && !textContent) {
      throw new BadRequestException('Email body cannot be empty');
    }

    // 4. Resolve sender
    const fromAddress = (dto.fromEmail?.trim() || config.fromEmail?.trim());
    if (!fromAddress) {
      throw new BadRequestException('From Email is missing in SMTP configuration');
    }
    const fromName = (dto.fromName?.trim() || config.fromName?.trim() || 'QuickBoom CRM');
    const formattedFrom = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    // 5. Create nodemailer transport with configured options
    const transportOptions: any = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    };

    if (config.username || config.password) {
      transportOptions.auth = {
        user: config.username,
        pass: config.password,
      };
    }

    if (!config.secure && config.port !== 465) {
      transportOptions.tls = {
        rejectUnauthorized: false,
      };
    }

    const cc = dto.cc ? (Array.isArray(dto.cc) ? dto.cc.join(', ') : String(dto.cc).trim()) : undefined;
    const bcc = dto.bcc ? (Array.isArray(dto.bcc) ? dto.bcc.join(', ') : String(dto.bcc).trim()) : undefined;

    const customerId = user?.customerId ? Number(user.customerId) : null;
    const userId = user?.id ? Number(user.id) : null;

    // 6. Send email
    try {
      const transporter = nodemailer.createTransport(transportOptions);
      const mailPayload: any = {
        from: formattedFrom,
        to: recipient,
        subject,
        text: textContent,
        html: htmlContent,
      };
      if (cc) mailPayload.cc = cc;
      if (bcc) mailPayload.bcc = bcc;

      const info = await transporter.sendMail(mailPayload);

      this.logger.log(`[EMAIL_SENT] Successfully sent email to "${recipient}" with messageId: ${info.messageId}`);

      // 7. Audit log
      await this.prisma.auditLog.create({
        data: {
          customerId,
          userId,
          action: 'EMAIL_SENT',
          module: 'EMAIL',
          details: {
            to: recipient,
            cc: cc || null,
            bcc: bcc || null,
            subject,
            from: formattedFrom,
            templateId: dto.templateId || null,
            recordType: dto.recordType || null,
            recordId: dto.recordId ? String(dto.recordId) : null,
            messageId: info.messageId,
            sentAt: new Date().toISOString(),
          },
        },
      }).catch((err) => {
        this.logger.warn(`[EMAIL_AUDIT_LOG_WARN] Failed to write email audit log: ${err?.message}`);
      });

      // 8. Dedicated EmailLog record if available
      if (this.prisma.emailLog) {
        await this.prisma.emailLog.create({
          data: {
            customerId,
            userId,
            templateId: dto.templateId ? Number(dto.templateId) : null,
            leadId: dto.recordType?.toLowerCase() === 'lead' && dto.recordId ? Number(dto.recordId) : null,
            recipientEmail: recipient,
            subject,
            renderedContent: htmlContent || textContent,
            eventType: dto.eventType || (dto.templateId ? 'TEMPLATE_SEND' : 'DIRECT_SEND'),
            status: 'SENT',
            providerMessageId: info.messageId,
            sentAt: new Date(),
          },
        }).catch((err) => {
          this.logger.warn(`[EMAIL_LOG_WARN] Failed to write EmailLog: ${err?.message}`);
        });
      }

      // 9. Contact communication history if recordType is contact
      if (dto.recordType?.toLowerCase() === 'contact' && dto.recordId) {
        const contactId = Number(dto.recordId);
        if (!isNaN(contactId)) {
          await this.prisma.communicationHistory.create({
            data: {
              contactId,
              type: 'EMAIL',
              summary: subject,
              details: `To: ${recipient}\nFrom: ${formattedFrom}\n\n${textContent || ''}`,
            },
          }).catch((err) => {
            this.logger.warn(`[EMAIL_COMM_HIST_WARN] Failed to record communication history: ${err?.message}`);
          });
        }
      }

      return {
        success: true,
        message: `Email successfully sent to ${recipient}`,
        messageId: info.messageId,
        envelope: info.envelope,
      };
    } catch (err: any) {
      this.logger.error(`[EMAIL_SEND_FAILED] To: "${recipient}", Error: ${err?.message}`);

      if (this.prisma.emailLog) {
        await this.prisma.emailLog.create({
          data: {
            customerId,
            userId,
            templateId: dto.templateId ? Number(dto.templateId) : null,
            leadId: dto.recordType?.toLowerCase() === 'lead' && dto.recordId ? Number(dto.recordId) : null,
            recipientEmail: recipient,
            subject,
            renderedContent: htmlContent || textContent,
            eventType: dto.eventType || (dto.templateId ? 'TEMPLATE_SEND' : 'DIRECT_SEND'),
            status: 'FAILED',
            errorMessage: err?.message || 'Unknown SMTP error',
            sentAt: new Date(),
          },
        }).catch(() => null);
      }

      throw new BadRequestException(
        `Failed to send email via SMTP (${config.host}:${config.port}): ${err?.message || 'Unknown SMTP error'}`,
      );
    }
  }

  /**
   * Resolves an email template by key, interpolates placeholders, and sends via existing SMTP.
   * Seamless fallback to default template if custom template is absent or inactive.
   */
  async sendTemplateEmail(
    key: string,
    to: string,
    variables: Record<string, any> = {},
    options?: Partial<SendEmailDto>,
    user?: any,
  ) {
    const customerId = user?.customerId ? Number(user.customerId) : null;
    const template = await this.emailTemplateService.findByKey(key, customerId);

    let subject: string;
    let body: string;

    if (template && template.isActive) {
      subject = this.emailTemplateService.interpolate(template.subject, variables);
      body = this.emailTemplateService.interpolate(template.body, variables);
    } else {
      this.logger.warn(`Template "${key}" not active or not found. Falling back to default system definition.`);
      const fallback = PREDEFINED_SYSTEM_TEMPLATES.find((t) => t.key === key.trim().toUpperCase());
      if (fallback) {
        subject = this.emailTemplateService.interpolate(fallback.subject, variables);
        body = this.emailTemplateService.interpolate(fallback.body, variables);
      } else {
        subject = options?.subject || `Notification: ${key}`;
        body = options?.body || `Hello,\n\nThis is an automated notification.`;
      }
    }

    const isHtml = body.includes('<') && body.includes('>');

    return this.sendEmail(
      {
        to,
        subject,
        body,
        html: isHtml ? body : undefined,
        text: !isHtml ? body : undefined,
        fromEmail: options?.fromEmail,
        fromName: options?.fromName,
        recordType: options?.recordType || 'TEMPLATE',
        recordId: options?.recordId || key,
      },
      user,
    );
  }
}
