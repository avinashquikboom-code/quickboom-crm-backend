import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TeamService } from './team.service';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  TeamQueryDto,
  UpdateTeamDto,
} from './dto/team.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  private resolveTargetCustomerId(user: any, customerId: any, queryCustomerId?: any): number {
    const isSuperAdmin = isUserSuperAdmin(user);
    const target = isSuperAdmin
      ? queryCustomerId || customerId || user?.customerId
      : user?.customerId || customerId;

    const num = Number(target);
    if (isNaN(num) || num <= 0) {
      throw new ForbiddenException('User does not belong to any customer account');
    }
    return num;
  }

  @Get()
  @ApiOperation({ summary: 'Get all teams with leader and member details' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Customer ID override (SUPER_ADMIN only)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query() query: TeamQueryDto,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, query.customerId);
    return this.teamService.findAll(targetCustomerId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single team details with members and leader' })
  @ApiQuery({ name: 'customerId', required: false })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.findOne(targetCustomerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new team with designated leader and member roster' })
  @ApiQuery({ name: 'customerId', required: false })
  async create(
    @Body() dto: CreateTeamDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.create(targetCustomerId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update team details, leader, status, and members' })
  @ApiQuery({ name: 'customerId', required: false })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.update(targetCustomerId, id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Patch team details, leader, status, and members' })
  @ApiQuery({ name: 'customerId', required: false })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.update(targetCustomerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate or delete team' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'permanent', required: false, type: Boolean })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
    @Query('permanent') permanent?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.remove(targetCustomerId, id, permanent === 'true');
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a single member to team' })
  @ApiQuery({ name: 'customerId', required: false })
  async addMember(
    @Param('id') teamId: string,
    @Body() dto: AddTeamMemberDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.addMember(targetCustomerId, teamId, dto);
  }

  @Delete(':id/members/:employeeId')
  @ApiOperation({ summary: 'Remove a member from team' })
  @ApiQuery({ name: 'customerId', required: false })
  async removeMember(
    @Param('id') teamId: string,
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.removeMember(targetCustomerId, teamId, employeeId);
  }
}
