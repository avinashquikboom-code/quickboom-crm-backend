import {
  Body,
  BadRequestException,
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
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/account.util';

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  private resolveTargetCustomerId(user: any, customerId: any, queryCustomerId?: any): number | undefined {
return undefined;
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
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, undefined);
    return this.teamService.findAll(targetCustomerId, query);
  }

  @Get('my-teams')
  @ApiOperation({ summary: 'Get all teams belonging to authenticated employee or organization' })
  @ApiQuery({ name: 'customerId', required: false })
  async getMyTeams(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.getMyTeams(user, targetCustomerId);
  }

  @Get('me/calendar')
  @ApiOperation({ summary: 'Get Team Calendar for primary team of authenticated employee' })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  async getMyTeamCalendar(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query() query: any,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, undefined);
    const myTeams = await this.teamService.getMyTeams(user, targetCustomerId);
    if (!myTeams || myTeams.length === 0) {
      return [];
    }
    return this.teamService.getTeamCalendar(myTeams[0].id, query, user, targetCustomerId);
  }

  @Get(':id/calendar')
  @ApiOperation({ summary: 'Get Team Calendar for specific team' })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  async getTeamCalendar(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query() query: any,
  ) {
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, undefined);
    return this.teamService.getTeamCalendar(id, query, user, targetCustomerId);
  }

  private ensureTeamAdmin(user: any) {
    if (!user) throw new ForbiddenException('Authentication required');
    if (isUserAdmin(user)) return;
    const acc = String(user.accountType || '').toUpperCase();
    const role = String(user.role || '').toUpperCase();
    const roles: string[] = Array.isArray(user.roles)
      ? user.roles.map((r: any) => String(typeof r === 'string' ? r : r?.name || r?.role?.name || '').toUpperCase())
      : [];
    const isOwnerOrAdmin =
      ['CUSTOMER', 'CUSTOMER_ADMIN', 'CUSTOMER_OWNER', 'COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(acc) ||
      ['CUSTOMER', 'CUSTOMER_ADMIN', 'CUSTOMER_OWNER', 'COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(role) ||
      roles.some((r) => ['CUSTOMER', 'CUSTOMER_ADMIN', 'CUSTOMER_OWNER', 'COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(r));
    if (!isOwnerOrAdmin) {
      throw new ForbiddenException('Administrator or organization owner account required');
    }
  }

  @Get(':id/dependencies')
  @ApiOperation({ summary: 'Get dependencies of a team before deletion' })
  @ApiQuery({ name: 'customerId', required: false })
  async getDependencies(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    this.ensureTeamAdmin(user);
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    return this.teamService.getDependencies(targetCustomerId, id);
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
  @ApiQuery({ name: 'reassignToTeamId', required: false, type: Number })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('customerId') customerIdQuery?: string,
    @Query('permanent') permanent?: string,
    @Query('reassignToTeamId') reassignToTeamId?: string,
    @Body('reassignToTeamId') bodyReassignToTeamId?: string | number,
  ) {
    this.ensureTeamAdmin(user);
    const targetCustomerId = this.resolveTargetCustomerId(user, customerId, customerIdQuery);
    let isPermanent = false;
    if (permanent !== undefined) {
      const norm = String(permanent).toLowerCase().trim();
      if (norm === 'true' || norm === '1' || norm === '') {
        isPermanent = true;
      } else if (norm === 'false' || norm === '0') {
        isPermanent = false;
      } else {
        throw new BadRequestException('Query parameter "permanent" must be a boolean (true or false)');
      }
    }
    const rawReassign = reassignToTeamId ?? bodyReassignToTeamId;
    let effectiveReassignId: number | undefined;
    if (rawReassign !== undefined && rawReassign !== null && String(rawReassign).trim() !== '') {
      const numReassign = Number(rawReassign);
      if (isNaN(numReassign) || !Number.isSafeInteger(numReassign) || numReassign <= 0) {
        throw new BadRequestException(`Invalid reassignToTeamId: "${rawReassign}". Must be a positive integer.`);
      }
      effectiveReassignId = numReassign;
    }
    return this.teamService.remove(targetCustomerId, id, isPermanent, effectiveReassignId);
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
