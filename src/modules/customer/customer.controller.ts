import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@ApiTags('Customers')
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @ApiOperation({ summary: 'Get all customers with pagination and filtering' })
  async findAll(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.customerService.findAll(
      search,
      activeBool,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single customer details' })
  async findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: 'Get current plan and customization details for customer' })
  async getCustomerPlan(@Param('id') id: string) {
    return this.customerService.getCustomerPlan(id);
  }

  @Get(':id/plan/history')
  @ApiOperation({ summary: 'Get customer subscription assignment history' })
  async getCustomerPlanHistory(@Param('id') id: string) {
    return this.customerService.getCustomerPlanHistory(id);
  }

  @Post(':id/customize-plan')
  @ApiOperation({ summary: 'Customize and assign subscription plan for customer' })
  async customizePlan(@Param('id') id: string, @Body() dto: any) {
    return this.customerService.customizeCustomerPlan(id, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update customer' })
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate / soft-delete customer' })
  async remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
