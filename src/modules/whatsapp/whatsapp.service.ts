import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  details?: string;
  skipped?: boolean;
  skippedDuplicate?: boolean;
  reason?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
  ) {}

  /**
   * Normalizes a phone number for WhatsApp Business API (E.164 digits without leading '+').
   * Examples:
   * - "+919876543210" -> "919876543210"
   * - "9876543210" (Indian 10-digit) -> "919876543210"
   * - "09876543210" -> "919876543210"
   * - "919876543210" -> "919876543210"
   * - "+1 (415) 555-2671" -> "14155552671"
   * Returns null if input is empty or invalid.
   */
  normalizePhoneNumber(phone?: string | null): string | null {
    if (!phone || typeof phone !== 'string') return null;

    // Strip whitespace, plus, dashes, parentheses, dots
    const cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return null;

    // Handle leading 0 (e.g. 09876543210 -> 9876543210)
    let digits = cleaned;
    if (digits.startsWith('0') && digits.length === 11) {
      digits = digits.substring(1);
    }

    // Standard 10-digit Indian mobile number (starts with 6, 7, 8, or 9)
    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
      return `91${digits}`;
    }

    // 12-digit Indian mobile number starting with 91
    if (digits.length === 12 && digits.startsWith('91') && /^91[6-9]\d{9}$/.test(digits)) {
      return digits;
    }

    // General international numbers: between 10 and 15 digits (ITU-T E.164)
    if (digits.length >= 10 && digits.length <= 15) {
      return digits;
    }

    return null;
  }

  /**
   * Masks a phone number for safe diagnostics/logging without exposing sensitive PII.
   */
  maskPhone(phone?: string | null): string {
    if (!phone) return 'none';
    const clean = phone.replace(/\D/g, '');
    if (clean.length <= 4) return '****';
    return `****${clean.slice(-4)}`;
  }

  /**
   * Dispatches a WhatsApp template message using existing Meta Business Cloud API configuration.
   * If template fails with code 132001 (Template not found) and fallbackText is provided,
   * gracefully falls back to sending a text message.
   */
  /**
   * Dispatches a WhatsApp template message using existing Meta Business Cloud API configuration.
   * If template fails with code 132001 (Template not found) and fallbackText is provided,
   * gracefully falls back to sending a text message.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    parameters: Array<{ type: 'text'; text: string }> = [],
    languageCode = 'en_US',
    fallbackText?: string,
    stageName?: string,
  ): Promise<WhatsAppSendResult> {
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      this.logger.warn(`[WHATSAPP] No customer phone number found: invalid or empty (${this.maskPhone(to)})`);
      return { success: false, error: 'INVALID_PHONE', reason: 'NO_PHONE' };
    }

    // 1. Retrieve existing WhatsApp credentials from Integration Settings
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    if (!config?.isEnabled) {
      this.logger.log(`[WHATSAPP] WhatsApp integration is disabled in Admin Panel. Skipping message for ${this.maskPhone(normalizedTo)}.`);
      return { success: false, skipped: true, reason: 'INTEGRATION_DISABLED' };
    }

    const creds = config.credentials || {};
    const apiKey = (creds.apiKey || creds.accessToken || creds.access_token || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();

    if (!apiKey || !phoneNumberId) {
      this.logger.warn('[WHATSAPP] WhatsApp not configured: missing API Access Token or Phone Number ID in Admin Settings');
      return { success: false, skipped: true, reason: 'CREDENTIALS_MISSING' };
    }

    const maskedPhone = this.maskPhone(normalizedTo);
    this.logger.log(
      `[WHATSAPP_REQUEST]\nProvider:\nMeta WhatsApp Cloud API\nRecipient:\n${maskedPhone}\nTemplate:\n${templateName}\nStage:\n${stageName || 'N/A'}`
    );

    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // 2. Build Meta Cloud API template payload
    const templatePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length > 0
          ? [
              {
                type: 'body',
                parameters,
              },
            ]
          : undefined,
      },
    };

    try {
      const response = await axios.post(url, templatePayload, { headers, timeout: 10000 });
      const messageId = response.data?.messages?.[0]?.id;
      this.logger.log(
        `[WHATSAPP_RESPONSE]\nHTTP status:\n${response.status}\nProvider message ID:\n${messageId || 'N/A'}`
      );
      return { success: true, messageId };
    } catch (err: any) {
      const status = err?.response?.status;
      const fbError = err?.response?.data?.error;
      const errorCode = fbError?.code || err?.code || 'UNKNOWN';
      const errorMessage = fbError?.message || err?.message || 'Meta API error';

      this.logger.warn(
        `[WHATSAPP_RESPONSE_ERROR]\nHTTP status:\n${status || 'N/A'}\nError code:\n${errorCode}\nError message:\n${errorMessage}`
      );

      // If template not found (code 132001 or 100) and fallback text is provided, attempt text message
      if (fallbackText && (errorCode === 132001 || errorCode === 100 || String(errorMessage).toLowerCase().includes('template'))) {
        this.logger.log(`[WHATSAPP] Template "${templateName}" not active on Meta. Falling back to direct message.`);
        return this.sendMessage(normalizedTo, fallbackText, stageName);
      }

      this.logger.error(`[WHATSAPP] WhatsApp API request failed: ${errorCode} - ${errorMessage}`);
      return {
        success: false,
        error: String(errorCode),
        details: errorMessage,
        reason: String(errorCode),
      };
    }
  }

  /**
   * Dispatches a direct text message via Meta Business Cloud API.
   */
  async sendMessage(to: string, text: string, stageName?: string): Promise<WhatsAppSendResult> {
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      this.logger.warn(`[WHATSAPP] No customer phone number found: invalid or empty (${this.maskPhone(to)})`);
      return { success: false, error: 'INVALID_PHONE', reason: 'NO_PHONE' };
    }

    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    if (!config?.isEnabled) {
      this.logger.log('[WHATSAPP] WhatsApp integration is disabled in Admin Panel. Skipping message.');
      return { success: false, skipped: true, reason: 'INTEGRATION_DISABLED' };
    }

    const creds = config.credentials || {};
    const apiKey = (creds.apiKey || creds.accessToken || creds.access_token || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();

    if (!apiKey || !phoneNumberId) {
      this.logger.warn('[WHATSAPP] WhatsApp not configured: missing API Access Token or Phone Number ID in Admin Settings');
      return { success: false, skipped: true, reason: 'CREDENTIALS_MISSING' };
    }

    const maskedPhone = this.maskPhone(normalizedTo);
    this.logger.log(
      `[WHATSAPP_REQUEST]\nProvider:\nMeta WhatsApp Cloud API\nRecipient:\n${maskedPhone}\nType:\ntext\nStage:\n${stageName || 'N/A'}`
    );

    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    try {
      const response = await axios.post(url, payload, { headers, timeout: 10000 });
      const messageId = response.data?.messages?.[0]?.id;
      this.logger.log(
        `[WHATSAPP_RESPONSE]\nHTTP status:\n${response.status}\nProvider message ID:\n${messageId || 'N/A'}`
      );
      return { success: true, messageId };
    } catch (err: any) {
      const status = err?.response?.status;
      const fbError = err?.response?.data?.error;
      const errorCode = fbError?.code || err?.code || 'UNKNOWN';
      const errorMessage = fbError?.message || err?.message || 'Meta API error';

      this.logger.error(
        `[WHATSAPP_RESPONSE_ERROR]\nHTTP status:\n${status || 'N/A'}\nError code:\n${errorCode}\nError message:\n${errorMessage}`
      );

      return {
        success: false,
        error: String(errorCode),
        details: errorMessage,
        reason: String(errorCode),
      };
    }
  }

  /**
   * Resolves the primary customer phone number from the database.
   * Checks customer.phone -> customer.alternatePhone -> linked user.phone.
   */
  async resolveCustomerPhone(customerId: number): Promise<{ phone: string | null; customerName: string }> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          companyName: true,
          phone: true,
          alternatePhone: true,
          users: {
            where: { deletedAt: null },
            select: { phone: true },
            take: 1,
          },
        },
      });

      if (!customer) {
        return { phone: null, customerName: 'Customer' };
      }

      const customerName = customer.name || customer.companyName || 'Customer';
      const rawPhone = customer.phone || customer.alternatePhone || customer.users[0]?.phone || null;
      const normalized = this.normalizePhoneNumber(rawPhone);

      return { phone: normalized, customerName };
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Error resolving customer phone from database: ${err?.message}`);
      return { phone: null, customerName: 'Customer' };
    }
  }

  /**
   * 1. CUSTOMER REGISTRATION -> WELCOME WHATSAPP
   * Dispatches welcome template to customer's registered phone.
   * Includes idempotency check: max 1 welcome WhatsApp per customer.
   */
  async sendCustomerWelcomeMessage(params: {
    customerId: number;
    customerName?: string;
    phone?: string;
    notificationId?: number;
  }): Promise<WhatsAppSendResult> {
    const { customerId } = params;
    this.logger.log(`[WHATSAPP] Customer welcome notification started`);

    try {
      // 1. Idempotency check: verify whether welcome WhatsApp was already dispatched
      const existingNotif = await this.prisma.notification.findFirst({
        where: {
          customerId,
          type: { in: ['WELCOME', 'CUSTOMER_WELCOME'] },
        },
      });

      const existingData = (existingNotif?.data as any) || {};
      if (existingData.whatsappSent === true) {
        this.logger.log(`[WHATSAPP] Welcome message already sent for customerId=${customerId}. Skipping duplicate.`);
        return { success: true, skippedDuplicate: true };
      }

      // 2. Resolve customer phone number strictly from DB
      let targetPhone = this.normalizePhoneNumber(params.phone);
      let customerName = params.customerName;

      if (!targetPhone) {
        const resolved = await this.resolveCustomerPhone(customerId);
        targetPhone = resolved.phone;
        if (!customerName) customerName = resolved.customerName;
      }

      if (!targetPhone) {
        this.logger.warn(`[WHATSAPP] No customer phone number found for customerId=${customerId}`);
        return { success: false, skipped: true, reason: 'NO_PHONE' };
      }

      const maskedPhone = this.maskPhone(targetPhone);
      this.logger.log(`[WHATSAPP] Customer phone resolved: ${maskedPhone}`);

      const resolvedName = customerName || 'Customer';

      // 3. Prepare template message & fallback text
      const templateName = 'customer_welcome';
      const templateParameters: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: resolvedName },
      ];

      const fallbackText = `Welcome to QuikBoom, ${resolvedName}! 🎉\n\nYour account has been created successfully.\n\nWe're happy to have you with us.`;

      // 4. Send template via Meta Cloud API
      const result = await this.sendTemplate(
        targetPhone,
        templateName,
        templateParameters,
        'en_US',
        fallbackText,
      );

      if (result.success) {
        this.logger.log(`[WHATSAPP] Welcome template sent successfully: messageId=${result.messageId || 'N/A'}`);

        // Update notification DB record with WhatsApp delivery metadata for idempotency
        const notifToUpdate = params.notificationId || existingNotif?.id;
        if (notifToUpdate) {
          try {
            await this.prisma.notification.update({
              where: { id: notifToUpdate },
              data: {
                data: {
                  ...existingData,
                  whatsappSent: true,
                  whatsappMessageId: result.messageId || 'SUCCESS',
                  whatsappRecipient: maskedPhone,
                  whatsappSentAt: new Date().toISOString(),
                } as any,
              },
            });
          } catch (updateErr: any) {
            this.logger.warn(`Non-fatal: Failed updating notification data with WhatsApp status: ${updateErr?.message}`);
          }
        }
      }

      return result;
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Customer welcome message failed: ${err?.message}`);
      return { success: false, error: err?.message };
    }
  }

  /**
   * 2. PLAN PURCHASE -> WHATSAPP PLAN ACTIVATION
   * Dispatches plan activation template to customer's registered phone.
   * Only called after payment verification succeeds AND subscription is ACTIVE.
   * Includes idempotency check: max 1 plan activation WhatsApp per subscription/payment.
   */
  async sendPlanActivationMessage(params: {
    customerId: number;
    customerName?: string;
    planName: string;
    billingCycle?: string;
    startDate?: string | Date;
    expiryDate?: string | Date;
    subscriptionId?: number;
    paymentId?: string | number;
    phone?: string;
    notificationId?: number;
  }): Promise<WhatsAppSendResult> {
    const { customerId, planName, subscriptionId, paymentId } = params;
    this.logger.log(`[WHATSAPP] Plan activation notification started`);

    try {
      // 1. Idempotency check: verify whether plan activation WhatsApp was already sent for this subscription
      if (subscriptionId || paymentId) {
        const recentNotifs = await this.prisma.notification.findMany({
          where: {
            customerId,
            type: 'PLAN_PURCHASE_SUCCESS',
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });

        const duplicate = recentNotifs.find((n) => {
          const data = (n.data as any) || {};
          if (data.whatsappSent !== true) return false;
          if (paymentId && String(data.paymentId) === String(paymentId)) return true;
          if (subscriptionId && String(data.subscriptionId) === String(subscriptionId)) return true;
          return false;
        });

        if (duplicate) {
          this.logger.log(`[WHATSAPP] Plan activation message already sent for subscriptionId=${subscriptionId}. Skipping duplicate.`);
          return { success: true, skippedDuplicate: true };
        }
      }

      // 2. Resolve customer phone number strictly from DB
      let targetPhone = this.normalizePhoneNumber(params.phone);
      let customerName = params.customerName;

      if (!targetPhone) {
        const resolved = await this.resolveCustomerPhone(customerId);
        targetPhone = resolved.phone;
        if (!customerName) customerName = resolved.customerName;
      }

      if (!targetPhone) {
        this.logger.warn(`[WHATSAPP] No customer phone number found for customerId=${customerId}`);
        return { success: false, skipped: true, reason: 'NO_PHONE' };
      }

      const maskedPhone = this.maskPhone(targetPhone);
      this.logger.log(`[WHATSAPP] Customer phone resolved: ${maskedPhone}`);

      // 3. Format dynamic variables
      const resolvedName = customerName || 'Customer';
      const billingCycle = params.billingCycle || 'Monthly';
      const startDateStr = params.startDate
        ? new Date(params.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const expiryDateStr = params.expiryDate
        ? new Date(params.expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Ongoing';

      const templateName = 'plan_activation_success';
      const templateParameters: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: resolvedName },
        { type: 'text', text: planName },
        { type: 'text', text: billingCycle },
        { type: 'text', text: startDateStr },
        { type: 'text', text: expiryDateStr },
      ];

      const fallbackText = `Hi ${resolvedName} 👋\n\nYour ${planName} plan has been activated successfully.\n\nPlan: ${planName}\nBilling: ${billingCycle}\nValid From: ${startDateStr}\nValid Until: ${expiryDateStr}\n\nThank you for choosing QuikBoom! 🎉`;

      // 4. Send template via Meta Cloud API
      const result = await this.sendTemplate(
        targetPhone,
        templateName,
        templateParameters,
        'en_US',
        fallbackText,
      );

      if (result.success) {
        this.logger.log(`[WHATSAPP] Plan activation template sent successfully: messageId=${result.messageId || 'N/A'}`);

        // Update notification DB record with WhatsApp delivery metadata for idempotency
        if (params.notificationId) {
          try {
            const notif = await this.prisma.notification.findUnique({ where: { id: params.notificationId } });
            const existingData = (notif?.data as any) || {};
            await this.prisma.notification.update({
              where: { id: params.notificationId },
              data: {
                data: {
                  ...existingData,
                  whatsappSent: true,
                  whatsappMessageId: result.messageId || 'SUCCESS',
                  whatsappRecipient: maskedPhone,
                  whatsappSentAt: new Date().toISOString(),
                } as any,
              },
            });
          } catch (updateErr: any) {
            this.logger.warn(`Non-fatal: Failed updating notification data with WhatsApp status: ${updateErr?.message}`);
          }
        }
      }

      return result;
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Plan activation message failed: ${err?.message}`);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Extracts placeholders from template body (e.g. {{1}}, {{2}} or {{leadName}}, {{companyName}})
   * and maps them to actual lead data in the exact order and count required by Meta WhatsApp Cloud API.
   */
  resolveTemplateParameters(
    templateBody: string,
    variables: Record<string, string>,
  ): Array<{ type: 'text'; text: string }> {
    const matches = templateBody.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (!matches || matches.length === 0) {
      return [];
    }

    const positionalFallback: Record<string, string> = {
      '1': variables.leadName || variables.leadTitle || 'Valued Prospect',
      '2': variables.companyName || 'QUIKBOOM',
      '3': variables.leadTitle || variables.userName || 'Marketing Solution',
      '4': variables.userName || variables.assignedEmployeeName || 'QuickBoom Team',
    };

    return matches.map((rawTag) => {
      const tag = rawTag.replace(/[\{\}\s]/g, '');
      let val = variables[tag];
      if (val === undefined && positionalFallback[tag] !== undefined) {
        val = positionalFallback[tag];
      }
      return {
        type: 'text' as const,
        text: String(val !== undefined ? val : ''),
      };
    });
  }

  /**
   * Resolves a standard WhatsApp template for a given lead stage key or alias.
   */
  getStageTemplate(stageKey?: string | null): LeadStageWhatsAppTemplate | null {
    if (!stageKey) return null;
    const normalized = stageKey.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const resolvedKey = STAGE_KEY_TO_WHATSAPP_KEY[normalized] || normalized;
    return LEAD_STAGE_WHATSAPP_TEMPLATES[resolvedKey] || LEAD_STAGE_WHATSAPP_TEMPLATES[normalized] || null;
  }

  /**
   * Returns all available lead stage WhatsApp templates.
   */
  getAllStageTemplates(): LeadStageWhatsAppTemplate[] {
    return Object.values(LEAD_STAGE_WHATSAPP_TEMPLATES);
  }

  /**
   * Dispatches a lead stage change notification via WhatsApp.
   */
  async sendLeadStageMessage(params: {
    to: string;
    stageKey: string;
    variables: Record<string, string>;
    customMessage?: string;
    fallbackText?: string;
    stageName?: string;
  }): Promise<WhatsAppSendResult> {
    const { to, stageKey, variables, customMessage, stageName } = params;
    const template = this.getStageTemplate(stageKey);

    let messageText = customMessage;
    if (!messageText) {
      if (template) {
        let rendered = template.body;
        for (const [k, v] of Object.entries(variables)) {
          rendered = rendered.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v || '');
        }
        messageText = rendered;
      } else if (params.fallbackText) {
        messageText = params.fallbackText;
      }
    }

    if (!messageText) {
      return { success: false, skipped: true, reason: 'NO_TEMPLATE_OR_MESSAGE' };
    }

    const templateName = template?.templateName || 'lead_stage_update';
    const templateParameters = template
      ? this.resolveTemplateParameters(template.body, variables)
      : Object.values(variables).slice(0, 3).map((v) => ({ type: 'text' as const, text: String(v) }));

    return this.sendTemplate(
      to,
      templateName,
      templateParameters,
      'en_US',
      messageText,
      stageName || template?.name || stageKey,
    );
  }

  /**
   * Generates safe diagnostic output for Section 17 without revealing secrets.
   */
  async getDiagnostics(stageKey?: string, phone?: string) {
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    const creds = config?.credentials || {};
    const hasToken = Boolean(creds.apiKey || creds.accessToken || creds.access_token);
    const hasPhoneId = Boolean(creds.phoneNumberId || creds.phone_number_id);
    const hasWabaId = Boolean(creds.businessAccountId || creds.wabaId);
    const normalizedPhone = this.normalizePhoneNumber(phone);
    const template = this.getStageTemplate(stageKey);

    return {
      provider: 'Meta WhatsApp Cloud API',
      configuration: {
        accessToken: hasToken ? 'PRESENT' : 'MISSING',
        phoneNumberId: hasPhoneId ? 'PRESENT' : 'MISSING',
        businessAccountId: hasWabaId ? 'PRESENT' : 'MISSING',
        apiConfiguration: (hasToken && hasPhoneId) ? 'PRESENT' : 'MISSING',
        source: config?.source || 'NONE',
        isEnabled: Boolean(config?.isEnabled),
      },
      template: {
        stage: stageKey || 'N/A',
        templateFound: Boolean(template),
        templateName: template?.templateName || 'N/A',
        templateActive: true,
        templateApprovedOrConfigured: Boolean(template),
        language: 'en_US',
        parametersCount: template ? (template.body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []).length : 0,
      },
      lead: {
        phonePresent: Boolean(phone),
        phoneFormatValid: Boolean(normalizedPhone),
        maskedPhone: this.maskPhone(phone),
      },
      api: {
        requestGenerated: Boolean(hasToken && hasPhoneId && normalizedPhone && template),
      },
    };
  }
}

