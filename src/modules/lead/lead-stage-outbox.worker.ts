import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadService } from './lead.service';
import { LeadStageEmailDeliveryService } from './lead-stage-email-delivery.service';
import { LeadStageWhatsappDeliveryService } from './lead-stage-whatsapp-delivery.service';
import { tenantLeadStageScope } from './lead-stage-automation.util';

/** PostgreSQL delivery rows are the queue. A claim is atomic across instances. */
@Injectable()
export class LeadStageOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadStageOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private readonly interval = Math.max(1000, Number(process.env.STAGE_OUTBOX_POLL_MS) || 5000);
  private readonly maxAttempts = Math.max(1, Number(process.env.STAGE_OUTBOX_MAX_ATTEMPTS) || 3);
  private readonly retryDelay = Math.max(1000, Number(process.env.STAGE_OUTBOX_RETRY_DELAY_MS) || 30000);
  private readonly maxDelay = Math.max(this.retryDelay, Number(process.env.STAGE_OUTBOX_MAX_RETRY_DELAY_MS) || 900000);
  private readonly lease = Math.max(60000, Number(process.env.STAGE_OUTBOX_LEASE_MS) || 900000);
  constructor(private readonly prisma: PrismaService, private readonly lead: LeadService,
    private readonly email: LeadStageEmailDeliveryService, private readonly whatsapp: LeadStageWhatsappDeliveryService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.STAGE_OUTBOX_ENABLED === 'false') return;
    this.timer = setInterval(() => this.kick(), this.interval);
    this.kick();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  private kick() {
    if (this.stopping || this.running) return;
    this.running = this.runOnce().catch(e => this.logger.error(`Outbox poll failed: ${e?.message}`))
      .finally(() => { this.running = undefined; });
  }
  async runOnce() {
    const cutoff = new Date(Date.now() - this.lease);
    // A provider may have accepted the request before a crash. Never resend a
    // stale claim automatically; an operator must reconcile that outcome.
    for (const table of [this.prisma.leadStageEmailDelivery, this.prisma.leadStageWhatsAppDelivery] as any[]) {
      await table.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
        data: { status: 'RECONCILIATION_REQUIRED', error: 'Delivery outcome is unknown after worker interruption. Reconcile with the provider before retrying.' } });
    }
    const [emails, messages] = await Promise.all([
      this.prisma.leadStageEmailDelivery.findMany({ where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, orderBy: { createdAt: 'asc' }, take: 25 }),
      this.prisma.leadStageWhatsAppDelivery.findMany({ where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, orderBy: { createdAt: 'asc' }, take: 25 }),
    ]);
    await Promise.allSettled([
      ...emails.map(row => this.process('EMAIL', row)),
      ...messages.map(row => this.process('WHATSAPP', row)),
    ]);
  }
  async process(channel: 'EMAIL' | 'WHATSAPP', row: any) {
    const service = channel === 'EMAIL' ? this.email : this.whatsapp;
    if (!await service.claimQueued(row.id)) return;
    try {
      const stage = row.newStageId == null ? null : await this.prisma.leadStage.findFirst({
        where: { id: row.newStageId, deletedAt: null, ...tenantLeadStageScope(row.customerId) },
      });
      const currentTemplate = channel === 'EMAIL' ? stage?.emailTemplateId : stage?.whatsappTemplateId;
      const recordedTemplate = channel === 'EMAIL' ? row.emailTemplateId : row.metaTemplateId;
      const currentMapping = channel === 'EMAIL' ? stage?.emailVariableMapping : stage?.whatsappVariableMapping;
      if (!stage || (currentTemplate ?? null) !== (recordedTemplate ?? null) ||
          JSON.stringify(currentMapping ?? null) !== JSON.stringify(row.variableMapping ?? null)) {
        await service.markResult(row.id, { status: 'SKIPPED', error: 'Stage or its template mapping changed after the transition; review configuration.' });
        return;
      }
      const lead = await this.lead.getLeadById(row.customerId, row.leadId);
      const result = channel === 'EMAIL'
        ? await this.lead.handleLeadStageChangeNotification(row.customerId, lead, row.previousStage || 'Previous', row.newStage || stage.name, row.userId, undefined, undefined, undefined, 'LEAD_STAGE_CHANGED', row.newStageId, row.previousStageId, row.id, true)
        : await this.lead.handleLeadStageChangeWhatsappNotification(row.customerId, lead, row.previousStage || 'Previous', row.newStage || stage.name, row.userId, undefined, undefined, 'LEAD_STAGE_CHANGED', row.newStageId, undefined, row.previousStageId, row.id, true);
      const error = result.error || (result.status !== 'SENT' ? result.message : null);
      const table: any = channel === 'EMAIL' ? this.prisma.leadStageEmailDelivery : this.prisma.leadStageWhatsAppDelivery;
      let status = result.status;
      let nextAttemptAt: Date | null = null;
      if (result.status === 'FAILED') {
        if (result.stageProviderOutcome === 'RETRYABLE_REJECTION' && row.attemptCount + 1 < this.maxAttempts) {
          status = 'QUEUED' as any;
          nextAttemptAt = new Date(Date.now() + Math.min(this.maxDelay, this.retryDelay * 2 ** row.attemptCount));
        } else if (result.stageProviderOutcome !== 'DEFINITE_REJECTION' && result.stageProviderOutcome !== 'RETRYABLE_REJECTION') {
          status = 'RECONCILIATION_REQUIRED' as any;
        }
      }
      const messageField = channel === 'EMAIL' ? 'providerMessageId' : 'metaMessageId';
      // Never overwrite a webhook, another attempt, or a stale-lease recovery.
      await table.updateMany({ where: { id: row.id,
          status: result.status === 'SENT' && result.messageId ? { in: ['PROCESSING', 'RECONCILIATION_REQUIRED'] } : 'PROCESSING',
          attemptCount: row.attemptCount + 1 },
        data: { status, nextAttemptAt, error, ...(result.messageId ? { [messageField]: result.messageId } : {}) } });
      this.logger.log(JSON.stringify({ event: 'stage_delivery', channel, leadId: row.leadId, deliveryId: row.id, attempt: row.attemptCount + 1, status }));
    } catch (e: any) {
      const table: any = channel === 'EMAIL' ? this.prisma.leadStageEmailDelivery : this.prisma.leadStageWhatsAppDelivery;
      await table.updateMany({ where: { id: row.id, status: 'PROCESSING' }, data: { status: 'RECONCILIATION_REQUIRED', error: 'Worker interrupted; provider outcome needs reconciliation.' } });
      this.logger.error(`Stage delivery needs reconciliation: channel=${channel} leadId=${row.leadId} deliveryId=${row.id} error=${e?.message}`);
    }
  }
}
