import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DesignationService } from './designation.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Designations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('designations')
export class DesignationController {
  constructor(private readonly designationService: DesignationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all designations with optional department and search filtering' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'departmentId', required: false, description: 'Filter by department ID' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('departmentId') departmentIdQuery?: string,
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

    const departmentId =
      departmentIdQuery && !isNaN(Number(departmentIdQuery))
        ? Number(departmentIdQuery)
        : undefined;

    const isActive =
      isActiveQuery !== undefined
        ? isActiveQuery === 'true' || isActiveQuery === '1'
        : undefined;

    return this.designationService.findAll(targetCustomerId, {
      departmentId,
      search,
      isActive,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get all roles directly derived from Employee Designations' })
  @ApiQuery({ name: 'customerId', required: false })
  async getRoles(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }
    return this.designationService.getDesignationRoles(targetCustomerId);
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get permissions for a specific Designation' })
  @ApiQuery({ name: 'customerId', required: false })
  async getPermissions(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }
    return this.designationService.getDesignationPermissions(targetCustomerId, id);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Update permissions for a specific Designation and emit real-time refresh' })
  @ApiQuery({ name: 'customerId', required: false })
  async savePermissions(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { permissions: (string | { module?: string; action?: string; key?: string })[] },
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }
    return this.designationService.saveDesignationPermissions(targetCustomerId, id, body?.permissions || [], user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get designation details by ID' })
  async findOne(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.designationService.findOne(targetCustomerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new designation' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateDesignationDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.designationService.create(targetCustomerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update designation by ID' })
  async update(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDesignationDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.designationService.update(targetCustomerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or soft-deactivate designation by ID' })
  async remove(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.designationService.remove(targetCustomerId, id);
  }
}
