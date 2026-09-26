import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LeadService } from './lead.service';
import {
  AddLeadImageDto,
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
  ReorderLeadStagesDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
  UpdateLeadStatusDto,
  SendLeadWhatsAppDto,
  SendLeadEmailDto,
  BulkDeleteLeadsDto,
} from './dto/lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller(['leads', 'admin/leads'])
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  @RequirePermissions({ module: 'LEADS', action: 'CREATE' })
  @ApiOperation({ summary: 'Create a new CRM lead' })
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateLeadDto,
    @Req() req?: any,
  ) {
    return this.leadService.createLead(customerId, user, dto, req);
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
    @CurrentUser() user?: any,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const shouldInclude = includeInactive === undefined ? true : includeInactive === 'true';
    return this.leadService.getStages(customerId, shouldInclude, user);
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

  @Patch('stages/reorder')
  @ApiOperation({ summary: 'Reorder lead stages by updating their sort order positions in bulk' })
  async reorderStages(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: ReorderLeadStagesDto,
  ) {
    return this.leadService.reorderStages(customerId, user, dto);
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
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get paginated list of leads' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'stageId', required: false })
  @ApiQuery({ name: 'dateFilter', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'createdFrom', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('stageId') stageId?: string,
    @Query('createdFrom') createdFrom?: string,
  ) {
    return this.leadService.getLeads(
      customerId,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
        search,
        status,
        stageId,
        createdFrom,
      },
      user,
    );
  }

  @Post(':id/convert')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
  @ApiOperation({ summary: 'Convert lead to customer account' })
  async convert(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leadService.convertLead(customerId, id, userId, dto);
  }

  @Get(['whatsapp-templates', 'whatsapp/templates'])
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get all available WhatsApp templates for leads' })
  async getWhatsAppTemplates(@CurrentCustomer() customerId?: string) {
    return this.leadService.getWhatsAppTemplates(customerId);
  }

  @Get(':id/status')
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get lead status and stage details by ID' })
  async getStatus(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.leadService.getLeadStatus(customerId, id);
  }

  @Get(':id/communications')
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get unified Email and WhatsApp communication history and delivery tracking' })
  async getCommunications(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.leadService.getLeadCommunications(customerId, id);
  }

  @Get(':id')
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get lead details by ID with notes, timeline, status history, visits, proposals' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.leadService.getLeadById(customerId, id);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
  @ApiOperation({ summary: 'Update lead details' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadService.updateLead(customerId, id, dto, userId);
  }

  @Patch(':id/status')
  @RequirePermissions({ module: 'LEADS', action: 'CHANGE_STAGE' })
  @ApiOperation({ summary: 'Update lead stage status with history audit' })
  async updateStatus(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadService.updateStatus(customerId, id, userId, dto);
  }

  @Delete('bulk')
  @RequirePermissions({ module: 'LEADS', action: 'DELETE' })
  @ApiOperation({ summary: 'Bulk soft delete leads via DELETE /leads/bulk' })
  async bulkRemove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteLeadsDto,
  ) {
    const ids = dto?.resolvedIds ?? dto?.ids ?? [];
    return this.leadService.bulkDeleteLeads(customerId, user, ids);
  }

  @Post('bulk-delete')
  @RequirePermissions({ module: 'LEADS', action: 'DELETE' })
  @ApiOperation({ summary: 'Bulk soft delete leads via POST /leads/bulk-delete' })
  async bulkRemovePost(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteLeadsDto,
  ) {
    const ids = dto?.resolvedIds ?? dto?.ids ?? [];
    return this.leadService.bulkDeleteLeads(customerId, user, ids);
  }

  @Post('bulk')
  @RequirePermissions({ module: 'LEADS', action: 'DELETE' })
  @ApiOperation({ summary: 'Bulk soft delete leads via POST /leads/bulk' })
  async bulkRemovePostBulk(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteLeadsDto,
  ) {
    const ids = dto?.resolvedIds ?? dto?.ids ?? [];
    return this.leadService.bulkDeleteLeads(customerId, user, ids);
  }

  @Delete('bulk-delete')
  @RequirePermissions({ module: 'LEADS', action: 'DELETE' })
  @ApiOperation({ summary: 'Bulk soft delete leads via DELETE /leads/bulk-delete' })
  async bulkRemoveDeleteBulk(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteLeadsDto,
  ) {
    const ids = dto?.resolvedIds ?? dto?.ids ?? [];
    return this.leadService.bulkDeleteLeads(customerId, user, ids);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'LEADS', action: 'DELETE' })
  @ApiOperation({ summary: 'Soft delete lead' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.leadService.deleteLead(customerId, id, user);
  }


  @Post(':id/images')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an image or attach image URL to a lead' })
  async addImage(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body() dto?: AddLeadImageDto,
  ) {
    return this.leadService.addImage(customerId, id, file, dto);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
  @ApiOperation({ summary: 'Delete a lead image' })
  async deleteImage(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.leadService.deleteImage(customerId, id, imageId);
  }

  @Get(':id/images')
  @RequirePermissions({ module: 'LEADS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get all images for a lead' })
  async getImages(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.leadService.getLeadImages(customerId, id);
  }

  @Put(':id/images/:imageId/primary')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
  @ApiOperation({ summary: 'Set an image as the primary image for a lead' })
  async setPrimaryImage(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.leadService.setPrimaryImage(customerId, id, imageId);
  }

  @Post(':id/notes')
  @RequirePermissions({ module: 'LEADS', action: 'EDIT' })
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
  @RequirePermissions({ module: 'FOLLOW_UP', action: 'CREATE' })
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
  @RequirePermissions({ module: 'VISITS', action: 'CREATE' })
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

  @Post(':id/send-details')
  @ApiOperation({ summary: 'Send lead profile and account details to the lead email via configured SMTP' })
  async sendLeadDetails(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.leadService.sendLeadDetails(customerId, id, user);
  }

  @Post(':id/send-email')
  @ApiOperation({ summary: 'Send a custom email or details email to the lead via configured SMTP' })
  async sendLeadEmail(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SendLeadEmailDto,
  ) {
    return this.leadService.sendLeadEmail(customerId, id, user, dto);
  }

  @Post(':id/send-whatsapp')
  @ApiOperation({ summary: 'Send a WhatsApp message or template to the lead phone' })
  async sendLeadWhatsApp(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendLeadWhatsAppDto,
  ) {
    return this.leadService.sendLeadWhatsApp(customerId, id, userId, dto);
  }
}

