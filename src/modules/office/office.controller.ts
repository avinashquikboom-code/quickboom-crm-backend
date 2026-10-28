import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OfficeService } from './office.service';
import { CreateOfficeDto, UpdateOfficeDto } from './dto/office.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Offices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller(['offices', 'admin/offices'])
export class OfficeController {
  constructor(private readonly officeService: OfficeService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active or filtered company offices' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('isActive') isActiveQuery?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    const isActive =
      isActiveQuery !== undefined
        ? isActiveQuery === 'true' || isActiveQuery === '1'
        : undefined;

    return this.officeService.findAll(targetCustomerId, {
      search,
      isActive,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get office details by ID' })
  async findOne(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.officeService.findOne(targetCustomerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new company office geofence location' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateOfficeDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.officeService.create(targetCustomerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update office details' })
  async update(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOfficeDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.officeService.update(targetCustomerId, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate office location' })
  async toggleStatus(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body('isActive') isActive: boolean,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.officeService.toggleStatus(targetCustomerId, id, Boolean(isActive));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or deactivate office location' })
  async remove(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.officeService.remove(targetCustomerId, id);
  }
}
