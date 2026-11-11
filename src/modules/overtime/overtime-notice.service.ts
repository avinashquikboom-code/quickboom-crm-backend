import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const TEMPLATES: Record<string, (name: string, detail: string) => { title: string; body: string }> = {
  SUBMITTED: (name, detail) => ({ title: 'Overtime request submitted', body: `Hello ${name}, your overtime request was submitted. ${detail}` }),
  RECEIVED: (name, detail) => ({ title: 'New overtime request', body: `Hello ${name}, an overtime request needs your review. ${detail}` }),
  APPROVED: (name, detail) => ({ title: 'Overtime approved', body: `Hello ${name}, your overtime request was approved. ${detail}` }),
  REJECTED: (name, detail) => ({ title: 'Overtime rejected', body: `Hello ${name}, your overtime request was rejected. ${detail}` }),
  CANCELLED: (name, detail) => ({ title: 'Overtime cancelled', body: `Hello ${name}, an overtime request was cancelled. ${detail}` }),
  ADJUSTED: (name, detail) => ({ title: 'Overtime hours adjusted', body: `Hello ${name}, the approved overtime hours were changed. ${detail}` }),
};

@Injectable()
export class OvertimeNoticeService {
  private readonly logger = new Logger(OvertimeNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
  ) {}

  async publish(customerId: number, requestId: number, eventType: string) {
    const request = await this.prisma.overtimeRequest.findFirst({
      where: { id: requestId, customerId, deletedAt: null },
      include: { employee: true },
    });
    if (!request?.employee) return;
    const detail = `${request.employee.firstName} ${request.employee.lastName} requested ${Math.round(request.totalMinutes / 60 * 100) / 100} h on ${request.overtimeDate.toISOString().slice(0, 10)} (${request.startTime}-${request.endTime}). Approved ${request.approvedMinutes ? Math.round(request.approvedMinutes / 60 * 100) / 100 : 0} h. Reason: ${request.reason}. ${request.rejectionReason ? `Rejection: ${request.rejectionReason}.` : ''} Approver: ${request.approvedByName || request.rejectedByName || 'Pending'}.`;
    const employeeUser = request.employee.userId ? await this.prisma.user.findFirst({ where: { id: request.employee.userId } }) : null;
    const managers = await this.managers(customerId, request.employeeId, request.employee.managerId);
    const targets = eventType === 'SUBMITTED'
      ? [{ event: 'SUBMITTED', person: request.employee, userId: employeeUser?.id }, ...managers.map((person) => ({ event: 'RECEIVED', person, userId: person.userId }))]
      : eventType === 'APPROVED' || eventType === 'REJECTED'
        ? [{ event: eventType, person: request.employee, userId: employeeUser?.id }]
        : [{ event: eventType, person: request.employee, userId: employeeUser?.id }, ...managers.map((person) => ({ event: eventType, person, userId: person.userId }))];
    for (const target of targets) {
      await this.deliver(customerId, request.id, request.employeeId, target.userId, target.person, target.event, detail);
    }
    if (eventType === 'APPROVED' && request.approvedMinutes && request.approvedMinutes < request.totalMinutes) {
      const adjusted = [{ person: request.employee, userId: employeeUser?.id }, ...managers.map((person) => ({ person, userId: person.userId }))];
      for (const target of adjusted) {
        await this.deliver(customerId, request.id, request.employeeId, target.userId, target.person, 'ADJUSTED', detail);
      }
    }
  }

