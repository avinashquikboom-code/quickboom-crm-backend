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
import { CreateLeadDto, CreateLeadNoteDto, UpdateLeadDto } from './dto/lead.dto';
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
      limit: limit ? Number(limit) : 10,
      search,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead details by ID with notes and timeline' })
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
}
