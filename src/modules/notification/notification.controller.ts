import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { RegisterDeviceTokenDto, UnregisterDeviceTokenDto, SendNotificationDto } from './dto/device-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationSchedulerService: NotificationSchedulerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated notifications list' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'unreadOnly', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentCustomer() customerId: number | string | undefined,
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('search') search?: string,
  ) {
    const targetCustomerId = customerId || 1;
    return this.notificationService.findAll(
      targetCustomerId,
      userId,
      unreadOnly === 'true',
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Post('device-token')
  @ApiOperation({ summary: 'Register or update FCM device token for authenticated user' })
  @ApiBody({ type: RegisterDeviceTokenDto })
  async registerDeviceToken(
    @CurrentUser('id') userId: number | string,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    const numUserId = Number(userId);
    return this.notificationService.registerDeviceToken(numUserId, dto);
  }

  @Delete('device-token')
  @ApiOperation({ summary: 'Deactivate FCM device token for authenticated user on logout' })
  @ApiBody({ type: UnregisterDeviceTokenDto })
  async unregisterDeviceToken(
    @CurrentUser('id') userId: number | string,
    @Body() dto: UnregisterDeviceTokenDto,
  ) {
    const numUserId = Number(userId);
    return this.notificationService.unregisterDeviceToken(numUserId, dto.token);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send push notification to user/customer and store record' })
  @ApiBody({ type: SendNotificationDto })
  async sendNotification(
    @CurrentCustomer() currentCustomerId: number | string | undefined,
    @Body() dto: SendNotificationDto,
  ) {
    const customerId = dto.customerId || (currentCustomerId ? Number(currentCustomerId) : undefined);
    return this.notificationService.sendPushNotification({
      userId: dto.userId,
      customerId,
      title: dto.title,
      body: dto.body,
      type: dto.type || 'GENERAL',
      data: dto.data,
    });
  }

  @Post('triggers/run-scheduled-checks')
  @ApiOperation({ summary: 'Run all automated notification checks (3-day subscription expiry & tomorrow calendar)' })
  async runScheduledChecks() {
    return this.notificationSchedulerService.runAllScheduledChecks();
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark single notification as read' })
  async markAsRead(
    @Param('id') id: string,
    @CurrentCustomer() customerId: number | string | undefined,
    @CurrentUser('id') userId: number | string,
  ) {
    const targetCustomerId = customerId || 1;
    return this.notificationService.markAsRead(id, targetCustomerId, userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(
    @CurrentCustomer() customerId: number | string | undefined,
    @CurrentUser('id') userId: number | string,
  ) {
    const targetCustomerId = customerId || 1;
    return this.notificationService.markAllAsRead(targetCustomerId, userId);
  }
}
