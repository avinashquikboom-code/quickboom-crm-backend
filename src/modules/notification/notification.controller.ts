import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications list' })
  async findAll(
    @Query('customerId') customerIdQuery?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.notificationService.findAll(customerId, undefined, unreadOnly === 'true');
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark single notification as read' })
  async markAsRead(@Param('id') id: string) {
    return this.notificationService.markAsRead(id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.notificationService.markAllAsRead(customerId);
  }
}
