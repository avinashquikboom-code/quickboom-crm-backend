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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { NotificationService } from './notification.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { S3Service } from '../s3/s3.service';
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
  SendNotificationDto,
  TestTokenDto,
  AdminOfferNotificationDto,
  TestCustomerNotificationDto,
} from './dto/device-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationSchedulerService: NotificationSchedulerService,
    private readonly s3Service: S3Service,
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
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('search') search?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = customerId || (isSuperAdmin ? undefined : 1);
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

  @Post('test-token')
  @ApiOperation({ summary: 'Send direct test push notification to a specific FCM token' })
  @ApiBody({ type: TestTokenDto })
  async testToken(@Body() dto: TestTokenDto) {
    return this.notificationService.sendDirectTestToToken(dto);
  }

  @Post('test')
  @ApiOperation({ summary: 'Send test FCM push notification to a customer active device(s)' })
  @ApiBody({ type: TestCustomerNotificationDto })
  async testCustomerNotification(
    @CurrentCustomer() currentCustomerId: number | string | undefined,
    @Body() dto: TestCustomerNotificationDto,
  ) {
    const targetCustomerId = dto.customerId || currentCustomerId;
    return this.notificationService.sendCustomerTestNotification(targetCustomerId);
  }

  @Post('admin/offer')
  @ApiOperation({ summary: 'Send admin offer notification to customer(s) or employee(s) and store in-app history' })
  @ApiBody({ type: AdminOfferNotificationDto })
  async sendAdminOffer(
    @CurrentUser('id') userId: string,
    @Body() dto: AdminOfferNotificationDto,
  ) {
    const adminUserId = userId ? Number(userId) : undefined;
    return this.notificationService.sendAdminOfferNotification(dto, adminUserId);
  }

  @Get('admin/campaigns')
  @ApiOperation({ summary: 'Get paginated offer notifications history / campaigns (Admin)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAdminCampaigns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationService.getOfferCampaigns(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('admin/upload-image')
  @ApiOperation({ summary: 'Upload promotional image for offer notification (Admin)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image'))
  async uploadOfferImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required for upload');
    }
    const result = await this.s3Service.uploadFile(file, 'notifications/offers');
    return {
      success: true,
      message: 'Promotional image uploaded successfully',
      data: {
        imageUrl: result.imageUrl,
        imageKey: result.imageKey,
      },
    };
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single notification' })
  async deleteNotification(
    @Param('id') id: string,
    @CurrentCustomer() customerId: number | string | undefined,
    @CurrentUser('id') userId: number | string,
  ) {
    const targetCustomerId = customerId || 1;
    return this.notificationService.deleteNotification(id, targetCustomerId, userId);
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
