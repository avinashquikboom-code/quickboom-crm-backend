import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
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
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get summary statistics and unique filter values for activity logs' })
  async getStats() {
    const data = await this.auditLogService.getStats();
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single audit log entry by ID' })
  async findById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.auditLogService.findById(id);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Get filtered and paginated activity audit logs' })
  async findAll(@Query() query: AuditLogFilterDto, @Req() req: any) {
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
  }
}
