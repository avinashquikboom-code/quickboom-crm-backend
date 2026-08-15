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
import { TaskService } from './task.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new CRM task' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.taskService.create(tenantId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of tasks' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    return this.taskService.findAll(tenantId, { status, assignedToId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task details by ID' })
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.taskService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task details' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.taskService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete task' })
  async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.taskService.delete(tenantId, id);
  }
}
