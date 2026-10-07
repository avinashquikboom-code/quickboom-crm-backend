import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TaskService } from './task.service';
import { SubmitTaskProofDto } from './dto/task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Mobile - Employee Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('mobile/tasks')
export class MobileTaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  @ApiOperation({ summary: 'Get current authenticated employee tasks (Mobile App)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getMyTasks(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
  ) {
    return this.taskService.getMyTasks(user, customerId, { status, priority, search });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get current employee task details by ID' })
  async getMyTask(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    return this.taskService.getMyTask(user, customerId, id);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Employee starts working on assigned task' })
  async startTask(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    return this.taskService.startMyTask(user, customerId, id);
  }

  @Post(':id/proof')
  @ApiOperation({ summary: 'Upload mandatory photo proof for task completion' })
  async submitProof(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: SubmitTaskProofDto,
  ) {
    return this.taskService.submitMyTaskProof(user, customerId, id, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit task for HR review after proof upload' })
  async submitTask(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body('comment') comment?: string,
  ) {
    return this.taskService.submitMyTask(user, customerId, id, comment);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get task history for employee task' })
  async getHistory(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    return this.taskService.getMyTask(user, customerId, id).then((t: any) => t.history);
  }
}
