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
  ConvertLeadDto,
  CreateLeadDto,
  CreateLeadNoteDto,
  CreateLeadStageDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
  UpdateLeadStatusDto,
} from './dto/lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('leads')
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new CRM lead' })
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leadService.createLead(customerId, user, dto);
  }

  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if lead already exists by phone, company, website, or Google Place ID' })
  async checkDuplicate(
    @CurrentCustomer() customerId: string,
    @Body() dto: CheckDuplicateDto,
  ) {
    return this.leadService.checkDuplicate(customerId, dto);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics count for leads' })
  async getMetrics(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    return this.leadService.getSummaryMetrics(customerId, user);
  }

  @Get('stages')
  @ApiOperation({ summary: 'Get configured lead stages / statuses with sort order, label, and colors' })
  @ApiQuery({ name: 'includeInactive', required: false })
  async getStages(
    @CurrentCustomer() customerId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const shouldInclude = includeInactive === undefined ? true : includeInactive === 'true';
    return this.leadService.getStages(customerId, shouldInclude);
  }

  @Post('stages')
  @ApiOperation({ summary: 'Create a new lead stage' })
  async createStage(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateLeadStageDto,
  ) {
    return this.leadService.createStage(customerId, user, dto);
  }

  @Patch('stages/:id')
  @ApiOperation({ summary: 'Update lead stage details or active status' })
  async updateStage(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateLeadStageDto,
  ) {
    return this.leadService.updateStage(customerId, user, id, dto);
  }

  @Delete('stages/:id')
  @ApiOperation({ summary: 'Delete lead stage if no leads are assigned' })
  async deleteStage(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.leadService.deleteStage(customerId, user, id);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of leads' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.leadService.getLeads(
      customerId,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
        search,
        status,
      },
      user,
    );
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert qualified lead to Customer Company, Contact, and Deal' })
  async convert(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leadService.convertLead(customerId, id, userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead details by ID with notes, timeline, status history, visits, proposals' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.leadService.getLeadById(customerId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update lead details' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadService.updateLead(customerId, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead stage status with history audit' })
  async updateStatus(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadService.updateStatus(customerId, id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete lead' })
  async remove(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.leadService.deleteLead(customerId, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add note to lead' })
  async addNote(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLeadNoteDto,
  ) {
    return this.leadService.addNote(customerId, id, userId, dto);
  }

  @Post(':id/follow-ups')
  @ApiOperation({ summary: 'Log follow-up call outcome, next follow up, and update status to FOLLOW_UP' })
  async logFollowUp(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: LogFollowUpDto,
  ) {
    return this.leadService.logFollowUp(customerId, id, userId, dto);
  }

  @Post(':id/visits')
  @ApiOperation({ summary: 'Manage field visit: schedule, start (GPS), or complete' })
  async manageVisit(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ManageVisitDto,
  ) {
    return this.leadService.manageVisit(customerId, id, userId, dto);
  }

  @Post(':id/proposals')
  @ApiOperation({ summary: 'Create & send commercial proposal/quotation, move status to PROPOSAL' })
  async createProposal(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.leadService.createProposal(customerId, id, userId, dto);
  }

  @Post(':id/final-call')
  @ApiOperation({ summary: 'Log final negotiation call, move status to FINAL_CALL or PAYMENT' })
  async recordFinalCall(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: FinalCallDto,
  ) {
    return this.leadService.recordFinalCall(customerId, id, userId, dto);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record payment verification, move status to PAYMENT' })
  async recordPayment(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.leadService.recordPayment(customerId, id, userId, dto);
  }

  @Post(':id/start-work')
  @ApiOperation({ summary: 'Kick off project work, move status to WORK_STARTED' })
  async startWork(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartWorkDto,
  ) {
    return this.leadService.startWork(customerId, id, userId, dto);
  }
}
