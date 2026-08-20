import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CheckDuplicateDto,
  CreateLeadDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  StartWorkDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { LeadStatus } from '@prisma/client';

@Injectable()
export class LeadRepository {
  constructor(private prisma: PrismaService) {}

  async create(customerId: string, createdById: string, dto: CreateLeadDto) {
    const status = dto.status || LeadStatus.NEW;
    const lead = await this.prisma.lead.create({
      data: {
        ...dto,
        status,
        customerId,
        createdById,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Record initial status history
    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        fromStatus: null,
        toStatus: status,
        changedById: createdById,
        notes: `Lead created via ${dto.source || 'WEBSITE'}`,
      },
    });

    return lead;
  }

  async checkDuplicate(customerId: string, dto: CheckDuplicateDto) {
    const normPhone = (dto.phone || '').replace(/\D/g, '');
    const cleanCompany = (dto.companyName || '').toLowerCase().trim();
    const cleanWebsite = (dto.website || '').toLowerCase().trim().replace(/^https?:\/\//, '');

    const candidates = await this.prisma.lead.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        title: true,
        companyName: true,
        firstName: true,
        lastName: true,
        phone: true,
        website: true,
        status: true,
        createdAt: true,
      },
    });

    for (const lead of candidates) {
      const leadPhone = (lead.phone || '').replace(/\D/g, '');
      const leadCompany = (lead.companyName || lead.title || '').toLowerCase().trim();
      const leadWebsite = (lead.website || '').toLowerCase().trim().replace(/^https?:\/\//, '');

      const isPhoneMatch = normPhone.length >= 7 && leadPhone.length >= 7 && normPhone === leadPhone;
      const isCompanyMatch = cleanCompany.length >= 3 && leadCompany === cleanCompany;
      const isWebsiteMatch = cleanWebsite.length >= 4 && leadWebsite === cleanWebsite;

      if (isPhoneMatch || isCompanyMatch || isWebsiteMatch) {
        return {
          isDuplicate: true,
          matchReason: isPhoneMatch
            ? 'Phone number match'
            : isCompanyMatch
            ? 'Company name match'
            : 'Website match',
          existingLead: lead,
        };
      }
    }

    return {
      isDuplicate: false,
      matchReason: null,
      existingLead: null,
    };
  }

  async findAll(customerId: string, options: { page?: number; limit?: number; search?: string; status?: string }) {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      customerId,
      deletedAt: null,
    };

    if (options.status) {
      where.status = options.status as LeadStatus;
    }

    if (options.search) {
      where.OR = [
        { title: { contains: options.search, mode: 'insensitive' } },
        { firstName: { contains: options.search, mode: 'insensitive' } },
        { lastName: { contains: options.search, mode: 'insensitive' } },
        { email: { contains: options.search, mode: 'insensitive' } },
        { phone: { contains: options.search, mode: 'insensitive' } },
        { companyName: { contains: options.search, mode: 'insensitive' } },
        { city: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(customerId: string, id: string) {
    return this.prisma.lead.findFirst({
      where: { id, customerId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        timeline: { orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        reminders: { orderBy: { remindAt: 'asc' } },
        visits: { orderBy: { createdAt: 'desc' } },
        quotations: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async update(customerId: string, id: string, dto: UpdateLeadDto) {
    return this.prisma.lead.updateMany({
      where: { id, customerId, deletedAt: null },
      data: dto,
    });
  }

  async updateStatus(
    customerId: string,
    id: string,
    fromStatus: LeadStatus | null,
    toStatus: LeadStatus,
    userId: string,
    notes?: string,
  ) {
    await this.prisma.lead.update({
      where: { id },
      data: { status: toStatus },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: id,
        fromStatus,
        toStatus,
        changedById: userId,
        notes: notes || `Stage transitioned from ${fromStatus || 'N/A'} to ${toStatus}`,
      },
    });

    await this.logTimeline(
      id,
      'STATUS_CHANGED',
      `Stage updated to ${toStatus}${notes ? ` (${notes})` : ''}`,
      { fromStatus, toStatus },
    );
  }

  async softDelete(customerId: string, id: string) {
    return this.prisma.lead.updateMany({
      where: { id, customerId },
      data: { deletedAt: new Date() },
    });
  }

  async addNote(leadId: string, userId: string, content: string) {
    return this.prisma.leadNote.create({
      data: { leadId, userId, content },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async logTimeline(leadId: string, action: string, description: string, metadata?: any) {
    return this.prisma.leadActivityTimeline.create({
      data: { leadId, action, description, metadata },
    });
  }

  async logFollowUp(customerId: string, leadId: string, userId: string, dto: LogFollowUpDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const nextDate = dto.nextFollowUpDate ? new Date(dto.nextFollowUpDate) : null;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.FOLLOW_UP,
        nextFollowUpDate: nextDate,
        nextFollowUpTime: dto.nextFollowUpTime,
      },
    });

    if (lead.status !== LeadStatus.FOLLOW_UP) {
      await this.prisma.leadStatusHistory.create({
        data: {
          leadId,
          fromStatus: lead.status,
          toStatus: LeadStatus.FOLLOW_UP,
          changedById: userId,
          notes: `Follow-up call logged: ${dto.outcome}`,
        },
      });
    }

    await this.logTimeline(
      leadId,
      'FOLLOW_UP_CALL',
      `Follow-up Call: Outcome: "${dto.outcome}"${dto.notes ? ` - ${dto.notes}` : ''}`,
      {
        outcome: dto.outcome,
        notes: dto.notes,
        nextFollowUpDate: dto.nextFollowUpDate,
        nextFollowUpTime: dto.nextFollowUpTime,
      },
    );

    return this.findOne(customerId, leadId);
  }

  async manageVisit(customerId: string, leadId: string, userId: string, dto: ManageVisitDto) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) return null;

    // Find employee linked to user, or fallback
    const employee = await this.prisma.employee.findFirst({
      where: { customerId, userId },
    });
    const employeeId = employee?.id || lead.assignedToId || userId;

    if (dto.action === 'SCHEDULE') {
      const visitDate = dto.date ? new Date(dto.date) : new Date();
      const createdVisit = await this.prisma.visit.create({
        data: {
          customerId,
          leadId,
          employeeId: employee?.id || (await this.getOrCreateFallbackEmployee(customerId, userId)),
          customerName: lead.companyName || `${lead.firstName} ${lead.lastName}`,
          purpose: dto.purpose || 'Client Meeting & Demo',
          date: visitDate,
          time: dto.time || '11:00 AM',
          location: dto.location || lead.address || 'Client Site',
          status: 'SCHEDULED',
          notes: dto.notes,
        },
      });

      await this.logTimeline(
        leadId,
        'VISIT_SCHEDULED',
        `Field Visit Scheduled for ${dto.date || 'today'} at ${dto.time || '11:00 AM'} - ${dto.purpose || 'Client Demo'}`,
        { visitId: createdVisit.id, location: dto.location },
      );
    } else if (dto.action === 'START') {
      const visit = await this.prisma.visit.findFirst({
        where: { leadId, status: 'SCHEDULED' },
        orderBy: { createdAt: 'desc' },
      });

      if (visit) {
        await this.prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            latitude: dto.latitude,
            longitude: dto.longitude,
          },
        });
      }

      await this.logTimeline(
        leadId,
        'VISIT_STARTED',
        `Field Visit Started. GPS Coordinates: (${dto.latitude?.toFixed(4) || 'N/A'}, ${dto.longitude?.toFixed(4) || 'N/A'})`,
        { latitude: dto.latitude, longitude: dto.longitude },
      );
    } else if (dto.action === 'COMPLETE') {
      const visit = await this.prisma.visit.findFirst({
        where: { leadId, status: { in: ['IN_PROGRESS', 'SCHEDULED'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (visit) {
        await this.prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            notes: dto.notes || dto.summary,
          },
        });
      }

      await this.updateStatus(
        customerId,
        leadId,
        lead.status,
        LeadStatus.VISIT,
        userId,
        `Visit completed: ${dto.summary || 'Successful discussion'}`,
      );

      await this.logTimeline(
        leadId,
        'VISIT_COMPLETED',
        `Field Visit Completed. Summary: ${dto.summary || 'Demo completed'} | Customer Response: ${dto.customerResponse || 'Positive'}`,
        { summary: dto.summary, customerResponse: dto.customerResponse, notes: dto.notes },
      );
    }

    return this.findOne(customerId, leadId);
  }

  async createProposal(customerId: string, leadId: string, userId: string, dto: CreateProposalDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const propNo = dto.proposalNo || `PROP-${Date.now().toString().slice(-6)}`;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : new Date(Date.now() + 30 * 86400000);

    const quotation = await this.prisma.quotation.create({
      data: {
        customerId,
        leadId,
        quotationNo: propNo,
        status: 'SENT',
        subTotal: dto.subTotal,
        taxAmount: dto.taxAmount,
        discount: dto.discount || 0,
        totalAmount: dto.totalAmount,
        validUntil,
        notes: dto.notes,
      },
    });

    // Update lead value
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        value: dto.totalAmount,
        status: LeadStatus.PROPOSAL,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.PROPOSAL,
        changedById: userId,
        notes: `Commercial proposal ${propNo} for ₹${dto.totalAmount.toLocaleString('en-IN')} sent.`,
      },
    });

    await this.logTimeline(
      leadId,
      'PROPOSAL_SENT',
      `Proposal #${propNo} Sent. Total: ₹${dto.totalAmount.toLocaleString('en-IN')} (Tax: ₹${dto.taxAmount.toLocaleString('en-IN')})`,
      { proposalNo: propNo, totalAmount: dto.totalAmount, quotationId: quotation.id },
    );

    return this.findOne(customerId, leadId);
  }

  async recordFinalCall(customerId: string, leadId: string, userId: string, dto: FinalCallDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const isAccepted = dto.customerResponse.toLowerCase().includes('accept');
    const targetStatus = isAccepted ? LeadStatus.PAYMENT : LeadStatus.FINAL_CALL;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: targetStatus,
        nextFollowUpDate: dto.expectedClosingDate ? new Date(dto.expectedClosingDate) : undefined,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: targetStatus,
        changedById: userId,
        notes: `Final negotiation call: ${dto.customerResponse}`,
      },
    });

    await this.logTimeline(
      leadId,
      'FINAL_CALL',
      `Final Call Logged. Response: "${dto.customerResponse}"${dto.negotiationNotes ? ` | Notes: ${dto.negotiationNotes}` : ''}`,
      {
        customerResponse: dto.customerResponse,
        negotiationNotes: dto.negotiationNotes,
        expectedClosingDate: dto.expectedClosingDate,
        proposalAmount: dto.proposalAmount,
      },
    );

    return this.findOne(customerId, leadId);
  }

  async recordPayment(customerId: string, leadId: string, userId: string, dto: RecordPaymentDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        paidAmount: dto.paidAmount,
        paymentStatus: dto.status,
        paymentMethod: dto.paymentMethod,
        paymentRef: dto.transactionRef,
        status: LeadStatus.PAYMENT,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.PAYMENT,
        changedById: userId,
        notes: `Payment recorded: ₹${dto.paidAmount.toLocaleString('en-IN')} (${dto.paymentMethod}, Ref: ${dto.transactionRef || 'N/A'}) - Status: ${dto.status}`,
      },
    });

    await this.logTimeline(
      leadId,
      'PAYMENT_RECEIVED',
      `Payment Received: ₹${dto.paidAmount.toLocaleString('en-IN')} of ₹${dto.totalAmount.toLocaleString('en-IN')} via ${dto.paymentMethod}. Status: ${dto.status}`,
      {
        paidAmount: dto.paidAmount,
        totalAmount: dto.totalAmount,
        paymentMethod: dto.paymentMethod,
        transactionRef: dto.transactionRef,
        status: dto.status,
      },
    );

    return this.findOne(customerId, leadId);
  }

  async startWork(customerId: string, leadId: string, userId: string, dto: StartWorkDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const startDate = dto.workStartDate ? new Date(dto.workStartDate) : new Date();

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.WORK_STARTED,
        workStartDate: startDate,
        assignedTeam: dto.assignedTeam,
        workNotes: dto.notes,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.WORK_STARTED,
        changedById: userId,
        notes: `Work officially started. Assigned Team: ${dto.assignedTeam || 'Default Team'}`,
      },
    });

    await this.logTimeline(
      leadId,
      'WORK_STARTED',
      `Work Started on ${dto.workStartDate}. Assigned Team: "${dto.assignedTeam || 'Execution Team'}"${dto.notes ? ` - ${dto.notes}` : ''}`,
      {
        workStartDate: dto.workStartDate,
        assignedTeam: dto.assignedTeam,
        notes: dto.notes,
      },
    );

    return this.findOne(customerId, leadId);
  }

  private async getOrCreateFallbackEmployee(customerId: string, userId: string): Promise<string> {
    const existing = await this.prisma.employee.findFirst({ where: { customerId } });
    if (existing) return existing.id;

    const fallback = await this.prisma.employee.create({
      data: {
        customerId,
        employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
        firstName: 'CRM',
        lastName: 'Executive',
        email: `rep_${Date.now()}@quikboom.com`,
      },
    });
    return fallback.id;
  }
}
