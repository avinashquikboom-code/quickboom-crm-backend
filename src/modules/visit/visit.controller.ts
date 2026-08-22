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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VisitService } from './visit.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { VisitStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Client Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('visits')
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Get()
  @ApiOperation({ summary: 'Get all client visits' })
  async findAll(
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('status') status?: VisitStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.visitService.findAll(
      customerId,
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single client visit' })
  async findOne(
    @Param('id') id: string,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.visitService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create / schedule client visit' })
  async create(
    @Body() dto: CreateVisitDto,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.visitService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update visit details or completion status' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.visitService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel client visit' })
  async remove(
    @Param('id') id: string,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.visitService.remove(customerId, id);
  }
}
