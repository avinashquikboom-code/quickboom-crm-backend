import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildStageAutomationIdempotencyKey } from './lead-stage-automation.util';

const TERMINAL_SUCCESS = new Set(['SENT', 'DELIVERED', 'READ']);
const IN_FLIGHT = new Set(['QUEUED', 'PROCESSING', ...TERMINAL_SUCCESS]);

@Injectable()
export class LeadStageWhatsappDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  buildKey(params: {
    customerId: number | string;
    leadId: number | string;
    previousStageId?: number | null;
    nextStageId?: number | null;
    templateId?: number | string | null;
  }) {
    return buildStageAutomationIdempotencyKey({ ...params, channel: 'WHATSAPP' });
  }

  async findByIdempotency(idempotencyKey: string) {
    return this.prisma.leadStageWhatsAppDelivery.findUnique({ where: { idempotencyKey } }).catch(() => null);
  }

  async findForLead(customerId: number, leadId: number, deliveryId: number) {
    return this.prisma.leadStageWhatsAppDelivery.findFirst({
      where: { id: deliveryId, customerId, leadId },
    });
  }

  async shouldSkipDuplicate(existing: { status: string; metaMessageId?: string | null } | null) {
    if (!existing) return false;
    return IN_FLIGHT.has(String(existing.status || '').toUpperCase());
  }

  async upsertQueued(params: {
    customerId: number;
    leadId: number;
    userId?: number | null;
    previousStageId?: number | null;
    newStageId?: number | null;
    previousStage?: string | null;
    newStage?: string | null;
    metaTemplateId?: number | null;
    templateName?: string | null;
    recipientPhone?: string | null;
    triggerSource?: string;
    idempotencyKey: string;
    variableMapping?: Record<string, unknown> | null;
  }) {
    const existing = await this.findByIdempotency(params.idempotencyKey);
    if (existing) {
      return existing;
    }
    return this.prisma.leadStageWhatsAppDelivery.upsert({
      where: { idempotencyKey: params.idempotencyKey },
      update: {},
      create: {
        customerId: params.customerId,
        leadId: params.leadId,
        userId: params.userId ?? null,
        previousStageId: params.previousStageId ?? null,
        newStageId: params.newStageId ?? null,
        previousStage: params.previousStage ?? null,
        newStage: params.newStage ?? null,
        metaTemplateId: params.metaTemplateId ?? null,
        templateName: params.templateName ?? null,
        recipientPhone: params.recipientPhone ?? null,
        triggerSource: params.triggerSource || 'STAGE_CHANGE',
        idempotencyKey: params.idempotencyKey,
        status: 'QUEUED',
        variableMapping: (params.variableMapping ?? undefined) as Prisma.InputJsonValue | undefined,
        attemptCount: 0,
      },
    });
  }

  async markProcessing(id: number) {
    return this.prisma.leadStageWhatsAppDelivery.update({
      where: { id },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
  }

  async claimQueued(id: number) {
    const result = await this.prisma.leadStageWhatsAppDelivery.updateMany({
      where: { id, status: 'QUEUED', metaMessageId: null },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  async markResult(
    id: number,
    result: {
      status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';
      metaMessageId?: string | null;
      error?: string | null;
    },
  ) {
    return this.prisma.leadStageWhatsAppDelivery.update({
      where: { id },
      data: {
        status: result.status,
        metaMessageId: result.metaMessageId ?? undefined,
        error: result.error ?? null,
        updatedAt: new Date(),
      },
    });
  }

  async listForLead(customerId: number, leadId: number) {
    return this.prisma.leadStageWhatsAppDelivery.findMany({
      where: { customerId, leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async retry(customerId: number, leadId: number, deliveryId: number) {
    const row = await this.prisma.leadStageWhatsAppDelivery.findFirst({
      where: { id: deliveryId, customerId, leadId },
    });
    if (!row) throw new NotFoundException('Stage WhatsApp delivery record not found.');
    if (row.metaMessageId || !['FAILED', 'SKIPPED'].includes(String(row.status).toUpperCase())) {
      throw new BadRequestException('Only failed or skipped deliveries can be retried.');
    }
    const claimed = await this.prisma.leadStageWhatsAppDelivery.updateMany({
      where: { id: row.id, status: row.status, attemptCount: row.attemptCount, metaMessageId: null },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('A retry is already in progress.');
    return row;
  }

  async applyWebhookStatus(metaMessageId: string, status: string) {
    const mapped = String(status || '').toUpperCase();
    if (!metaMessageId || !mapped) return;
    const allowed = ['SENT', 'DELIVERED', 'READ', 'FAILED'];
    if (!allowed.includes(mapped)) return;
    await this.prisma.leadStageWhatsAppDelivery.updateMany({
      where: {
        metaMessageId,
        // Meta may deliver events out of order. Do not downgrade READ/DELIVERED.
        status: { in: mapped === 'READ' ? ['QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED']
          : mapped === 'DELIVERED' ? ['QUEUED', 'PROCESSING', 'SENT', 'FAILED']
          : ['QUEUED', 'PROCESSING', 'SENT'] },
      },
      data: { status: mapped, updatedAt: new Date() },
    });
  }
}
