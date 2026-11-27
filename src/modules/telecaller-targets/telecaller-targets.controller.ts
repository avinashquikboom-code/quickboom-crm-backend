import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TelecallerTargetsService } from './telecaller-targets.service';
import {
  AssignTelecallerTargetDto,
  RecordCallEventDto,
  UpdateTelecallerTargetDto,
  UpsertTelecallerTargetPolicyDto,
} from './dto/telecaller-targets.dto';

@ApiTags('Telecaller Targets & Performance')
@ApiBearerAuth('JWT-auth')
@Controller('telecaller-targets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelecallerTargetsController {
  constructor(private readonly service: TelecallerTargetsService) {}

  @Get('metrics')
  getMetricCatalog() {
    return { success: true, data: this.service.getMetricCatalog() };
  }

  @Get('policy')
  getPolicy(@Request() req: any, @Query('customerId') customerId?: string) {
    return this.service.getPolicy(req.user, customerId);
  }

  @Put('policy')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  upsertPolicy(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: UpsertTelecallerTargetPolicyDto,
  ) {
    return this.service.upsertPolicy(req.user, customerId, dto);
  }

  @Post('assignments')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  assignTargets(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: AssignTelecallerTargetDto,
  ) {
    return this.service.assignTargets(req.user, customerId, dto);
  }

  @Get('assignments')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  listTargets(
    @Request() req: any,
    @Query('customerId') customerId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('periodType') periodType?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.listTargets(req.user, customerId, {
      employeeId: employeeId ? Number(employeeId) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      periodType,
      activeOnly: activeOnly === undefined ? true : activeOnly === 'true',
    });
  }

  @Patch('assignments/:id')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  updateTarget(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: UpdateTelecallerTargetDto,
  ) {
    return this.service.updateTarget(req.user, customerId, id, dto);
  }

  @Get('history')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  getTargetHistory(
    @Request() req: any,
    @Query('customerId') customerId?: string,
    @Query('assignmentId') assignmentId?: string,
  ) {
    return this.service.getTargetHistory(
      req.user,
      customerId,
      assignmentId ? Number(assignmentId) : undefined,
    );
  }

  @Get('my/today')
  getMyTodayTargets(@Request() req: any, @Query('customerId') customerId?: string) {
    return this.service.getMyTodayTargets(req.user, customerId);
  }

  @Get('my/analysis')
  getMyAnalysis(
    @Request() req: any,
    @Query('customerId') customerId?: string,
    @Query('range') range?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.getEmployeeAnalysis(req.user, customerId, {
      range,
      fromDate,
      toDate,
    });
  }

  @Post('events/call')
  recordCallEvent(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: RecordCallEventDto,
  ) {
    return this.service.recordCallEvent(req.user, customerId, dto);
  }

  @Get('dashboard')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  getAdminDashboard(
    @Request() req: any,
    @Query('customerId') customerId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('achievementStatus') achievementStatus?: string,
  ) {
    return this.service.getAdminDashboard(req.user, customerId, {
      employeeId: employeeId ? Number(employeeId) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      fromDate,
      toDate,
      achievementStatus,
    });
  }

  @Get('dashboard/employee/:employeeId')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  getEmployeeDetail(
    @Request() req: any,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('customerId') customerId?: string,
    @Query('range') range?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.getEmployeeAnalysis(req.user, customerId, {
      employeeId,
      range,
      fromDate,
      toDate,
    });
  }

  @Get('dashboard/export')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  async exportAdminDashboard(
    @Request() req: any,
    @Res() res: Response,
    @Query('customerId') customerId?: string,
    @Query('format') format?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('achievementStatus') achievementStatus?: string,
  ) {
    const out = await this.service.exportAdminDashboard(req.user, customerId, {
      format,
      employeeId: employeeId ? Number(employeeId) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      fromDate,
      toDate,
      achievementStatus,
    });
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return res.send(out.buffer);
  }

  @Get('reports/:id/pdf')
  async downloadReportPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { buffer, filename } = await this.service.generateReportPdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  @Post('reports/:id/retry')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  retryReportDelivery(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: { channels?: Array<'EMAIL' | 'WHATSAPP'> },
  ) {
    return this.service.dispatchReportDeliveries(id, body?.channels);
  }
}
