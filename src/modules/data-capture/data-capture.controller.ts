import {
  Controller,
  Post,
  Get,
  Body,
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
   * GET /api/v1/data-capture/jobs
   * Retrieves past extraction jobs for the tenant
   */
  @Get('jobs')
  async getTenantJobs(@CurrentTenant() tenantId: string) {
    return this.dataCaptureService.getTenantJobs(tenantId);
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