  async list(customerId: number) {
    return this.prisma.overtimeNotificationEvent.findMany({ where: { customerId }, orderBy: { id: 'desc' }, take: 100, include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } } });
  }

  async retry(customerId: number, id: number) {
    const event = await this.prisma.overtimeNotificationEvent.findFirst({ where: { id, customerId } });
    if (!event || event.status !== 'FAILED') return { success: false, message: 'Only a failed overtime notification can be retried.' };
    await this.prisma.overtimeNotificationEvent.update({ where: { id }, data: { status: 'PENDING' } });
    const request = await this.prisma.overtimeRequest.findFirst({ where: { id: event.overtimeRequestId }, include: { employee: true } });
    const person = event.recipientUserId ? await this.prisma.employee.findFirst({ where: { userId: event.recipientUserId, customerId } }) : request?.employee;
    if (request && person) await this.sendChannel(event, person, TEMPLATES[event.eventType]?.(person.firstName, request.reason) || { title: 'Overtime update', body: request.reason });
    return { success: true, message: `${event.channel} retry completed. Other channels were not changed.` };
  }

  private async managers(customerId: number, employeeId: number, managerId?: number | null) {
    const rows = await this.prisma.employee.findMany({
      where: {
        customerId,
        OR: [
          ...(managerId ? [{ id: managerId }] : []),
          { ledTeams: { some: { members: { some: { employeeId } } } } },
        ],
      },
    });
    return rows.filter((row) => row.id !== employeeId);
  }

  private async deliver(customerId: number, requestId: number, employeeId: number, userId: number | null | undefined, person: { id?: number; firstName: string; email?: string | null; phone?: string | null; whatsappReportsOptIn?: boolean }, eventType: string, detail: string) {
    const message = TEMPLATES[eventType]?.(person.firstName, detail) || { title: 'Overtime update', body: detail };
    for (const channel of ['IN_APP', 'EMAIL', 'WHATSAPP'] as const) {
      const key = `ot:${requestId}:${eventType}:${userId || person.id || 0}:${channel}`;
      const existing = await this.prisma.overtimeNotificationEvent.findUnique({ where: { idempotencyKey: key } });
      if (existing && ['SENT', 'DELIVERED', 'SKIPPED'].includes(existing.status)) continue;
      const row = existing || await this.prisma.overtimeNotificationEvent.create({
        data: { customerId, overtimeRequestId: requestId, employeeId, recipientUserId: userId || null, eventType, channel, idempotencyKey: key, status: 'PROCESSING', updatedAt: new Date() },
      });
      await this.sendChannel(row, { ...person, userId }, message);
    }
  }

  private async sendChannel(row: { id: number; channel: string; eventType: string; recipientUserId?: number | null; customerId: number }, person: { userId?: number | null; firstName: string; email?: string | null; phone?: string | null; whatsappReportsOptIn?: boolean }, message: { title: string; body: string }) {
    try {
      if (row.channel === 'IN_APP') {
        if (!row.recipientUserId) return this.finish(row.id, 'SKIPPED', 'No user account for in-app notification');
        await this.prisma.notification.create({ data: { customerId: row.customerId, userId: row.recipientUserId, title: message.title, message: message.body, type: `OVERTIME_${row.eventType}`, data: { overtimeNotificationEventId: row.id } } });
        return this.finish(row.id, 'SENT');
      }
      if (row.channel === 'EMAIL') {
        if (!person.email) return this.finish(row.id, 'SKIPPED', 'Email address is missing');
        await this.emailService?.sendEmail({ to: person.email, subject: message.title, text: message.body });
        return this.finish(row.id, 'SENT');
      }
      if (!person.whatsappReportsOptIn) return this.finish(row.id, 'SKIPPED', 'Employee has not opted in to WhatsApp');
      if (!person.phone) return this.finish(row.id, 'SKIPPED', 'Phone number is missing');
      const template = {
        SUBMITTED: 'overtime_request_submitted',
        RECEIVED: 'overtime_request_received',
        APPROVED: 'overtime_approved',
        REJECTED: 'overtime_rejected',
        CANCELLED: 'overtime_cancelled',
        ADJUSTED: 'overtime_hours_adjusted',
      }[row.eventType] || 'overtime_request_submitted';
      const result = await this.whatsappService?.sendTemplate(person.phone, template, [{ type: 'text', text: message.body.slice(0, 900) }], 'en', `${message.title}. ${message.body}`);
      if (!result || result.skipped) return this.finish(row.id, 'SKIPPED', result?.reason || 'WhatsApp is not configured');
      if (!result.success) return this.finish(row.id, 'FAILED', result.error || 'WhatsApp delivery failed');
      return this.finish(row.id, 'SENT', null, result.messageId);
    } catch (error) {
      this.logger.warn(`Overtime ${row.channel} notice failed: ${error instanceof Error ? error.message : error}`);
      return this.finish(row.id, 'FAILED', error instanceof Error ? error.message : 'Delivery failed');
    }
  }

  private finish(id: number, status: string, error?: string | null, messageId?: string) {
    return this.prisma.overtimeNotificationEvent.update({
      where: { id },
      data: { status, lastError: error || null, providerMessageId: messageId || null, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
  }
}
