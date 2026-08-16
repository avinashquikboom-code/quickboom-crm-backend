import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import {
  CheckDuplicateDto,
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

@Injectable()
export class LeadService {
  constructor(private readonly leadRepository: LeadRepository) {}

  async createLead(tenantId: string, userId: string, dto: CreateLeadDto) {
    const lead = await this.leadRepository.create(tenantId, userId, dto);
    await this.leadRepository.logTimeline(
      lead.id,
      'LEAD_CREATED',
      `Lead "${lead.title}" was created via ${dto.source || 'WEBSITE'}`,
      { source: dto.source, value: dto.value },
    );
    return lead;
  }

  async checkDuplicate(tenantId: string, dto: CheckDuplicateDto) {
    return this.leadRepository.checkDuplicate(tenantId, dto);
  }

  async getLeads(tenantId: string, query: { page?: number; limit?: number; search?: string; status?: string }) {
    return this.leadRepository.findAll(tenantId, query);
  }

  async getLeadById(tenantId: string, id: string) {
    const lead = await this.leadRepository.findOne(tenantId, id);
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }
    return lead;
  }

  async updateLead(tenantId: string, id: string, dto: UpdateLeadDto) {
    await this.getLeadById(tenantId, id);
    await this.leadRepository.update(tenantId, id, dto);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );
    return this.getLeadById(tenantId, id);
  }

  async updateStatus(tenantId: string, id: string, userId: string, dto: UpdateLeadStatusDto) {
    const lead = await this.getLeadById(tenantId, id);
    await this.leadRepository.updateStatus(
      tenantId,
      id,
      lead.status,
      dto.status,
      userId,
      dto.notes,
    );
    return this.getLeadById(tenantId, id);
  }

  async deleteLead(tenantId: string, id: string) {
    await this.getLeadById(tenantId, id);
    return this.leadRepository.softDelete(tenantId, id);
  }

  async addNote(tenantId: string, leadId: string, userId: string, dto: CreateLeadNoteDto) {
    await this.getLeadById(tenantId, leadId);
    const note = await this.leadRepository.addNote(leadId, userId, dto.content);
    await this.leadRepository.logTimeline(
      leadId,
      'NOTE_ADDED',
      `New note added: ${dto.content.substring(0, 40)}...`,
    );
    return note;
  }

  async logFollowUp(tenantId: string, leadId: string, userId: string, dto: LogFollowUpDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.logFollowUp(tenantId, leadId, userId, dto);
  }

  async manageVisit(tenantId: string, leadId: string, userId: string, dto: ManageVisitDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.manageVisit(tenantId, leadId, userId, dto);
  }

  async createProposal(tenantId: string, leadId: string, userId: string, dto: CreateProposalDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.createProposal(tenantId, leadId, userId, dto);
  }

  async recordFinalCall(tenantId: string, leadId: string, userId: string, dto: FinalCallDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.recordFinalCall(tenantId, leadId, userId, dto);
  }

  async recordPayment(tenantId: string, leadId: string, userId: string, dto: RecordPaymentDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.recordPayment(tenantId, leadId, userId, dto);
  }

  async startWork(tenantId: string, leadId: string, userId: string, dto: StartWorkDto) {
    await this.getLeadById(tenantId, leadId);
    return this.leadRepository.startWork(tenantId, leadId, userId, dto);
  }
}
