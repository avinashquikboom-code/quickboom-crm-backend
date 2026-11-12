import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { LeadRepository } from '../lead/lead.repository';
import {
  CreateSendDetailsDocumentDto,
  UpdateSendDetailsDocumentDto,
  UpdateSendDetailsConfigDto,
  ManualSendDetailsDto,
  RetryDeliveryDto,
  SendDetailsCategory,
  SEND_DETAILS_DEFAULT_CATEGORIES,
} from './dto/send-details.dto';

@Injectable()
export class SendDetailsService {
  private readonly logger = new Logger(SendDetailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly emailService: EmailService,
    private readonly leadRepository: LeadRepository,
  ) {}

  /**
   * Initializes default documents for a customer if none exist yet.
   */
  async ensureDefaultDocuments(customerId: number) {
    const count = await this.prisma.sendDetailsDocument.count({
      where: { customerId, deletedAt: null },
    });

    if (count === 0) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true, companyName: true },
      });
      const compName = customer?.companyName || customer?.name || 'Company';

      for (const item of SEND_DETAILS_DEFAULT_CATEGORIES) {
        await this.prisma.sendDetailsDocument.create({
          data: {
            customerId,
            category: item.category,
            title: `${compName} - ${item.title}`,
            description: item.description,
            fileUrl: `https://storage.qbapp.online/documents/${item.category.toLowerCase()}.pdf`,
            fileName: `${item.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
            fileSize: 1024 * 1024, // 1MB nominal placeholder
            fileType: 'application/pdf',
            version: '1.0',
            isActive: true,
            sortOrder: item.sortOrder,
          },
        });
      }
    }
  }

  /**
   * Retrieves all Send Details documents for a customer.
   */
  async getDocuments(customerId: number) {
    await this.ensureDefaultDocuments(customerId);
    return this.prisma.sendDetailsDocument.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Create a new document in Send Details.
   */
  async createDocument(customerId: number, dto: CreateSendDetailsDocumentDto) {
    return this.prisma.sendDetailsDocument.create({
      data: {
        customerId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName || `${dto.title}.pdf`,
        fileSize: dto.fileSize || 1024 * 512,
        fileType: dto.fileType || 'application/pdf',
        version: dto.version || '1.0',
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        sortOrder: dto.sortOrder || 0,
      },
    });
  }

  /**
   * Update an existing Send Details document.
   */
  async updateDocument(customerId: number, documentId: number, dto: UpdateSendDetailsDocumentDto) {
    const doc = await this.prisma.sendDetailsDocument.findFirst({
      where: { id: documentId, customerId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');

    return this.prisma.sendDetailsDocument.update({
      where: { id: documentId },
      data: {
        title: dto.title ?? doc.title,
        description: dto.description ?? doc.description,
        fileUrl: dto.fileUrl ?? doc.fileUrl,
        fileName: dto.fileName ?? doc.fileName,
        fileSize: dto.fileSize ?? doc.fileSize,
        fileType: dto.fileType ?? doc.fileType,
        version: dto.version ?? doc.version,
        isActive: dto.isActive !== undefined ? dto.isActive : doc.isActive,
        sortOrder: dto.sortOrder ?? doc.sortOrder,
      },
    });
  }

  /**
   * Soft delete a document.
   */
  async deleteDocument(customerId: number, documentId: number) {
    const doc = await this.prisma.sendDetailsDocument.findFirst({
      where: { id: documentId, customerId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');

    return this.prisma.sendDetailsDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Gets or initializes the customer Send Details configuration.
   */
  async getConfig(customerId: number) {
    let config = await this.prisma.sendDetailsConfig.findUnique({
      where: { customerId },
    });

    if (!config) {
      config = await this.prisma.sendDetailsConfig.create({
        data: {
          customerId,
          triggerStageKey: 'DETAILS_SENT',
          isAutomationEnabled: true,
          whatsappEnabled: true,
          emailEnabled: true,
          whatsappTemplateName: 'lead_stage_details_sent',
          emailSubject: 'Company Details & Service Information',
          emailBody: '<p>Dear {{leadName}},</p><p>Thank you for your interest in {{companyName}}. Please find attached our company profile, product catalogue, pricing, and project portfolio.</p>',
          activeCategories: [
            SendDetailsCategory.COMPANY_PROFILE,
            SendDetailsCategory.SERVICE_CATALOGUE,
            SendDetailsCategory.PRICING_QUOTATION,
            SendDetailsCategory.PACKAGES_PLANS,
            SendDetailsCategory.PORTFOLIO_PROJECTS,
          ],
        },
      });
    }

    return config;
  }

  /**
   * Updates customer configuration.
   */
  async updateConfig(customerId: number, dto: UpdateSendDetailsConfigDto) {
    const existing = await this.getConfig(customerId);

    return this.prisma.sendDetailsConfig.update({
      where: { id: existing.id },
      data: {
        isAutomationEnabled: dto.isAutomationEnabled !== undefined ? dto.isAutomationEnabled : existing.isAutomationEnabled,
        whatsappEnabled: dto.whatsappEnabled !== undefined ? dto.whatsappEnabled : existing.whatsappEnabled,
        emailEnabled: dto.emailEnabled !== undefined ? dto.emailEnabled : existing.emailEnabled,
        whatsappTemplateName: dto.whatsappTemplateName ?? existing.whatsappTemplateName,
        emailSubject: dto.emailSubject ?? existing.emailSubject,
        emailBody: dto.emailBody ?? existing.emailBody,
        activeCategories: dto.activeCategories ?? (existing.activeCategories as any),
      },
    });
  }

  /**
   * Triggers automatic Send Details delivery upon stage transition to "Details Sent".
   */
  async triggerAutomaticSendDetails(
    customerId: number,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number,
  ) {
    this.logger.log(`[SEND_DETAILS] Automatic trigger initiated for Lead #${lead.id} (${previousStageName} -> ${newStageName})`);

    const config = await this.getConfig(customerId);
    if (!config.isAutomationEnabled) {
      this.logger.log(`[SEND_DETAILS] Automation is disabled for customer #${customerId}. Skipping.`);
      return { skipped: true, reason: 'AUTOMATION_DISABLED' };
    }

    // Idempotency check: don't double send if triggered in the last 2 minutes for this lead
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const existingRecent = await this.prisma.sendDetailsDelivery.findFirst({
      where: {
        leadId: lead.id,
        createdAt: { gte: twoMinutesAgo },
        triggerType: 'AUTOMATIC',
      },
    });
    if (existingRecent) {
      this.logger.warn(`[SEND_DETAILS] Duplicate trigger throttled for Lead #${lead.id} (delivery #${existingRecent.id} recent)`);
      return { skipped: true, reason: 'DUPLICATE_THROTTLED', deliveryId: existingRecent.id };
    }

    // Fetch documents
    const documents = await this.prisma.sendDetailsDocument.findMany({
      where: { customerId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    const channels: ('WHATSAPP' | 'EMAIL')[] = [];
    if (config.whatsappEnabled) channels.push('WHATSAPP');
    if (config.emailEnabled) channels.push('EMAIL');

    return this.executeDelivery({
      customerId,
      lead,
      documents,
      channels,
      triggerType: 'AUTOMATIC',
      previousStage: previousStageName,
      newStage: newStageName,
      userId,
      config,
    });
  }

  /**
   * Manual dispatch initiated by employee or admin.
   */
  async sendManual(customerId: number, leadId: number, userId: number | undefined, dto: ManualSendDetailsDto) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, customerId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const config = await this.getConfig(customerId);

    // Resolve documents
    let documents;
    if (dto.documentIds && dto.documentIds.length > 0) {
      documents = await this.prisma.sendDetailsDocument.findMany({
        where: { id: { in: dto.documentIds }, customerId, deletedAt: null },
      });
    } else {
      documents = await this.prisma.sendDetailsDocument.findMany({
        where: { customerId, isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    }

    return this.executeDelivery({
      customerId,
      lead,
      documents,
      channels: dto.channels,
      triggerType: 'MANUAL',
      userId,
      config,
      customNote: dto.customNote,
    });
  }

  /**
   * Core dispatcher handling WhatsApp & Email concurrently with independent failure isolation.
   */
  private async executeDelivery(params: {
    customerId: number;
    lead: any;
    documents: any[];
    channels: ('WHATSAPP' | 'EMAIL')[];
    triggerType: 'AUTOMATIC' | 'MANUAL' | 'RETRY';
    previousStage?: string;
    newStage?: string;
    userId?: number;
    config: any;
    customNote?: string;
    existingDeliveryId?: number;
  }) {
    const { customerId, lead, documents, channels, triggerType, previousStage, newStage, userId, config, customNote, existingDeliveryId } = params;

    const leadPhone = (lead.phone || lead.mobile || '').trim();
    const leadEmail = this.validEmail(lead.email);
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.companyName || 'Valued Customer';
    const company = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, companyName: true, phone: true, email: true },
    });
    const companyName = company?.companyName || company?.name || 'QuickBoom CRM';

    const documentsSummary = documents.map((doc) => ({
      id: doc.id,
      category: doc.category,
      title: doc.title,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
    }));
    const docIds = documents.map((d) => d.id);

    const idempotencyKey = `${triggerType.toLowerCase()}_${lead.id}_${Date.now()}`;

    // Create or find delivery record
    let delivery = existingDeliveryId
      ? await this.prisma.sendDetailsDelivery.findUnique({ where: { id: existingDeliveryId } })
      : null;

    if (!delivery) {
      delivery = await this.prisma.sendDetailsDelivery.create({
        data: {
          customerId,
          leadId: lead.id,
          userId: userId || null,
          previousStage: previousStage || null,
          newStage: newStage || null,
          triggerType,
          idempotencyKey,
          channels: channels as any,
          documentIds: docIds as any,
          documentsSummary: documentsSummary as any,
          recipientPhone: leadPhone || null,
          recipientEmail: leadEmail || null,
          whatsappStatus: channels.includes('WHATSAPP') ? 'PENDING' : 'SKIPPED',
          emailStatus: channels.includes('EMAIL') ? 'PENDING' : 'SKIPPED',
          overallStatus: 'PENDING',
        },
      });
    }

    let whatsappResult: { status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'; messageId?: string | null; error?: string | null; sentDocumentIds?: number[] } = {
      status: channels.includes('WHATSAPP') ? 'PENDING' : 'SKIPPED',
    };

    let emailResult: { status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'; messageId?: string | null; error?: string | null } = {
      status: channels.includes('EMAIL') ? 'PENDING' : 'SKIPPED',
    };

    // Parallel execution of WhatsApp and Email
    const tasks: Promise<any>[] = [];

    // WhatsApp Dispatch
    if (channels.includes('WHATSAPP')) {
      tasks.push(
        (async () => {
          if (!leadPhone) {
            whatsappResult = { status: 'FAILED', error: 'Invalid phone number. Add the lead phone with country code before retrying.' };
            return;
          }
          try {
            whatsappResult = await this.deliverWhatsAppPackage({
              leadPhone,
              leadName,
              companyName,
              lead,
              documents,
              customerId,
              userId,
              customNote,
              alreadySentIds: this.sentDocumentIds(delivery),
            });
          } catch (err: any) {
            this.logger.error(`[SEND_DETAILS] WhatsApp delivery error for lead #${lead.id}: ${err.message}`);
            whatsappResult = { status: 'FAILED', error: err.message };
          }
        })(),
      );
    }

    // Email Dispatch
    if (channels.includes('EMAIL')) {
      tasks.push(
        (async () => {
          if (!leadEmail) {
            emailResult = { status: 'SKIPPED', error: 'Email skipped – Lead email address is missing.' };
            return;
          }
          try {
            const subject = config.emailSubject || `${companyName} - Complete Business & Service Details`;

            const docListHtml = documents
              .map(
                (d) => `
              <li style="margin-bottom: 12px; padding: 10px; background: #f8fafc; border-radius: 6px; border-left: 4px solid #4F46E5;">
                <strong style="color: #1e293b;">${d.title}</strong>
                ${d.description ? `<p style="margin: 4px 0 6px 0; color: #64748b; font-size: 13px;">${d.description}</p>` : ''}
                <div>
                  <a href="${d.fileUrl}" target="_blank" style="display: inline-block; padding: 6px 14px; background: #4F46E5; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 600;">
                    View / Download ${d.fileName || 'PDF'}
                  </a>
                </div>
              </li>`,
              )
              .join('');

            const htmlBody = `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; color: #334155;">
                <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px;">
                  <h2 style="color: #0f172a; margin: 0 0 6px 0;">${companyName}</h2>
                  <p style="color: #64748b; margin: 0; font-size: 14px;">Business & Service Details Package</p>
                </div>
                
                <p>Dear <strong>${leadName}</strong>,</p>
                <p>Thank you for connecting with us. Following our recent discussion, we are excited to share our comprehensive business portfolio and service capabilities with you.</p>
                
                ${customNote ? `<div style="padding: 12px 16px; background: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 16px 0; font-size: 14px; color: #1e3a8a;">${customNote}</div>` : ''}

                <h3 style="color: #1e293b; margin: 24px 0 12px 0; font-size: 16px;">Included Documents (${documents.length}):</h3>
                <ul style="list-style: none; padding: 0; margin: 0 0 24px 0;">
                  ${docListHtml}
                </ul>

                <p style="font-size: 14px; color: #475569;">Please feel free to reply directly to this email or reach out to us if you have any questions or require tailored quotations.</p>
                
                <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
                  <p style="margin: 0;">Sent via ${companyName} CRM • Automated Details Package</p>
                </div>
              </div>
            `;

            const attachments: Array<{ filename: string; content: Buffer }> = [];
            const missingFiles: string[] = [];
            for (const document of documents) {
              const loaded = await this.loadDocumentFile(document);
              if ('buffer' in loaded) attachments.push({ filename: loaded.filename, content: loaded.buffer });
              else missingFiles.push(loaded.error);
            }

            const emailRes = await this.emailService.sendEmail(
              {
                to: leadEmail,
                subject,
                html: htmlBody,
                attachments,
              },
              { customerId, id: userId },
            );

            if (!emailRes?.messageId) {
              emailResult = { status: 'FAILED', error: 'Email provider did not confirm the message.' };
            } else {
              emailResult = {
                status: 'SENT',
                messageId: emailRes.messageId,
                error: missingFiles.length ? missingFiles.join(' ') : null,
              };
            }
          } catch (err: any) {
            this.logger.error(`[SEND_DETAILS] Email delivery error for lead #${lead.id}: ${err.message}`, err.stack);
            emailResult = { status: 'FAILED', error: err.message };
          }
        })(),
      );
    }

    if (!channels.includes('EMAIL') && !leadEmail) {
      emailResult = { status: 'SKIPPED', error: 'Email skipped – Lead email address is missing.' };
    }
    if (!channels.includes('WHATSAPP') && existingDeliveryId && delivery) {
      whatsappResult = {
        status: this.asStatus(delivery.whatsappStatus),
        messageId: delivery.whatsappMessageId,
        error: delivery.whatsappError,
      };
    }
    if (!channels.includes('EMAIL') && existingDeliveryId && delivery && leadEmail) {
      emailResult = {
        status: this.asStatus(delivery.emailStatus),
        messageId: delivery.emailMessageId,
        error: delivery.emailError,
      };
    }

    await Promise.allSettled(tasks);

    const overallStatus = this.overallStatus(whatsappResult.status, emailResult.status);

    // Update delivery record
    const updatedDelivery = await this.prisma.sendDetailsDelivery.update({
      where: { id: delivery.id },
      data: {
        whatsappStatus: whatsappResult.status,
        whatsappMessageId: whatsappResult.messageId || delivery.whatsappMessageId || null,
        whatsappError: whatsappResult.status === 'SENT' ? null : (whatsappResult.error || null),
        emailStatus: emailResult.status,
        emailMessageId: emailResult.messageId || delivery.emailMessageId || null,
        emailError: emailResult.error || null,
        channels: this.nextChannelMeta(delivery, channels, whatsappResult, emailResult, Boolean(existingDeliveryId)) as any,
        overallStatus,
        retryCount: existingDeliveryId ? { increment: 1 } : 0,
      },
    });

    // Record timeline event on the lead
    const actionLabel = triggerType === 'AUTOMATIC' ? 'AUTO_SEND_DETAILS' : 'MANUAL_SEND_DETAILS';
    const channelStatuses = `WhatsApp: ${whatsappResult.status}, Email: ${emailResult.status}`;
    await this.leadRepository.logTimeline(
      lead.id,
      actionLabel,
      `Business details package dispatched (${overallStatus}). ${channelStatuses}. Documents: ${documents.length}`,
      {
        deliveryId: updatedDelivery.id,
        channels,
        documents: documentsSummary,
        whatsappResult,
        emailResult,
        overallStatus,
      },
    );

    return updatedDelivery;
  }

  /**
   * Retries failed channel(s) for a delivery record.
   */
  async retryDelivery(customerId: number, deliveryId: number, userId: number | undefined, dto: RetryDeliveryDto) {
    const delivery = await this.prisma.sendDetailsDelivery.findFirst({
      where: { id: deliveryId, customerId },
    });
    if (!delivery) throw new NotFoundException('Delivery record not found');

    const lead = await this.prisma.lead.findFirst({
      where: { id: delivery.leadId, customerId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead associated with delivery not found');

    const config = await this.getConfig(customerId);

    // Determine which channels to retry
    const channelsToRetry: ('WHATSAPP' | 'EMAIL')[] = [];
    const targetChannel = dto.channel || 'ALL';

    if (targetChannel === 'ALL' || targetChannel === 'WHATSAPP') {
      if (delivery.whatsappStatus === 'FAILED' || (delivery.whatsappStatus === 'SKIPPED' && delivery.whatsappError)) {
        channelsToRetry.push('WHATSAPP');
      }
    }
    if (targetChannel === 'ALL' || targetChannel === 'EMAIL') {
      const emailSkipped = delivery.emailStatus === 'SKIPPED' && Boolean(delivery.emailError);
      if (delivery.emailStatus === 'FAILED' || emailSkipped) {
        if (!this.validEmail(lead.email)) {
          if (targetChannel === 'EMAIL' || channelsToRetry.length === 0) {
            throw new BadRequestException('Email skipped – Lead email address is missing.');
          }
        } else {
          channelsToRetry.push('EMAIL');
        }
      }
    }

    if (channelsToRetry.length === 0) {
      throw new BadRequestException('No failed channels available to retry for this delivery record');
    }

    // Resolve documents from saved summary or current active
    const docIds = (delivery.documentIds as number[]) || [];
    const documents = await this.prisma.sendDetailsDocument.findMany({
      where: { id: { in: docIds }, customerId, deletedAt: null },
    });

    return this.executeDelivery({
      customerId,
      lead,
      documents,
      channels: channelsToRetry,
      triggerType: 'RETRY',
      userId,
      config,
      existingDeliveryId: delivery.id,
    });
  }

  /**
   * Fetches delivery history for a lead or entire customer.
   */
  async getDeliveryHistory(customerId: number, leadId?: number) {
    const where: any = { customerId };
    if (leadId) where.leadId = leadId;

    const rows = await this.prisma.sendDetailsDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => {
      const meta = this.readMeta(row.channels);
      return {
        ...row,
        channels: meta.selected,
        whatsappRetryCount: meta.whatsappRetryCount,
        emailRetryCount: meta.emailRetryCount,
        attempts: meta.attempts,
      };
    });
  }

  private asStatus(value?: string | null): 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' {
    if (value === 'SENT' || value === 'FAILED' || value === 'SKIPPED' || value === 'PENDING') return value;
    return 'FAILED';
  }

  private validEmail(value?: string | null): string {
    const email = String(value || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  private overallStatus(whatsapp: string, email: string): 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'PENDING' {
    const statuses = [whatsapp, email];
    if (statuses.some((status) => status === 'PENDING')) return 'PENDING';
    const sent = statuses.filter((status) => status === 'SENT').length;
    const failed = statuses.filter((status) => status === 'FAILED').length;
    const skipped = statuses.filter((status) => status === 'SKIPPED').length;
    if (sent > 0 && failed === 0 && skipped === 0) return 'COMPLETED';
    if (sent > 0) return 'PARTIALLY_COMPLETED';
    if (failed > 0) return 'FAILED';
    return 'PENDING';
  }

  private readMeta(value: any) {
    const empty = { selected: [] as string[], whatsappRetryCount: 0, emailRetryCount: 0, sentDocumentIds: [] as number[], attempts: [] as any[] };
    if (Array.isArray(value)) return { ...empty, selected: value.map(String) };
    if (!value || typeof value !== 'object') return empty;
    return {
      selected: Array.isArray(value.selected) ? value.selected.map(String) : empty.selected,
      whatsappRetryCount: Number(value.whatsappRetryCount) || 0,
      emailRetryCount: Number(value.emailRetryCount) || 0,
      sentDocumentIds: Array.isArray(value.sentDocumentIds) ? value.sentDocumentIds.map(Number) : [],
      attempts: Array.isArray(value.attempts) ? value.attempts.slice(-20) : [],
    };
  }

  private sentDocumentIds(delivery: any): number[] {
    return this.readMeta(delivery?.channels).sentDocumentIds;
  }

  private nextChannelMeta(delivery: any, channels: string[], whatsappResult: any, emailResult: any, isRetry: boolean) {
    const meta = this.readMeta(delivery?.channels);
    const selected = Array.from(new Set([...(meta.selected.length ? meta.selected : channels), ...channels]));
    if (isRetry && channels.includes('WHATSAPP')) meta.whatsappRetryCount += 1;
    if (isRetry && channels.includes('EMAIL')) meta.emailRetryCount += 1;
    const sentDocumentIds = Array.from(new Set([...meta.sentDocumentIds, ...(whatsappResult.sentDocumentIds || [])]));
    const attempts = [
      ...meta.attempts,
      ...channels.map((channel) => ({
        at: new Date().toISOString(),
        channel,
        status: channel === 'WHATSAPP' ? whatsappResult.status : emailResult.status,
        error: channel === 'WHATSAPP' ? whatsappResult.error || null : emailResult.error || null,
        messageId: channel === 'WHATSAPP' ? whatsappResult.messageId || null : emailResult.messageId || null,
      })),
    ].slice(-20);
    return { selected, whatsappRetryCount: meta.whatsappRetryCount, emailRetryCount: meta.emailRetryCount, sentDocumentIds, attempts };
  }

  private async loadDocumentFile(document: any): Promise<{ buffer: Buffer; filename: string } | { error: string }> {
    const title = document?.title || 'Document';
    const filename = document?.fileName || `${title}.pdf`;
    const fileUrl = String(document?.fileUrl || '').trim();
    if (!fileUrl) return { error: `Document "${title}" has no file.` };
    if (fileUrl.startsWith('/uploads/')) {
      const fullPath = path.join(process.cwd(), fileUrl.replace(/^\/+/, ''));
      if (!fs.existsSync(fullPath)) return { error: `Document file is missing: ${title}.` };
      return { buffer: fs.readFileSync(fullPath), filename };
    }
    if (/storage\.qbapp\.online\/documents\//i.test(fileUrl)) {
      return { error: `Document "${title}" has not been uploaded. Add the PDF in Send Details before sending.` };
    }
    try {
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 8000, maxContentLength: 16 * 1024 * 1024, validateStatus: () => true });
      if (response.status >= 400 || !response.data?.byteLength) {
        return { error: `Could not download "${title}" (HTTP ${response.status}).` };
      }
      return { buffer: Buffer.from(response.data), filename };
    } catch {
      return { error: `Could not download "${title}".` };
    }
  }

  private providerReason(result: any): string {
    return result?.message || result?.providerMessage || result?.details || result?.error || result?.reason || 'WhatsApp delivery failed';
  }

  private async deliverWhatsAppPackage(params: {
    leadPhone: string;
    leadName: string;
    companyName: string;
    lead: any;
    documents: any[];
    customerId: number;
    userId?: number;
    customNote?: string;
    alreadySentIds: number[];
  }): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; messageId?: string | null; error?: string | null; sentDocumentIds?: number[] }> {
    const pending = params.documents.filter((document) => !params.alreadySentIds.includes(Number(document.id)));
    const sentDocumentIds = [...params.alreadySentIds];
    const failures: string[] = [];
    let messageId: string | null = null;

    for (const document of pending) {
      const loaded = await this.loadDocumentFile(document);
      if ('error' in loaded) {
        failures.push(loaded.error);
        continue;
      }
      const sent = await this.whatsappService.sendDocumentMessage({
        to: params.leadPhone,
        pdfBuffer: loaded.buffer,
        filename: loaded.filename,
        caption: params.customNote || `${params.companyName}: ${document.title}`,
        stageName: 'Details Sent',
        requireDocument: true,
      });
      if (sent.error === 'INVALID_PHONE' || sent.reason === 'NO_PHONE') {
        return { status: 'FAILED', error: 'Invalid phone number. Add the lead phone with country code before retrying.', sentDocumentIds };
      }
      if (sent.success && sent.messageId) {
        messageId = sent.messageId;
        sentDocumentIds.push(Number(document.id));
      } else if (sent.skipped) {
        return { status: 'SKIPPED', error: this.providerReason(sent), sentDocumentIds, messageId };
      } else {
        failures.push(`${document.title}: ${this.providerReason(sent)}`);
      }
    }

    if (!params.documents.length) {
      const template = await this.whatsappService.sendLeadStageMessage({
        to: params.leadPhone,
        stageKey: 'DETAILS_SENT',
        variables: {
          leadName: params.leadName,
          leadTitle: params.lead.companyName || params.leadName,
          companyName: params.companyName,
        },
        fallbackText: params.customNote || `Hello ${params.leadName}, ${params.companyName} shared the business details package.`,
        stageName: 'Details Sent',
        customerId: params.customerId,
        userId: params.userId,
      });
      if (template.success && template.messageId) return { status: 'SENT', messageId: template.messageId, sentDocumentIds };
      if (template.skipped) return { status: 'SKIPPED', error: this.providerReason(template), sentDocumentIds };
      return { status: 'FAILED', error: this.providerReason(template), sentDocumentIds };
    }

    if ((messageId && failures.length === 0) || (pending.length === 0 && params.alreadySentIds.length > 0 && failures.length === 0)) {
      return { status: 'SENT', messageId, sentDocumentIds };
    }

    return {
      status: 'FAILED',
      messageId,
      error: failures.join(' ') || 'WhatsApp delivery failed',
      sentDocumentIds,
    };
  }
}
