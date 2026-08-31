import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { LocationService, LocationUpdateDto } from './location.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller()
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  // Mobile App API: POST /api/v1/mobile/location/update
  @Post('mobile/location/update')
  async updateMobileLocation(
    @Body() dto: LocationUpdateDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    const targetCustomerId = customerId || user?.customerId || 1;
    const employeeId = user?.employee?.id || user?.id || 1;
    return this.locationService.recordLocationUpdate(targetCustomerId, employeeId, dto);
  }

  // Admin Panel API: GET /api/v1/admin/location/live
  @Get('admin/location/live')
  async getLiveLocations(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = customerIdQuery || customerId || user?.customerId;
    return this.locationService.getLiveLocations(targetCustomerId);
  }

  // Admin Panel API: GET /api/v1/admin/location/history
  @Get('admin/location/history')
  async getLocationHistory(
    @Query('employeeId') employeeId: string,
    @Query('date') date: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = customerIdQuery || customerId || user?.customerId || 1;
    return this.locationService.getLocationHistory(
      targetCustomerId,
      employeeId,
      date || new Date().toISOString().split('T')[0],
    );
  }

  // Admin Panel API: GET /api/v1/admin/branches
  @Get('admin/branches')
  async getBranchGeofences(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = customerIdQuery || customerId || user?.customerId;
    return this.locationService.getBranchGeofences(targetCustomerId);
  }

  // Admin Panel API: POST /api/v1/admin/branches
  @Post('admin/branches')
  async createBranchGeofence(
    @Body() body: any,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomerId = customerIdQuery || customerId || user?.customerId || 1;
    return this.locationService.createBranchGeofence(targetCustomerId, body);
  }

  // Branch Location API: GET /api/v1/branches/:id/location
  @Get('branches/:id/location')
  async getBranchLocation(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    const targetCustomerId = customerId || user?.customerId;
    return this.locationService.getBranchLocation(Number(id), targetCustomerId);
  }

  // Branch Location API: PATCH /api/v1/branches/:id/location
  @Post('branches/:id/location')
  async updateBranchLocationPost(
    @Param('id') id: string,
    @Body() body: { latitude?: number; longitude?: number; radiusMeters?: number },
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    const targetCustomerId = customerId || user?.customerId;
    return this.locationService.updateBranchLocation(Number(id), targetCustomerId, body);
  }
}
