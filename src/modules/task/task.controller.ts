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
import {
  CreateTaskDto,
  UpdateTaskDto,
  ReallocateTaskDto,
  SubmitTaskProofDto,
  ReviewTaskDto,
} from './dto/task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Employee Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get('metrics')
  @RequirePermissions({ module: 'TASKS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get summary metrics for HR tasks' })
  async getMetrics(@CurrentCustomer() customerId: string) {
    return this.taskService.getMetrics(customerId);
  }

  @Post()
  @RequirePermissions({ module: 'TASKS', action: 'CREATE' })
  @ApiOperation({ summary: 'Create and allocate a new task to employee' })
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.taskService.create(customerId, userId, dto);
  }

  @Get()
  @RequirePermissions({ module: 'TASKS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get paginated/filtered list of tasks' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isOverdue', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['priority', 'dueDate', 'createdAt'] })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
    @Query('isOverdue') isOverdue?: string,
    @Query('sortBy') sortBy?: 'priority' | 'dueDate' | 'createdAt',
  ) {
    return this.taskService.findAll(customerId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      status,
      employeeId,
      departmentId,
      priority,
      search,
      isOverdue,
      sortBy,
    });
  }

  @Get(':id')
  @RequirePermissions({ module: 'TASKS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get task details with proof, review, and history' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.taskService.findOne(customerId, id);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'Update task parameters' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.taskService.update(customerId, id, dto);
  }

  @Post(':id/reallocate')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'Reallocate task to another employee' })
  async reallocate(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReallocateTaskDto,
  ) {
    return this.taskService.reallocate(customerId, id, userId, dto);
  }

  @Post(':id/start')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'Employee starts working on task' })
  async startTask(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.taskService.startTask(customerId, id, userId);
  }

  @Post(':id/proof')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'Submit mandatory photo proof for task completion' })
  async submitProof(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: SubmitTaskProofDto,
  ) {
    return this.taskService.submitProof(customerId, id, userId, dto);
  }

  @Post(':id/approve')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'HR approves task completion proof' })
  async approveTask(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReviewTaskDto,
  ) {
    return this.taskService.approveTask(customerId, id, userId, dto);
  }

  @Post(':id/reject')
  @RequirePermissions({ module: 'TASKS', action: 'EDIT' })
  @ApiOperation({ summary: 'HR rejects task completion proof with reason' })
  async rejectTask(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReviewTaskDto,
  ) {
    return this.taskService.rejectTask(customerId, id, userId, dto);
  }

  @Get(':id/history')
  @RequirePermissions({ module: 'TASKS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get audit history for a task' })
  async getHistory(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.taskService.getHistory(customerId, id);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'TASKS', action: 'DELETE' })
  @ApiOperation({ summary: 'Soft delete task' })
  async remove(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.taskService.delete(customerId, id);
  }
}
