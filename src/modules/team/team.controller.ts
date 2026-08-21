import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { CreateTeamDto, AddTeamMemberDto } from './dto/team.dto';

@ApiTags('Teams')
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'Get all teams with assigned members' })
  async findAll(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.teamService.findAll(customerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single team details' })
  async findOne(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.teamService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new team' })
  async create(
    @Body() dto: CreateTeamDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.teamService.create(customerId, dto);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add member to team' })
  async addMember(
    @Param('id') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamService.addMember(teamId, dto);
  }

  @Delete(':id/members/:employeeId')
  @ApiOperation({ summary: 'Remove member from team' })
  async removeMember(
    @Param('id') teamId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.teamService.removeMember(teamId, employeeId);
  }
}
