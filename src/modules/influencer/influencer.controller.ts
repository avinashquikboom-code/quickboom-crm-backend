import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { InfluencerService } from './influencer.service';
import { S3Service } from '../s3/s3.service';
import {
  CreateInfluencerDto,
  FilterInfluencersQueryDto,
  FilterInfluencerApplicationsQueryDto,
  UpdateInfluencerDto,
  CreateInfluencerCategoryDto,
  UpdateInfluencerCategoryDto,
  CreateInfluencerPackageDto,
  UpdateInfluencerPackageDto,
  SetInfluencerAvailabilityDto,
  CreateInfluencerBookingDto,
  VerifyInfluencerPaymentDto,
  UpdateBookingStatusDto,
  UpdatePaymentStatusDto,
  RegisterInfluencerDto,
  RejectInfluencerDto,
  ResubmitInfluencerDto,
} from './dto/influencer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Influencer Hub')
@Controller()
export class InfluencerController {
  constructor(
    private readonly influencerService: InfluencerService,
    private readonly s3Service: S3Service,
  ) {}

  private resolveCustomerId(req: any): number {
    const user = req.user;
    const rawId =
      user?.customerId ??
      (user?.role === 'CUSTOMER' ? user?.customerId || user?.id : undefined) ??
      req.headers?.['x-customer-id'];
    const parsed = parseInt(String(rawId), 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new ForbiddenException('Valid customer authentication session is required');
    }
    return parsed;
  }

  // =========================================================================
  // PUBLIC / CUSTOMER BROWSING APIS
  // =========================================================================

