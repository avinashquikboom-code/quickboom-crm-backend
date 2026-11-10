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
    @Query('stage') stage?: string,
    @Query('closeFrom') closeFrom?: string,
    @Query('closeTo') closeTo?: string,
    @Query('search') search?: string,
  ) {
    return this.dealService.findAll(
      customerId,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        pipelineId,
        stageId,
        stage,
        assignedToId,
        status,
        closeFrom,
        closeTo,
        search,
      },
      user,
    );
  }

  @Get('stages')
  @ApiOperation({ summary: 'List deal pipeline stages for the current tenant' })
  @ApiQuery({ name: 'active', required: false })
  listStages(@CurrentCustomer() customerId: string, @Query('active') active?: string) {
    return this.dealService.listStages(customerId, active === 'true');
  }

  @Post('stages')
  @ApiOperation({ summary: 'Create a deal pipeline stage' })
  createStage(@CurrentCustomer() customerId: string, @Body() body: any) {
    return this.dealService.createStage(customerId, body);
  }

  @Post('stages/bulk')
  @ApiOperation({ summary: 'Bulk delete or activate deal stages' })
  bulkStages(@CurrentCustomer() customerId: string, @Body() body: { ids?: number[]; action?: string }) {
    return this.dealService.bulkStages(customerId, body);
  }

  @Patch('stages/:id')
  @ApiOperation({ summary: 'Update a deal pipeline stage' })
  updateStageDefinition(@CurrentCustomer() customerId: string, @Param('id') id: string, @Body() body: any) {
    return this.dealService.updateStageDefinition(customerId, id, body);
  }

  @Delete('stages/:id')
  @ApiOperation({ summary: 'Delete an unused deal pipeline stage' })
  deleteStage(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.dealService.deleteStage(customerId, id);
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
