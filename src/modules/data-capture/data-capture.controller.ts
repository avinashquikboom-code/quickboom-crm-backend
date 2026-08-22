import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { ExtractPlacesDto, ImportToLeadsDto } from './dto/data-capture.dto';

@ApiTags('Data Capture (Google Places)')
@ApiBearerAuth()
@Controller('data-capture')
@UseGuards(JwtAuthGuard, CustomerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DataCaptureController {
  constructor(private readonly dataCaptureService: DataCaptureService) {}

  /**
   * GET & POST /api/v1/data-capture/usage
   * Retrieves extraction quota and Google Places API consumption metrics
   * (Declared first to avoid parameter collision)
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
   * Imports captured Google Places prospects into CRM Leads with duplicate detection
   */
  @Post('import-to-leads')
  @ApiOperation({ summary: 'Import captured places into CRM Leads' })
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
   * POST /api/v1/data-capture/:id/import
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
   * GET /api/v1/data-capture/:id (Declared at the end to prevent wildcard route interception)
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get job by ID alias' })
  async getJobByIdAlias(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.getJobById(customerId, id);
  }
}
