import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { PunchAttendanceDto, QueryAttendanceHistoryDto } from './dto/punch.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('me')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get current employee attendance status and assigned office geofence' })
  async getMyStatus(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.attendanceService.getMyAttendanceStatus(user, customerId);
  }

  @Get('today')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get today attendance summary for authenticated employee' })
  async getToday(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.attendanceService.getTodayAttendance(user, customerId);
  }

  @Get('history')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get paginated attendance history for authenticated employee' })
  async getHistory(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query() query: QueryAttendanceHistoryDto,
  ) {
    return this.attendanceService.getAttendanceHistory(user, customerId, query);
  }

  @Post('check-in')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'Employee Check-In with mandatory GPS Geo-fence verification' })
  async checkIn(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: PunchAttendanceDto,
  ) {
    return this.attendanceService.checkIn(user, customerId, dto);
  }

  @Post('punch-in')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'Alias for Check-In' })
  async punchIn(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: PunchAttendanceDto,
  ) {
    return this.attendanceService.checkIn(user, customerId, dto);
  }

  @Post('check-out')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'Employee Check-Out with GPS verification' })
  async checkOut(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: PunchAttendanceDto,
  ) {
    return this.attendanceService.checkOut(user, customerId, dto);
  }

  @Post('punch-out')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'Alias for Check-Out' })
  async punchOut(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: PunchAttendanceDto,
  ) {
    return this.attendanceService.checkOut(user, customerId, dto);
  }

  @Post('break/start')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'Start Employee Break' })
  async startBreak(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto?: any,
  ) {
    return this.attendanceService.startBreak(user, customerId, dto);
  }

  @Post('break/end')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  @ApiOperation({ summary: 'End Employee Break' })
  async endBreak(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto?: any,
  ) {
    return this.attendanceService.endBreak(user, customerId, dto);
  }
}