  @Get(['influencers/categories', 'customer/influencer-categories'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get active influencer categories with creator counts' })
  async getCategories() {
    const data = await this.influencerService.getCategories();
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencers', 'customer/influencers'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get active influencers for Customer Home and Listing screen' })
  async getActiveInfluencers(@Query() query: FilterInfluencersQueryDto) {
    const data = await this.influencerService.getActiveInfluencers(query);
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencers/application-status', 'customer/influencers/application-status'])
  @ApiOperation({ summary: 'Check influencer application status by email or ID' })
  async getApplicationStatus(
    @Query('email') email?: string,
    @Query('id') id?: string,
    @Req() req?: any,
  ) {
    const identifier = id || email || req?.user?.email;
    if (!identifier) {
      throw new ForbiddenException('Email or application ID required to check status');
    }
    const data = await this.influencerService.getApplicationStatus(identifier);
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencers/:id', 'customer/influencers/:id'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get single influencer details with packages and availability' })
  async getInfluencerById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id);
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencers/:id/packages', 'customer/influencers/:id/packages'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get active packages for an influencer' })
  async getPackages(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getPackages(id);
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencers/:id/availability', 'customer/influencers/:id/availability'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get available dates and time slots for an influencer' })
  async getAvailability(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.influencerService.getAvailability(id, startDate, endDate);
    return { statusCode: 200, success: true, data };
  }

  @Post(['influencers/:id/favorite', 'customer/influencers/:id/favorite'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' })
  @ApiOperation({ summary: 'Toggle favorite status for an influencer' })
  async toggleFavorite(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const customerId = req.user?.customerId || req.user?.id;
    const data = await this.influencerService.toggleFavorite(id, customerId);
    return { statusCode: 200, success: true, data };
  }

  // =========================================================================
  // SELF-REGISTRATION & APPLICATION STATUS APIS
  // =========================================================================

  @Post(['influencers/register', 'customer/influencers/register'])
  @ApiOperation({ summary: 'Self-register as a new influencer (starts in PENDING status)' })
  async registerInfluencer(@Body() dto: RegisterInfluencerDto) {
    const result = await this.influencerService.registerInfluencer(dto);
    return {
      statusCode: 201,
      success: true,
      message: result.message,
      status: result.status,
      data: result.influencer,
    };
  }

  @Patch(['influencers/:id/resubmit', 'customer/influencers/:id/resubmit'])
  @ApiOperation({ summary: 'Resubmit a rejected influencer application' })
  async resubmitApplication(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResubmitInfluencerDto,
  ) {
    const result = await this.influencerService.resubmitApplication(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: result.message,
      status: result.status,
      data: result.influencer,
    };
  }

  // =========================================================================
  // CUSTOMER BOOKING FLOW (ISOLATED TO CURRENT LOGGED-IN CUSTOMER)
  // =========================================================================

  @Post(['influencer-bookings', 'customer/influencer-bookings'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCER_BOOKINGS', action: 'VIEW' })
  @ApiOperation({ summary: 'Create a new influencer booking and initialize payment' })
  async createBooking(@Req() req: any, @Body() dto: CreateInfluencerBookingDto) {
    const customerId = this.resolveCustomerId(req);
    const result = await this.influencerService.createBooking(customerId, dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Influencer booking created successfully',
      data: result.booking,
      ...result,
    };
  }

  @Post([
    'influencer-bookings/verify-payment',
    'customer/influencer-bookings/verify-payment',
    'influencer-bookings/:id/verify-payment',
    'customer/influencer-bookings/:id/verify-payment',
  ])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCER_BOOKINGS', action: 'VIEW' })
  @ApiOperation({ summary: 'Verify server-side Razorpay payment and confirm booking' })
  async verifyPayment(
    @Req() req: any,
    @Body() dto: VerifyInfluencerPaymentDto,
    @Param('id') paramId?: string,
  ) {
    const customerId = this.resolveCustomerId(req);
    if (paramId && !dto.bookingId) {
      dto.bookingId = paramId;
    }
    const result = await this.influencerService.verifyBookingPayment(customerId, dto);
    return {
      statusCode: 200,
      success: true,
      message: result.message,
      data: result.booking,
      booking: result.booking,
    };
  }

  @Get(['influencer-bookings/my', 'customer/influencer-bookings/my'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCER_BOOKINGS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get current customer bookings with isolation and status filter' })
  async getMyBookings(@Req() req: any, @Query('status') status?: string) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.influencerService.getMyBookings(customerId, status);
    return { statusCode: 200, success: true, data };
  }

  @Get(['influencer-bookings/:id', 'customer/influencer-bookings/:id'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCER_BOOKINGS', action: 'VIEW' })
  @ApiOperation({ summary: 'Get booking details by ID (enforcing customer isolation)' })
  async getBookingById(@Req() req: any, @Param('id') id: string) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.influencerService.getBookingById(customerId, id);
    return { statusCode: 200, success: true, data };
  }

  @Post(['influencer-bookings/:id/cancel', 'customer/influencer-bookings/:id/cancel'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_INFLUENCER_BOOKINGS', action: 'VIEW' })
  @ApiOperation({ summary: 'Cancel an upcoming booking' })
  async cancelBooking(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.influencerService.cancelBooking(customerId, id, reason);
    return {
      statusCode: 200,
      success: true,
      message: 'Booking cancelled successfully',
      data,
    };
  }

  // =========================================================================
  // ADMIN PANEL MANAGEMENT APIS
  // =========================================================================

  // Categories
  @Get('admin/influencer-categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all influencer categories (Admin)' })
  async getAllCategoriesAdmin() {
    const data = await this.influencerService.getAllCategoriesAdmin();
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencer-categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create new influencer category (Admin)' })
  async createCategory(@Body() dto: CreateInfluencerCategoryDto) {
    const data = await this.influencerService.createCategory(dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Category created successfully',
      data,
    };
  }

  @Patch('admin/influencer-categories/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update influencer category (Admin)' })
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInfluencerCategoryDto,
  ) {
    const data = await this.influencerService.updateCategory(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Category updated successfully',
      data,
    };
  }

  @Delete('admin/influencer-categories/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete influencer category (Admin)' })
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.deleteCategory(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Category deleted successfully',
      data,
    };
  }

  // Influencers
  @Get('admin/influencers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all influencers including inactive (Admin)' })
  async getAllInfluencersAdmin(@Query() query: any) {
    const data = await this.influencerService.getAllInfluencersAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencers/upload-image')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Upload influencer profile image to S3 (Admin)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image'))
  async uploadInfluencerImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required for upload');
    }
    const result = await this.s3Service.uploadFile(file, 'influencers');
    return {
      statusCode: 200,
      success: true,
      message: 'Influencer image uploaded successfully',
      data: {
        imageUrl: result.imageUrl,
        imageKey: result.imageKey,
      },
    };
  }

  @Post('admin/influencers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create new influencer (Admin)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image'))
  async createInfluencer(
    @Body() dto: CreateInfluencerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const result = await this.s3Service.uploadFile(file, 'influencers');
      dto.profileImage = result.imageUrl;
      dto.avatarUrl = result.imageUrl;
    }
    const data = await this.influencerService.createInfluencer(dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Influencer created successfully',
      data,
    };
  }

  // =========================================================================
  // ADMIN APPLICATION REVIEW & APPROVAL APIS
  // =========================================================================

  @Get('admin/influencers/applications')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get influencer applications filtered by status (Admin)' })
  async getInfluencerApplicationsAdmin(@Query() query: FilterInfluencerApplicationsQueryDto) {
    const result = await this.influencerService.getInfluencerApplicationsAdmin(query);
    return {
      statusCode: 200,
      success: true,
      data: result.items,
      counts: result.counts,
    };
  }

  @Get('admin/influencers/applications/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get full influencer application profile for review (Admin)' })
  async getApplicationByIdAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id, true);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get single influencer details (Admin)' })
  async getInfluencerAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id);
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update influencer details/status (Admin)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image'))
  async updateInfluencer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInfluencerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const result = await this.s3Service.uploadFile(file, 'influencers');
      dto.profileImage = result.imageUrl;
      dto.avatarUrl = result.imageUrl;
    }
    const data = await this.influencerService.updateInfluencer(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Influencer updated successfully',
      data,
    };
  }

  @Delete('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete or deactivate influencer (Admin)' })
  async deleteInfluencer(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.deleteInfluencer(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Influencer deleted successfully',
      data,
    };
  }

  @Patch('admin/influencers/:id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Approve influencer application to make them live in mobile hub (Admin)' })
  async approveInfluencerAdmin(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const adminId = req.user?.id;
    const result = await this.influencerService.approveInfluencerAdmin(id, adminId);
    return {
      statusCode: 200,
      success: true,
      message: result.message,
      status: result.status,
      data: result.influencer,
    };
  }

  @Patch('admin/influencers/:id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Reject influencer application with a reason (Admin)' })
  async rejectInfluencerAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectInfluencerDto,
    @Req() req: any,
  ) {
    const adminId = req.user?.id;
    const result = await this.influencerService.rejectInfluencerAdmin(id, dto, adminId);
    return {
      statusCode: 200,
      success: true,
      message: result.message,
      status: result.status,
      rejectionReason: result.rejectionReason,
      data: result.influencer,
    };
  }

  @Patch('admin/influencers/:id/suspend')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Suspend an approved influencer (removes from mobile hub) (Admin)' })
  async suspendInfluencerAdmin(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const adminId = req.user?.id;
    const result = await this.influencerService.suspendInfluencerAdmin(id, adminId);
    return {
      statusCode: 200,
      success: true,
      message: result.message,
      status: result.status,
      data: result.influencer,
    };
  }

  // Packages
  @Get('admin/influencers/:id/packages')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all packages for an influencer (Admin)' })
  async getAllPackagesAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getAllPackagesAdmin(id);
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencers/:id/packages')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create package for influencer (Admin)' })
  async createPackage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateInfluencerPackageDto,
  ) {
    const data = await this.influencerService.createPackage(id, dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Package created successfully',
      data,
    };
  }

  @Patch('admin/influencer-packages/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update influencer package (Admin)' })
  async updatePackage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInfluencerPackageDto,
  ) {
    const data = await this.influencerService.updatePackage(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Package updated successfully',
      data,
    };
  }

  @Delete('admin/influencer-packages/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete influencer package (Admin)' })
  async deletePackage(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.deletePackage(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Package deleted successfully',
      data,
    };
  }

  // Availability
  @Get('admin/influencers/:id/availability')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get influencer availability (Admin)' })
  async getAvailabilityAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.influencerService.getAvailability(id, startDate, endDate);
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencers/:id/availability')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Set or toggle date availability for influencer (Admin)' })
  async setAvailability(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetInfluencerAvailabilityDto,
  ) {
    const data = await this.influencerService.setAvailability(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Availability updated successfully',
      data,
    };
  }

  @Delete('admin/influencer-availability/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Remove availability slot (Admin)' })
  async deleteAvailability(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.deleteAvailability(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Availability slot deleted successfully',
      data,
    };
  }

  // Bookings Management
  @Get('admin/influencer-bookings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'List all bookings with search, filters and pagination (Admin)' })
  async getAllBookingsAdmin(@Query() query: any) {
    const data = await this.influencerService.getAllBookingsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencer-bookings/stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get booking KPIs: totalBookings, pendingApproval, totalRevenue (Admin)' })
  async getBookingStatsAdmin() {
    const data = await this.influencerService.getBookingStatsAdmin();
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencer-bookings/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get single booking details with payments (Admin)' })
  async getBookingDetailsAdmin(@Param('id') id: string) {
    const data = await this.influencerService.getBookingById(0, id, true);
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/influencer-bookings/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update booking status (Admin)' })
  async updateBookingStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    const data = await this.influencerService.updateBookingStatusAdmin(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Booking status updated successfully',
      data,
    };
  }

  @Patch('admin/influencer-bookings/:id/payment-status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update payment status (Admin)' })
  async updatePaymentStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    const data = await this.influencerService.updatePaymentStatusAdmin(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Payment status updated successfully',
      data,
    };
  }

  @Post('admin/influencer-bookings/:id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Approve pending booking (Admin)' })
  async approveBooking(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.approveBookingAdmin(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Booking approved successfully',
      data,
    };
  }

  @Post('admin/influencer-bookings/:id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Reject booking (Admin)' })
  async rejectBooking(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    const data = await this.influencerService.rejectBookingAdmin(id, reason);
    return {
      statusCode: 200,
      success: true,
      message: 'Booking rejected successfully',
      data,
    };
  }

  @Post('admin/influencer-bookings/:id/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Cancel booking (Admin)' })
  async cancelBookingAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    const data = await this.influencerService.cancelBooking(0, id, reason, true);
    return {
      statusCode: 200,
      success: true,
      message: 'Booking cancelled by admin',
      data,
    };
  }
}