export const STAGE_KEY_TO_WHATSAPP_KEY: Record<string, string> = {
  NEW: 'NEW',
  NEW_LEAD: 'NEW',
  CONTACTED: 'CONTACTED',
  CALL_BACK: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  DETAILS_SENT: 'DETAILS_SENT',
  DETAILS_SEND: 'DETAILS_SENT',
  COMPANY_DETAILS_SENT: 'DETAILS_SENT',
  FOLLOW_UP: 'FOLLOW_UP',
  FOLLOWUP: 'FOLLOW_UP',
  CUSTOMER_FOLLOW_UP: 'FOLLOW_UP',
  VISIT_SCHEDULED: 'VISIT_SCHEDULED',
  VISIT: 'VISIT_SCHEDULED',
  VISIT_DONE: 'VISIT_DONE',
  VISIT_COMPLETED: 'VISIT_DONE',
  PROPOSAL_SENT: 'PROPOSAL_SENT',
  PROPOSAL: 'PROPOSAL_SENT',
  NEGOTIATION: 'NEGOTIATION',
  FINAL_CALL: 'FINAL_CALL',
  FINAL_DISCUSSION: 'FINAL_CALL',
  WON: 'WON',
  CLOSED_WON: 'WON',
  CONVERTED: 'WON',
  DEAL_WON: 'WON',
  WORK_STARTED: 'WON',
  PAYMENT: 'PROPOSAL_SENT',
  LOST: 'LOST',
  CLOSED_LOST: 'LOST',
  CANCELLED: 'LOST',
  DEAL_LOST: 'LOST',
};

