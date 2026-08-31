import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('HRMS Live Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('admin/hrms')
export class HrmsLiveDashboardController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('live-dashboard')
  @ApiOperation({ summary: 'Get full HRM Live Dashboard data (summary counters, employee statuses, offices, locations)' })
  async getLiveDashboard(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    return this.attendanceService.getLiveDashboardData(user, customerIdQuery || customerId, dateQuery);
  }

  @Get('live-employees')
  @ApiOperation({ summary: 'Get live employee status list' })
  async getLiveEmployees(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    return this.attendanceService.getLiveEmployees(user, customerIdQuery || customerId, dateQuery);
  }

  @Get('live-locations')
  @ApiOperation({ summary: 'Get live locations and office geofences for map' })
  async getLiveLocations(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    return this.attendanceService.getLiveLocations(user, customerIdQuery || customerId, dateQuery);
  }

  @Get('live-breaks')
  @ApiOperation({ summary: 'Get live break tracking data' })
  async getLiveBreaks(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    return this.attendanceService.getLiveBreaks(user, customerIdQuery || customerId, dateQuery);
  }

  @Get('attendance/today')
  @ApiOperation({ summary: "Get today's real attendance summary" })
  async getTodayAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    return this.attendanceService.getTodayAttendanceSummary(user, customerIdQuery || customerId, dateQuery);
  }
}
