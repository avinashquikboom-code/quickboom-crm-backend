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
    // Authenticated employee & tenant derived from JWT
    const tenantId = req.user?.tenantId || 'demo-tenant-id';
    const employeeId = req.user?.id || 'demo-employee-id';

    return this.locationService.recordLocationUpdate(tenantId, employeeId, dto);
  }

  // Admin Panel API: GET /api/v1/admin/location/live
  @Get('api/v1/admin/location/live')
  async getLiveLocations(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'demo-tenant-id';
    return this.locationService.getLiveLocations(tenantId);
  }

  // Admin Panel API: GET /api/v1/admin/location/history
  @Get('api/v1/admin/location/history')
  async getLocationHistory(
    @Query('employeeId') employeeId: string,
    @Query('date') date: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || 'demo-tenant-id';
    return this.locationService.getLocationHistory(tenantId, employeeId, date || new Date().toISOString().split('T')[0]);
  }

  // Admin Panel API: GET /api/v1/admin/branches
  @Get('api/v1/admin/branches')
  async getBranchGeofences(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'demo-tenant-id';
    return this.locationService.getBranchGeofences(tenantId);
  }

  // Admin Panel API: POST /api/v1/admin/branches
  @Post('api/v1/admin/branches')
  async createBranchGeofence(@Body() body: any, @Req() req: any) {
    const tenantId = req.user?.tenantId || 'demo-tenant-id';
    return this.locationService.createBranchGeofence(tenantId, body);
  }
}
