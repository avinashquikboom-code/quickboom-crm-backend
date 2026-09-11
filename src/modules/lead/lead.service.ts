import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import {
  CheckDuplicateDto,
  ConvertLeadDto,
  CreateLeadDto,
  CreateLeadNoteDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStatusDto,
} from './dto/lead.dto';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';

@Injectable()
export class LeadService {
  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly prisma: PrismaService,
    private readonly planAccessService?: PlanAccessService,
    private readonly leadLimitService?: LeadLimitService,
  ) {}

  async getSummaryMetrics(customerId: number | string | undefined, user?: any) {
    return this.leadRepository.getSummaryMetrics(customerId, user);
  }

  async convertLead(customerId: number | string, leadId: number | string, userId: number | string, dto: ConvertLeadDto) {
    return this.leadRepository.convertLead(customerId, leadId, userId, dto);
  }

  async createLead(customerId: number | string, userOrId: any, dto: CreateLeadDto) {
    if (this.planAccessService) {
      await this.planAccessService.checkLeadLimit(customerId);
    }

    const user = typeof userOrId === 'object' ? userOrId : { id: userOrId };
    const userId = Number(user.id);

    // Concurrency-safe atomic check and lead creation within a transaction
    const lead = await this.prisma.$transaction(async (tx) => {
      let employeeId: number | null = null;
      if (this.leadLimitService) {
        const limitRes = await this.leadLimitService.validateAndConsumeLeadLimit(tx, customerId, user);
        employeeId = limitRes.employeeId;
      }
      return this.leadRepository.create(customerId, userId, dto, employeeId, tx);
    });

    await this.leadRepository.logTimeline(
      lead.id,
      'LEAD_CREATED',
      `Lead "${lead.title}" was created via ${dto.source || 'WEBSITE'}`,
      { source: dto.source, value: dto.value },
    );
    return lead;
  }

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateDto) {
    return this.leadRepository.checkDuplicate(customerId, dto);
  }

  getStages() {
    return [
      { key: 'NEW', label: 'New', sortOrder: 0, color: '#0284C7', bgColor: '#E0F2FE', borderColor: '#BAE6FD' },
      { key: 'CONTACTED', label: 'Contacted', sortOrder: 1, color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A' },
      { key: 'FOLLOW_UP', label: 'Follow-up', sortOrder: 2, color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A' },
      { key: 'VISIT', label: 'Visit Scheduled', sortOrder: 3, color: '#8B5CF6', bgColor: '#F3E8FF', borderColor: '#E9D5FF' },
      { key: 'QUALIFIED', label: 'Qualified', sortOrder: 4, color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#E0E7FF' },
      { key: 'PROPOSAL', label: 'Proposal', sortOrder: 5, color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC' },
      { key: 'PROPOSAL_SENT', label: 'Proposal Sent', sortOrder: 6, color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC' },
      { key: 'NEGOTIATION', label: 'Negotiation', sortOrder: 7, color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA' },
      { key: 'FINAL_CALL', label: 'Final Call', sortOrder: 8, color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA' },
      { key: 'PAYMENT', label: 'Payment Pending', sortOrder: 9, color: '#2563EB', bgColor: '#DBEAFE', borderColor: '#BFDBFE' },
      { key: 'WORK_STARTED', label: 'Work Started', sortOrder: 10, color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0' },
      { key: 'WON', label: 'Won', sortOrder: 11, color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0' },
      { key: 'CONVERTED', label: 'Converted', sortOrder: 12, color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0' },
      { key: 'LOST', label: 'Lost', sortOrder: 13, color: '#DC2626', bgColor: '#FFE4E6', borderColor: '#FECDD3' },
      { key: 'CANCELLED', label: 'Cancelled', sortOrder: 14, color: '#DC2626', bgColor: '#FFE4E6', borderColor: '#FECDD3' },
    ];
  }

  async getLeads(customerId: number | string | undefined, query: { page?: number; limit?: number; search?: string; status?: string }, user?: any) {
    return this.leadRepository.findAll(customerId, query, user);
  }

  async getLeadById(customerId: number | string, id: number | string) {
    const lead = await this.leadRepository.findOne(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }
    return lead;
  }

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto) {
    await this.getLeadById(customerId, id);
    await this.leadRepository.update(customerId, id, dto);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );
    return this.getLeadById(customerId, id);
  }

  async updateStatus(customerId: number | string, id: number | string, userId: number | string, dto: UpdateLeadStatusDto) {
    const lead = await this.getLeadById(customerId, id);
    await this.leadRepository.updateStatus(
      customerId,
      id,
      lead.status,
      dto.status,
      userId,
      dto.notes,
    );
    return this.getLeadById(customerId, id);
  }

  async deleteLead(customerId: number | string, id: number | string) {
    await this.getLeadById(customerId, id);
    return this.leadRepository.softDelete(customerId, id);
  }

  async addNote(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateLeadNoteDto) {
    await this.getLeadById(customerId, leadId);
    const note = await this.leadRepository.addNote(leadId, userId, dto.content);
    await this.leadRepository.logTimeline(
      leadId,
      'NOTE_ADDED',
      `New note added: ${dto.content.substring(0, 40)}...`,
    );
    return note;
  }

  async logFollowUp(customerId: number | string, leadId: number | string, userId: number | string, dto: LogFollowUpDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.logFollowUp(customerId, leadId, userId, dto);
  }

  async manageVisit(customerId: number | string, leadId: number | string, userId: number | string, dto: ManageVisitDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.manageVisit(customerId, leadId, userId, dto);
  }

  async createProposal(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateProposalDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.createProposal(customerId, leadId, userId, dto);
  }

  async recordFinalCall(customerId: number | string, leadId: number | string, userId: number | string, dto: FinalCallDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordFinalCall(customerId, leadId, userId, dto);
  }

  async recordPayment(customerId: number | string, leadId: number | string, userId: number | string, dto: RecordPaymentDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordPayment(customerId, leadId, userId, dto);
  }

  async startWork(customerId: number | string, leadId: number | string, userId: number | string, dto: StartWorkDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.startWork(customerId, leadId, userId, dto);
  }
}
