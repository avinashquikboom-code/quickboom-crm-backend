import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RemoteWorkService } from './remote-work.service';
import {
  CreateRemoteRequestDto,
  RejectRemoteRequestDto,
  RemoteRequestQueryDto,
} from './dto/remote-work.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Remote Work Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('remote-requests')
export class RemoteWorkController {
  constructor(private readonly remoteWorkService: RemoteWorkService) {}

  @Get()
  @ApiOperation({ summary: 'Get all remote work requests with summary counts and filters' })
  async findAll(
    @CurrentCustomer() customerId: number | string | undefined,
    @Query() query?: RemoteRequestQueryDto,
  ) {
    return this.remoteWorkService.findAll(customerId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get summary KPI counts of remote work requests' })
  async getSummary(@CurrentCustomer() customerId: number | string | undefined) {
    return this.remoteWorkService.getSummary(customerId);
  }

  @Get('today')
  @ApiOperation({ summary: "Get today's remote workers roster with live attendance logs" })
  async getTodayRemoteWorkers(@CurrentCustomer() customerId: number | string | undefined) {
    return this.remoteWorkService.getTodayRemoteWorkers(customerId);
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current remote work authorization status for authenticated employee' })
  async getCurrentStatus(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.remoteWorkService.getCurrentRemoteWorkStatus(user, customerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single remote work request details' })
  async findOne(
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    return this.remoteWorkService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Submit new remote work request' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateRemoteRequestDto,
  ) {
    return this.remoteWorkService.create(user, customerId, dto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve remote work request' })
  async approve(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    return this.remoteWorkService.approve(user, customerId, id);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject remote work request with mandatory reason' })
  async reject(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: RejectRemoteRequestDto,
  ) {
    return this.remoteWorkService.reject(user, customerId, id, dto);
  }
}
