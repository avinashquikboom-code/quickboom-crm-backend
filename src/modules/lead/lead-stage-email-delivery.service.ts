import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildStageAutomationIdempotencyKey } from './lead-stage-automation.util';

const TERMINAL_SUCCESS = new Set(['SENT', 'DELIVERED']);
const IN_FLIGHT = new Set(['QUEUED', 'PROCESSING', ...TERMINAL_SUCCESS]);

@Injectable()
export class LeadStageEmailDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  buildKey(params: {
    customerId: number | string;
    leadId: number | string;
    previousStageId?: number | null;
    nextStageId?: number | null;
    templateId?: number | string | null;
  }) {
    return buildStageAutomationIdempotencyKey({ ...params, channel: 'EMAIL' });
  }

  async findByIdempotency(idempotencyKey: string) {
    return this.prisma.leadStageEmailDelivery.findUnique({ where: { idempotencyKey } }).catch(() => null);
  }

  async findForLead(customerId: number, leadId: number, deliveryId: number) {
    return this.prisma.leadStageEmailDelivery.findFirst({
      where: { id: deliveryId, customerId, leadId },
    });
  }

  async shouldSkipDuplicate(existing: { status: string; providerMessageId?: string | null } | null) {
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
    emailTemplateId?: number | null;
    templateName?: string | null;
    recipientEmail?: string | null;
    triggerSource?: string;
    idempotencyKey: string;
    variableMapping?: Record<string, unknown> | null;
  }) {
    const existing = await this.findByIdempotency(params.idempotencyKey);
    if (existing) {
      return existing;
    }
    return this.prisma.leadStageEmailDelivery.upsert({
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
        emailTemplateId: params.emailTemplateId ?? null,
        templateName: params.templateName ?? null,
        recipientEmail: params.recipientEmail ?? null,
        triggerSource: params.triggerSource || 'STAGE_CHANGE',
        idempotencyKey: params.idempotencyKey,
        status: 'QUEUED',
        variableMapping: (params.variableMapping ?? undefined) as Prisma.InputJsonValue | undefined,
        attemptCount: 0,
      },
    });
  }

  async markProcessing(id: number) {
    return this.prisma.leadStageEmailDelivery.update({
      where: { id },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
  }

  async claimQueued(id: number) {
    const result = await this.prisma.leadStageEmailDelivery.updateMany({
      where: { id, status: 'QUEUED', providerMessageId: null },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  async markResult(
    id: number,
    result: {
      status: 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED';
      providerMessageId?: string | null;
      error?: string | null;
    },
  ) {
    return this.prisma.leadStageEmailDelivery.update({
      where: { id },
      data: {
        status: result.status,
        providerMessageId: result.providerMessageId ?? undefined,
        error: result.error ?? null,
        updatedAt: new Date(),
      },
    });
  }

  async listForLead(customerId: number, leadId: number) {
    return this.prisma.leadStageEmailDelivery.findMany({
      where: { customerId, leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async retry(customerId: number, leadId: number, deliveryId: number) {
    const row = await this.prisma.leadStageEmailDelivery.findFirst({
      where: { id: deliveryId, customerId, leadId },
    });
    if (!row) throw new NotFoundException('Stage email delivery record not found.');
    if (row.providerMessageId || !['FAILED', 'SKIPPED'].includes(String(row.status).toUpperCase())) {
      throw new BadRequestException('Only failed or skipped deliveries can be retried.');
    }
    const claimed = await this.prisma.leadStageEmailDelivery.updateMany({
      where: { id: row.id, status: row.status, attemptCount: row.attemptCount, providerMessageId: null },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('A retry is already in progress.');
    return row;
  }
}
