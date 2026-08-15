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
import { DealService } from './deal.service';
import { CreateDealDto, UpdateDealDto } from './dto/deal.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@ApiTags('Deals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('deals')
export class DealController {
  constructor(private readonly dealService: DealService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new deal in sales pipeline' })
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateDealDto) {
    return this.dealService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of deals filtered by pipeline or stage' })
  @ApiQuery({ name: 'pipelineId', required: false })
  @ApiQuery({ name: 'stageId', required: false })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('pipelineId') pipelineId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.dealService.findAll(tenantId, { pipelineId, stageId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deal details by ID' })
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.dealService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update deal stage, win/loss status or amount' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.dealService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete deal' })
  async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.dealService.delete(tenantId, id);
  }
}
