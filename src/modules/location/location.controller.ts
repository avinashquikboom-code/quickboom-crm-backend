import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { LocationService, LocationUpdateDto } from './location.service';

@Controller()
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  // Mobile App API: POST /api/v1/mobile/location/update
  @Post('api/v1/mobile/location/update')
  async updateMobileLocation(@Body() dto: LocationUpdateDto, @Req() req: any) {
    // Authenticated employee & customer derived from JWT
    const customerId = req.user?.customerId || 'demo-customer-id';
    const employeeId = req.user?.id || 'demo-employee-id';

    return this.locationService.recordLocationUpdate(customerId, employeeId, dto);
  }

  // Admin Panel API: GET /api/v1/admin/location/live
  @Get('api/v1/admin/location/live')
  async getLiveLocations(@Req() req: any) {
    const customerId = req.user?.customerId || 'demo-customer-id';
    return this.locationService.getLiveLocations(customerId);
  }

  // Admin Panel API: GET /api/v1/admin/location/history
  @Get('api/v1/admin/location/history')
  async getLocationHistory(
    @Query('employeeId') employeeId: string,
    @Query('date') date: string,
    @Req() req: any,
  ) {
    const customerId = req.user?.customerId || 'demo-customer-id';
    return this.locationService.getLocationHistory(customerId, employeeId, date || new Date().toISOString().split('T')[0]);
  }

  // Admin Panel API: GET /api/v1/admin/branches
  @Get('api/v1/admin/branches')
  async getBranchGeofences(@Req() req: any) {
    const customerId = req.user?.customerId || 'demo-customer-id';
    return this.locationService.getBranchGeofences(customerId);
  }

  // Admin Panel API: POST /api/v1/admin/branches
  @Post('api/v1/admin/branches')
  async createBranchGeofence(@Body() body: any, @Req() req: any) {
    const customerId = req.user?.customerId || 'demo-customer-id';
    return this.locationService.createBranchGeofence(customerId, body);
  }
}
