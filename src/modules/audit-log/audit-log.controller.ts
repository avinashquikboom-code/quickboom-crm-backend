import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { AuditLogFilterDto } from './dto/audit-log.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Audit & Activity Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogController {
  private readonly logger = new Logger(AuditLogController.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get summary statistics and unique filter values for activity logs' })
  async getStats() {
    try {
      const data = await this.auditLogService.getStats();
      return {
        statusCode: 200,
        success: true,
        data,
      };
    } catch (err: any) {
      this.logger.error(`[AUDIT_STATS] Failed to fetch audit log stats: ${err?.message}`, err?.stack);
      // Return a safe empty result so the UI does not crash
      return {
        statusCode: 200,
        success: true,
        data: {
          total: 0,
          adminCount: 0,
          mobileCount: 0,
          successCount: 0,
          failedCount: 0,
          modules: [],
          actions: [],
        },
      };
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single audit log entry by ID' })
  async findById(@Param('id', ParseIntPipe) id: number) {
    try {
      const data = await this.auditLogService.findById(id);
      return {
        statusCode: 200,
        success: true,
        data,
      };
    } catch (err: any) {
      this.logger.error(`[AUDIT_FIND_BY_ID] Error fetching log #${id}: ${err?.message}`, err?.stack);
      throw err; // Re-throw NotFoundException etc. so HTTP status is correct
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get filtered and paginated activity audit logs' })
  async findAll(@Query() query: AuditLogFilterDto, @Req() req: any) {
    try {
      // If not super admin, scope to customer if customerId is present on user
      const user = req.user;
      if (user?.customerId && !query.customerId && user?.role !== 'SUPER_ADMIN') {
        query.customerId = user.customerId;
      }

      const result = await this.auditLogService.findAll(query);
      return {
        statusCode: 200,
        success: true,
        data: result.items,
        items: result.items,
        pagination: result.pagination,
        meta: result.meta,
      };
    } catch (err: any) {
      this.logger.error(`[AUDIT_FIND_ALL] Failed to fetch audit logs: ${err?.message}`, err?.stack);
      // Return a safe empty result so the UI does not crash
      const page = Number(query.page || 1);
      const limit = Number(query.limit || 20);
      return {
        statusCode: 200,
        success: true,
        data: [],
        items: [],
        pagination: { page, pageSize: limit, limit, total: 0, totalPages: 1 },
        meta: { total: 0, page, limit, totalPages: 1 },
      };
    }
  }
}
