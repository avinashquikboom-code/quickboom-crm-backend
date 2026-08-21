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
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@ApiTags('Employees')
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @ApiOperation({ summary: 'Get all employees' })
  async findAll(
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.employeeService.findAll(
      customerId,
      search,
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single employee details' })
  async findOne(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.employeeService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new employee' })
  async create(
    @Body() dto: CreateEmployeeDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.employeeService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.employeeService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate employee' })
  async remove(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.employeeService.remove(customerId, id);
  }

  @Get('hrm/leaves')
  @ApiOperation({ summary: 'Get employee leave requests' })
  async getLeaves(@Query('customerId') customerIdQuery?: string) {
    return this.employeeService.getLeaves(customerIdQuery);
  }

  @Get('hrm/remote-requests')
  @ApiOperation({ summary: 'Get remote work requests' })
  async getRemoteRequests(@Query('customerId') customerIdQuery?: string) {
    return this.employeeService.getRemoteRequests(customerIdQuery);
  }

  @Get('hrm/attendance')
  @ApiOperation({ summary: 'Get employee attendance logs' })
  async getAttendance(@Query('customerId') customerIdQuery?: string) {
    return this.employeeService.getAttendance(customerIdQuery);
  }
}
