import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LeadService } from './lead.service';
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('leads')
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new CRM lead' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leadService.createLead(tenantId, userId, dto);
  }

  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if lead already exists by phone, company, or website' })
  async checkDuplicate(
    @CurrentTenant() tenantId: string,
    @Body() dto: CheckDuplicateDto,
  ) {
    return this.leadService.checkDuplicate(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of leads' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.leadService.getLeads(tenantId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead details by ID with notes, timeline, status history, visits, proposals' })
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.leadService.getLeadById(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update lead details' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadService.updateLead(tenantId, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead stage status with history audit' })
  async updateStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadService.updateStatus(tenantId, id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete lead' })
  async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.leadService.deleteLead(tenantId, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add note to lead' })
  async addNote(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLeadNoteDto,
  ) {
    return this.leadService.addNote(tenantId, id, userId, dto);
  }

  @Post(':id/follow-ups')
  @ApiOperation({ summary: 'Log follow-up call outcome, next follow up, and update status to FOLLOW_UP' })
  async logFollowUp(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: LogFollowUpDto,
  ) {
    return this.leadService.logFollowUp(tenantId, id, userId, dto);
  }

  @Post(':id/visits')
  @ApiOperation({ summary: 'Manage field visit: schedule, start (GPS), or complete' })
  async manageVisit(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ManageVisitDto,
  ) {
    return this.leadService.manageVisit(tenantId, id, userId, dto);
  }

  @Post(':id/proposals')
  @ApiOperation({ summary: 'Create & send commercial proposal/quotation, move status to PROPOSAL' })
  async createProposal(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.leadService.createProposal(tenantId, id, userId, dto);
  }

  @Post(':id/final-call')
  @ApiOperation({ summary: 'Log final negotiation call, move status to FINAL_CALL or PAYMENT' })
  async recordFinalCall(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: FinalCallDto,
  ) {
    return this.leadService.recordFinalCall(tenantId, id, userId, dto);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record payment verification, move status to PAYMENT' })
  async recordPayment(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.leadService.recordPayment(tenantId, id, userId, dto);
  }

  @Post(':id/start-work')
  @ApiOperation({ summary: 'Kick off project work, move status to WORK_STARTED' })
  async startWork(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartWorkDto,
  ) {
    return this.leadService.startWork(tenantId, id, userId, dto);
  }
}
