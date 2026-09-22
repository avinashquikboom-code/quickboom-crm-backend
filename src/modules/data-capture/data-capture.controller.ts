import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
  UsePipes,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataCaptureService } from './data-capture.service';
import {
  ExtractPlacesDto,
  ImportToLeadsDto,
  CreateDataCaptureDto,
  UpdateDataCaptureDto,
  DataCaptureQueryDto,
  RejectDataCaptureDto,
  BulkActionDto,
  CreateLeadFromPlaceDto,
} from './dto/data-capture.dto';

@ApiTags('Data Capture (Google Places & Leads Extraction)')
@ApiBearerAuth()
@Controller('data-capture')
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DataCaptureController {
  constructor(private readonly dataCaptureService: DataCaptureService) {}

  /**
   * GET /api/v1/data-capture
   * List captured places with pagination, search, status, and source filters
   */
  @Get()
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'List captured places with pagination and filtering' })
  async listPlaces(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query() query: DataCaptureQueryDto,
  ) {
    return this.dataCaptureService.listPlaces(customerId, query, user);
  }

  /**
   * GET & POST /api/v1/data-capture/usage
   * Retrieves extraction quota and Google Places API consumption metrics
   */
  @Get('usage')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get customer extraction usage and remaining quota' })
  async getUsageSummary(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getUsageSummary(customerId);
  }

  @Post('usage')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Alias for get usage summary (POST)' })
  async postUsageSummary(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getUsageSummary(customerId);
  }

  /**
   * POST /api/v1/data-capture/extract
   * Searches & captures verified business records via Google Places API (New) - Text Search
   */
  @Post('extract')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'CREATE' })
  @ApiOperation({ summary: 'Extract places from Google Places API' })
  async extractPlaces(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: ExtractPlacesDto,
  ) {
    return this.dataCaptureService.extractPlaces(customerId, user, dto);
  }

  /**
   * POST /api/v1/data-capture/import-to-leads
   * Batch imports captured prospects into CRM Leads with duplicate detection
   */
  @Post('import-to-leads')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Import captured places into CRM Leads in batch' })
  async importToLeads(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ImportToLeadsDto,
  ) {
    return this.dataCaptureService.importToLeads(customerId, userId, dto);
  }

  /**
   * GET /api/v1/data-capture/jobs & /api/v1/data-capture/history
   * Retrieves past extraction jobs for the customer
   */
  @Get('jobs')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get extraction job history' })
  async getCustomerJobs(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getCustomerJobs(customerId);
  }

  @Get('history')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Alias for extraction job history' })
  async getCustomerHistory(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getCustomerJobs(customerId);
  }

  /**
   * GET /api/v1/data-capture/jobs/:id
   * Retrieves single extraction job details and captured places
   */
  @Get('jobs/:id')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get single extraction job details' })
  async getJobById(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.getJobById(customerId, id);
  }

  /**
   * POST /api/v1/data-capture/bulk
   * Executes bulk action (validate, reject, delete, mark duplicate, import)
   */
  @Post('bulk')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Execute bulk operations on Data Capture records' })
  async handleBulkAction(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: BulkActionDto,
  ) {
    if (String(dto.action).toUpperCase() === 'DELETE') {
      const userRoles: string[] = Array.isArray(user.roles)
        ? user.roles.map((r: any) => String(r).toUpperCase().replace(/\s+/g, '_'))
        : (user.role ? [String(user.role).toUpperCase().replace(/\s+/g, '_')] : []);
      const isSuper = userRoles.some((r) => ['SUPER_ADMIN', 'CUSTOMER_ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN'].includes(r));
      if (!isSuper) {
        const userPerms: { module?: string; action?: string }[] = user.permissions || [];
        const hasDelete = userPerms.some((p) => {
          const mod = (p.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/\./g, '_');
          const act = (p.action || '').toUpperCase();
          return (mod === 'DATA_CAPTURE' || mod === 'DATACAPTURE') && (act === 'DELETE' || act === 'MANAGE' || act === 'ALL');
        });
        if (!hasDelete) {
          throw new ForbiddenException('Access denied: Missing required permission [DATA_CAPTURE:DELETE]');
        }
      }
    }
    const userId = user?.id || user?.userId || '';
    return this.dataCaptureService.handleBulkAction(customerId, String(userId), dto);
  }

  /**
   * POST /api/v1/data-capture
   * Manually create a Data Capture record
   */
  @Post()
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'CREATE' })
  @ApiOperation({ summary: 'Manually create a new Data Capture record' })
  async createPlace(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDataCaptureDto,
  ) {
    return this.dataCaptureService.createPlace(customerId, userId, dto);
  }

  /**
   * POST /api/v1/data-capture/:id/create-lead
   * Direct 1-click lead conversion from captured record with duplicate checking
   */
  @Post(':id/create-lead')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Convert single captured record to CRM Lead' })
  async createLeadFromPlace(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto?: CreateLeadFromPlaceDto,
  ) {
    return this.dataCaptureService.createLeadFromPlace(customerId, userId, id, dto?.captureRequestId);
  }

  /**
   * POST /api/v1/data-capture/:id/validate
   * Mark record as VALIDATED
   */
  @Post(':id/validate')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Mark captured record as VALIDATED' })
  async validatePlace(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.validatePlace(customerId, id);
  }

  /**
   * POST /api/v1/data-capture/:id/reject
   * Mark record as REJECTED
   */
  @Post(':id/reject')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Mark captured record as REJECTED with optional reason' })
  async rejectPlace(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: RejectDataCaptureDto,
  ) {
    return this.dataCaptureService.rejectPlace(customerId, id, dto);
  }

  /**
   * POST /api/v1/data-capture/:id/duplicate-check
   * Check duplicate matches for record
   */
  @Post(':id/duplicate-check')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Scan CRM database for possible duplicates' })
  async checkDuplicates(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.checkDuplicates(customerId, id);
  }

  /**
   * POST /api/v1/data-capture/:id/import
   * Alias for job places import
   */
  @Post(':id/import')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Import job places into CRM Leads' })
  async importJobToLeads(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: { placeIds?: string[] },
  ) {
    return this.dataCaptureService.importToLeads(customerId, userId, {
      jobId,
      placeIds: dto?.placeIds,
    });
  }

  /**
   * PATCH /api/v1/data-capture/:id
   * Update Data Capture record fields
   */
  @Patch(':id')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'EDIT' })
  @ApiOperation({ summary: 'Update Data Capture record details' })
  async updatePlace(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDataCaptureDto,
  ) {
    return this.dataCaptureService.updatePlace(customerId, id, dto);
  }

  /**
   * DELETE /api/v1/data-capture/:id
   * Soft delete Data Capture record
   */
  @Delete(':id')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'DELETE' })
  @ApiOperation({ summary: 'Soft delete Data Capture record' })
  async deletePlace(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.deletePlace(customerId, id);
  }

  /**
   * GET /api/v1/data-capture/:id
   * Retrieves single Data Capture place (or extraction job if ID starts with job-)
   */
  @Get(':id')
  @RequirePermissions({ module: 'DATA_CAPTURE', action: 'VIEW' })
  @ApiOperation({ summary: 'Get single Data Capture record or job details' })
  async getPlaceOrJobById(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    if (id.startsWith('job-')) {
      return this.dataCaptureService.getJobById(customerId, id);
    }
    return this.dataCaptureService.getPlaceById(customerId, id);
  }
}
