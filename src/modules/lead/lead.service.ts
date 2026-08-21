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

  async createLead(customerId: number | string, userId: number | string, dto: CreateLeadDto) {
    const lead = await this.leadRepository.create(customerId, userId, dto);
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

  async getLeads(customerId: number | string, query: { page?: number; limit?: number; search?: string; status?: string }) {
    return this.leadRepository.findAll(customerId, query);
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
