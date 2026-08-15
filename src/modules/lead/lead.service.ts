import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import { CreateLeadDto, CreateLeadNoteDto, UpdateLeadDto } from './dto/lead.dto';

@Injectable()
export class LeadService {
  constructor(private readonly leadRepository: LeadRepository) {}

  async createLead(tenantId: string, userId: string, dto: CreateLeadDto) {
    const lead = await this.leadRepository.create(tenantId, userId, dto);
    await this.leadRepository.logTimeline(
      lead.id,
      'LEAD_CREATED',
      `Lead "${lead.title}" was created by user`,
    );
    return lead;
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
      `New note added: ${dto.content.substring(0, 30)}...`,
    );
    return note;
  }
}
