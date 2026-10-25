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
import { AccountGuard } from '../../common/guards/account.guard';
import { WorkspaceAccessGuard } from '../../common/guards/workspace-access.guard';
import { WorkspaceAction } from '../../common/decorators/workspace-action.decorator';

@ApiTags('Influencer Hub')
@Controller()
export class InfluencerController {
  constructor(
    private readonly influencerService: InfluencerService,
    private readonly s3Service: S3Service,
  ) {}

  private resolveCustomerId(req: any): number {
return undefined;
  }

  // =========================================================================
  // ADMIN PANEL MANAGEMENT APIS
  // =========================================================================

  // Categories
  @Get('admin/influencer-categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get all influencer categories (Admin)' })
  async getAllCategoriesAdmin() {
    const data = await this.influencerService.getAllCategoriesAdmin();
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencer-categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get all influencers including inactive (Admin)' })
  async getAllInfluencersAdmin(@Query() query: any) {
    const data = await this.influencerService.getAllInfluencersAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencers/upload-image')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get full influencer application profile for review (Admin)' })
  async getApplicationByIdAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id, true);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get single influencer details (Admin)' })
  async getInfluencerAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id);
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get all packages for an influencer (Admin)' })
  async getAllPackagesAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getAllPackagesAdmin(id);
    return { statusCode: 200, success: true, data };
  }

  @Post('admin/influencers/:id/packages')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'List all bookings with search, filters and pagination (Admin)' })
  async getAllBookingsAdmin(@Query() query: any) {
    const data = await this.influencerService.getAllBookingsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencer-bookings/stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get booking KPIs: totalBookings, pendingApproval, totalRevenue (Admin)' })
  async getBookingStatsAdmin() {
    const data = await this.influencerService.getBookingStatsAdmin();
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/influencer-bookings/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get single booking details with payments (Admin)' })
  async getBookingDetailsAdmin(@Param('id') id: string) {
    const data = await this.influencerService.getBookingById(0, id, true);
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/influencer-bookings/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
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