export interface LeadStageWhatsAppTemplate {
  key: string;
  templateName: string;
  name: string;
  body: string;
}

export const LEAD_STAGE_WHATSAPP_TEMPLATES: Record<string, LeadStageWhatsAppTemplate> = {
  NEW: {
    key: 'NEW',
    templateName: 'lead_stage_new',
    name: 'New Lead Welcome',
    body: 'Hi {{leadName}}, thank you for contacting {{companyName}}! We have received your inquiry regarding {{leadTitle}} and our team has been assigned to assist you.',
  },
  CONTACTED: {
    key: 'CONTACTED',
    templateName: 'lead_stage_contacted',
    name: 'Contacted Stage',
    body: 'Hi {{leadName}}, this is {{userName}} from {{companyName}}. It was great speaking with you regarding {{leadTitle}}. Please feel free to reply if you have any questions.',
  },
  QUALIFIED: {
    key: 'QUALIFIED',
    templateName: 'lead_stage_qualified',
    name: 'Qualified Stage',
    body: 'Hi {{leadName}}, we are pleased to inform you that your requirements for {{leadTitle}} have been qualified! Our team at {{companyName}} is now preparing the ideal solution for you.',
  },
  PROPOSAL: {
    key: 'PROPOSAL',
    templateName: 'lead_stage_proposal',
    name: 'Proposal Stage',
    body: 'Hi {{leadName}}, the customized proposal for {{leadTitle}} from {{companyName}} is ready. Please review it and let us know when we can discuss next steps.',
  },
  PROPOSAL_SENT: {
    key: 'PROPOSAL_SENT',
    templateName: 'lead_stage_proposal',
    name: 'Proposal Sent Stage',
    body: 'Hi {{leadName}}, the customized proposal for {{leadTitle}} from {{companyName}} is ready. Please review it and let us know when we can discuss next steps.',
  },
  NEGOTIATION: {
    key: 'NEGOTIATION',
    templateName: 'lead_stage_negotiation',
    name: 'Negotiation Stage',
    body: 'Hi {{leadName}}, following our discussion regarding {{leadTitle}}, we are finalizing the tailored scope and terms. Let us know if you need any adjustments.',
  },
  FINAL_CALL: {
    key: 'FINAL_CALL',
    templateName: 'lead_stage_final_call',
    name: 'Final Call Stage',
    body: 'Hi {{leadName}}, we are preparing the final confirmation for {{leadTitle}} from {{companyName}}. Looking forward to finalizing our collaboration!',
  },
  WON: {
    key: 'WON',
    templateName: 'lead_stage_won',
    name: 'Won / Deal Closed',
    body: 'Congratulations {{leadName}}! 🎉 We are delighted to confirm our partnership for {{leadTitle}}. Welcome to {{companyName}}!',
  },
  CONVERTED: {
    key: 'CONVERTED',
    templateName: 'lead_stage_won',
    name: 'Converted Stage',
    body: 'Congratulations {{leadName}}! 🎉 We are delighted to confirm our partnership for {{leadTitle}}. Welcome to {{companyName}}!',
  },
  LOST: {
    key: 'LOST',
    templateName: 'lead_stage_lost',
    name: 'Lost Stage',
    body: 'Hi {{leadName}}, thank you for considering {{companyName}} for {{leadTitle}}. While we could not move forward right now, we hope to collaborate in the future!',
  },
  CANCELLED: {
    key: 'CANCELLED',
    templateName: 'lead_stage_lost',
    name: 'Cancelled Stage',
    body: 'Hi {{leadName}}, thank you for considering {{companyName}} for {{leadTitle}}. While we could not move forward right now, we hope to collaborate in the future!',
  },
  DETAILS_SENT: {
    key: 'DETAILS_SENT',
    templateName: 'lead_stage_details_sent',
    name: 'Details Sent Stage',
    body: 'Hi {{leadName}}, we have sent the complete details and brochure for {{leadTitle}} to your email. Please review them at your convenience.',
  },
  FOLLOW_UP: {
    key: 'FOLLOW_UP',
    templateName: 'lead_stage_follow_up',
    name: 'Follow Up Stage',
    body: 'Hi {{leadName}}, following up on our recent discussion regarding {{leadTitle}}. Please let us know when you would be available for a quick catch-up.',
  },
  VISIT_SCHEDULED: {
    key: 'VISIT_SCHEDULED',
    templateName: 'lead_stage_visit_scheduled',
    name: 'Visit Scheduled Stage',
    body: 'Hi {{leadName}}, your appointment with {{companyName}} regarding {{leadTitle}} has been scheduled. We look forward to meeting with you!',
  },
  VISIT: {
    key: 'VISIT',
    templateName: 'lead_stage_visit_scheduled',
    name: 'Visit Stage',
    body: 'Hi {{leadName}}, your appointment with {{companyName}} regarding {{leadTitle}} has been scheduled. We look forward to meeting with you!',
  },
  VISIT_DONE: {
    key: 'VISIT_DONE',
    templateName: 'lead_stage_visit_done',
    name: 'Visit Done Stage',
    body: 'Hi {{leadName}}, thank you for meeting with {{companyName}} regarding {{leadTitle}}. We are compiling the action items discussed and will follow up shortly.',
  },
};
