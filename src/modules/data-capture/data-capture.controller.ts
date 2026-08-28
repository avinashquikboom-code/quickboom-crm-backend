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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
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
} from './dto/data-capture.dto';

@ApiTags('Data Capture (Google Places & Leads Extraction)')
@ApiBearerAuth()
@Controller('data-capture')
@UseGuards(JwtAuthGuard, CustomerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DataCaptureController {
  constructor(private readonly dataCaptureService: DataCaptureService) {}

  /**
   * GET /api/v1/data-capture
   * List captured places with pagination, search, status, and source filters
   */
  @Get()
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
  @ApiOperation({ summary: 'Get customer extraction usage and remaining quota' })
  async getUsageSummary(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getUsageSummary(customerId);
  }

  @Post('usage')
  @ApiOperation({ summary: 'Alias for get usage summary (POST)' })
  async postUsageSummary(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getUsageSummary(customerId);
  }

  /**
   * POST /api/v1/data-capture/extract
   * Searches & captures verified business records via Google Places API (New) - Text Search
   */
  @Post('extract')
  @ApiOperation({ summary: 'Extract places from Google Places API' })
  async extractPlaces(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ExtractPlacesDto,
  ) {
    return this.dataCaptureService.extractPlaces(customerId, userId, dto);
  }

  /**
   * POST /api/v1/data-capture/import-to-leads
   * Batch imports captured prospects into CRM Leads with duplicate detection
   */
  @Post('import-to-leads')
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
  @ApiOperation({ summary: 'Get extraction job history' })
  async getCustomerJobs(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getCustomerJobs(customerId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Alias for extraction job history' })
  async getCustomerHistory(@CurrentCustomer() customerId: string) {
    return this.dataCaptureService.getCustomerJobs(customerId);
  }

  /**
   * GET /api/v1/data-capture/jobs/:id
   * Retrieves single extraction job details and captured places
   */
  @Get('jobs/:id')
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
  @ApiOperation({ summary: 'Execute bulk operations on Data Capture records' })
  async handleBulkAction(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BulkActionDto,
  ) {
    return this.dataCaptureService.handleBulkAction(customerId, userId, dto);
  }

  /**
   * POST /api/v1/data-capture
   * Manually create a Data Capture record
   */
  @Post()
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
  @ApiOperation({ summary: 'Convert single captured record to CRM Lead' })
  async createLeadFromPlace(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.createLeadFromPlace(customerId, userId, id);
  }

  /**
   * POST /api/v1/data-capture/:id/validate
   * Mark record as VALIDATED
   */
  @Post(':id/validate')
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
