import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveCreatedFrom } from '../../common/utils/platform.util';
import { LeadService } from './lead.service';
import { CreateLeadDto, LeadQueryDto } from './dto/lead.dto';

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
  @Get()
  list(@Query() query: LeadQueryDto, @CurrentUser() user: any) { return this.leads.findAll(query, user); }
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.leads.findOne(id, user); }
  @Post('import-capture/:id')
  async importCapture(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() body?: any,
  ) {
    const result = await this.leads.importCapture(id, user, resolveCreatedFrom(req, user), body);
    const stage = { id: 1, key: 'NEW', name: 'New' };
    const leadWithStage = { ...result.lead, stageId: 1, stage };
    return {
      success: true,
      message: result.alreadyImported ? 'Lead already exists in CRM' : 'Lead imported successfully',
      data: {
        lead: leadWithStage,
        leadId: result.lead.id,
        status: 'NEW',
        stage,
        stageId: 1,
        alreadyImported: result.alreadyImported,
      },
      lead: leadWithStage,
      leadId: result.lead.id,
      status: 'NEW',
      stage,
      stageId: 1,
      alreadyImported: result.alreadyImported,
    };
  }
}
