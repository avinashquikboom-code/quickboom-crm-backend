import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveCreatedFrom } from '../../common/utils/platform.util';
import { LeadService } from './lead.service';
import { BulkDeleteLeadsDto, CreateLeadDto, CreateLeadNoteDto, LeadQueryDto, UpdateLeadDto, UpdateLeadStageDto } from './dto/lead.dto';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Controller('leads')
export class LeadController {
  constructor(private readonly leads: LeadService) {}
  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: any, @Req() req: any) {
    return this.leads.create(dto, user, resolveCreatedFrom(req, user, dto.createdFrom));
  }
  @Get('stages')
  stages(@CurrentUser() user: any) { return this.leads.getStages(user); }
  @Get()
  list(@Query() query: LeadQueryDto, @CurrentUser() user: any) { return this.leads.findAll(query, user); }
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.leads.findOne(id, user); }
  @Get(':id/notes')
  getNotes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.leads.getNotes(id, user);
  }
  @Post(':id/notes')
  addNote(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateLeadNoteDto, @CurrentUser() user: any) {
    return this.leads.addNote(id, dto, user);
  }
  @Patch(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLeadStageDto, @CurrentUser() user: any) {
    return this.leads.updateStage(id, dto, user);
  }
  @Patch(':id/stage')
  updateStage(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLeadStageDto, @CurrentUser() user: any) {
    return this.leads.updateStage(id, dto, user);
  }
  @Patch(':id/assign')
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLeadDto, @CurrentUser() user: any) {
    return this.leads.update(id, dto, user);
  }
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLeadDto, @CurrentUser() user: any) {
    return this.leads.update(id, dto, user);
  }
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.leads.remove(id, user);
  }
  @Post('bulk-delete')
  bulkDelete(@Body() dto: BulkDeleteLeadsDto, @CurrentUser() user: any) {
    return this.leads.removeMany(dto.ids, user);
  }
  @Delete()
  bulkDeleteDelete(@Body() dto: BulkDeleteLeadsDto, @CurrentUser() user: any) {
    return this.leads.removeMany(dto.ids, user);
  }
  @Post('import-capture/:id')
  async importCapture(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() body?: any,
  ) {
    const result = await this.leads.importCapture(id, user, resolveCreatedFrom(req, user), body);
    const stage = result.lead.stage;
    const leadWithStage = result.lead;
    return {
      success: true,
      message: result.alreadyImported ? 'Lead already exists in CRM' : 'Lead imported successfully',
      data: {
        lead: leadWithStage,
        leadId: result.lead.id,
        status: result.lead.status,
        stage,
        stageId: stage.id,
        alreadyImported: result.alreadyImported,
      },
      lead: leadWithStage,
      leadId: result.lead.id,
      status: result.lead.status,
      stage,
      stageId: stage.id,
      alreadyImported: result.alreadyImported,
    };
  }
}
