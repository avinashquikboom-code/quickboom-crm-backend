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
import { CreateDealDto, UpdateDealDto, UpdateDealStageDto } from './dto/deal.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Deals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('deals')
export class DealController {
  constructor(private readonly dealService: DealService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new deal in sales pipeline' })
  async create(@CurrentCustomer() customerId: string, @Body() dto: CreateDealDto) {
    return this.dealService.create(customerId, dto);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics for deals & pipeline value' })
  async getMetrics(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    return this.dealService.getMetrics(customerId, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of deals filtered by pipeline or stage' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'pipelineId', required: false })
  @ApiQuery({ name: 'stageId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('pipelineId') pipelineId?: string,
    @Query('stageId') stageId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.dealService.findAll(
      customerId,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        pipelineId,
        stageId,
        assignedToId,
        status,
        search,
      },
      user,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deal details by ID' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.dealService.findOne(customerId, id);
  }

  @Patch(':id/stage')
  @ApiOperation({ summary: 'Update deal stage transition' })
  async updateStage(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealStageDto,
  ) {
    return this.dealService.updateStage(customerId, id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update deal stage, win/loss status or amount' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.dealService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete deal' })
  async remove(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.dealService.delete(customerId, id);
  }
}
