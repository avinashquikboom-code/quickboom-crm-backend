import { Body, Controller, Get, Param, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExportRequestDto, ExportService } from './export.service';

@ApiTags('Global Exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('exports')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('schemas')
  @ApiOperation({ summary: 'List export schemas and supported columns for all modules' })
  getSchemas() {
    return { data: this.exportService.getSchemas() };
  }

  @Get('history')
  @ApiOperation({ summary: 'List recent export history for current organization/user' })
  getHistory(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined) {
    return { data: this.exportService.getExportHistory(user, customerId) };
  }

  @Post('count')
  @ApiOperation({ summary: 'Count matching records for a module and active filters' })
  async countRecords(
    @Body() body: { module: string; filters?: Record<string, any> },
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    const count = await this.exportService.countRecords(body.module, body.filters || {}, user, customerId);
    return { count };
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate and stream PDF, Excel (.xlsx), or CSV export' })
  async generate(
    @Body() dto: ExportRequestDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.exportService.generateExport(dto, user, customerId);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Job-Id', result.jobId);
    res.setHeader('X-Export-Record-Count', String(result.recordCount));
    res.send(result.buffer);
  }

  @Post('zip')
  @ApiOperation({ summary: 'Download selected individual PDF documents as a ZIP archive' })
  async generateZip(
    @Body() dto: ExportRequestDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.exportService.generateZipArchive(dto, user, customerId);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Record-Count', String(result.recordCount));
    res.send(result.buffer);
  }

  @Get('leads/:id/pdf')
  @ApiOperation({ summary: 'Download individual Lead dossier PDF' })
  async downloadLeadPdf(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.exportService.generateIndividualLeadPdf(id, user, customerId);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  }
}
