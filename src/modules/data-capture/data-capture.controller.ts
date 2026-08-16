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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataCaptureService } from './data-capture.service';
import { ExtractPlacesDto, ImportToLeadsDto } from './dto/data-capture.dto';

@Controller('data-capture')
@UseGuards(JwtAuthGuard, TenantGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DataCaptureController {
  constructor(private readonly dataCaptureService: DataCaptureService) {}

  /**
   * POST /api/v1/data-capture/extract
   * Searches & captures verified business records via Google Places API (New) - Text Search
   */
  @Post('extract')
  async extractPlaces(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ExtractPlacesDto,
  ) {
    return this.dataCaptureService.extractPlaces(tenantId, userId, dto);
  }

  /**
   * POST /api/v1/data-capture/import-to-leads
   * Imports captured Google Places prospects into CRM Leads with duplicate detection
   */
  @Post('import-to-leads')
  async importToLeads(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ImportToLeadsDto,
  ) {
    return this.dataCaptureService.importToLeads(tenantId, userId, dto);
  }

  /**
   * POST /api/v1/data-capture/:id/import
   */
  @Post(':id/import')
  async importJobToLeads(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: { placeIds?: string[] },
  ) {
    return this.dataCaptureService.importToLeads(tenantId, userId, {
      jobId,
      placeIds: dto?.placeIds,
    });
  }

  /**
   * GET /api/v1/data-capture/jobs & /api/v1/data-capture/history
   * Retrieves past extraction jobs for the tenant
   */
  @Get('jobs')
  async getTenantJobs(@CurrentTenant() tenantId: string) {
    return this.dataCaptureService.getTenantJobs(tenantId);
  }

  @Get('history')
  async getTenantHistory(@CurrentTenant() tenantId: string) {
    return this.dataCaptureService.getTenantJobs(tenantId);
  }

  /**
   * GET /api/v1/data-capture/jobs/:id & /api/v1/data-capture/:id
   * Retrieves single extraction job details and captured places
   */
  @Get('jobs/:id')
  async getJobById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.getJobById(tenantId, id);
  }

  @Get(':id')
  async getJobByIdAlias(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.dataCaptureService.getJobById(tenantId, id);
  }

  /**
   * GET /api/v1/data-capture/usage
   * Retrieves extraction quota and Google Places API consumption metrics
   */
  @Get('usage')
  async getUsageSummary(@CurrentTenant() tenantId: string) {
    return this.dataCaptureService.getUsageSummary(tenantId);
  }
}
