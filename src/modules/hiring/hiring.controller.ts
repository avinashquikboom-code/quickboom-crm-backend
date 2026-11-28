import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AdminCreateCandidateDto,
  AdminUpdateCandidateDto,
  BulkDeleteCandidatesDto,
  ConvertCandidateToEmployeeDto,
  CreateHiringFormDto,
  PublicSubmitApplicationDto,
  ScheduleInterviewDto,
  UpdateHiringFormDto,
} from './dto/hiring.dto';
import { HiringService } from './hiring.service';

@ApiTags('Hiring & Recruitment')
@ApiBearerAuth('JWT-auth')
@Controller('hiring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HiringController {
  constructor(private readonly service: HiringService) {}

  // ── Public Candidate Form Endpoints ──────────────────────────────────────────

  @Public()
  @Get('public/:token')
  getPublicForm(@Param('token') token: string) {
    return this.service.getPublicFormByToken(token);
  }

  @Public()
  @Post('public/:token/apply')
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: 5 * 1024 * 1024 } }))
  submitPublicApplication(
    @Param('token') token: string,
    @Body() dto: PublicSubmitApplicationDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || 'unknown';
    return this.service.submitPublicApplication(token, dto, file, String(ip));
  }

  // ── Admin / HR Hiring Form Management ───────────────────────────────────────

  @Post('forms')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  createForm(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: CreateHiringFormDto,
  ) {
    return this.service.createForm(req.user, customerId, dto);
  }

  @Get('forms')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  listForms(@Request() req: any, @Query('customerId') customerId?: string) {
    return this.service.listForms(req.user, customerId);
  }

  @Patch('forms/:id')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  updateForm(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: UpdateHiringFormDto,
  ) {
    return this.service.updateForm(req.user, customerId, id, dto);
  }

  @Delete('forms/:id')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  deleteForm(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.deleteForm(req.user, customerId, id);
  }

  // ── Admin / HR Candidate Applications ───────────────────────────────────────

  @Get('applications')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  listApplications(
    @Request() req: any,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('interviewStatus') interviewStatus?: string,
    @Query('appliedFrom') appliedFrom?: string,
    @Query('appliedTo') appliedTo?: string,
    @Query('interviewFrom') interviewFrom?: string,
    @Query('interviewTo') interviewTo?: string,
  ) {
    return this.service.listApplications(req.user, customerId, {
      search,
      departmentId,
      interviewStatus,
      appliedFrom,
      appliedTo,
      interviewFrom,
      interviewTo,
    });
  }

  @Post('applications')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: 5 * 1024 * 1024 } }))
  createManualApplication(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: AdminCreateCandidateDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.createManualApplication(req.user, customerId, dto, file);
  }

  @Patch('applications/:id')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  updateApplication(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: AdminUpdateCandidateDto,
  ) {
    return this.service.updateApplication(req.user, customerId, id, dto);
  }

  @Delete('applications/bulk')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  deleteApplications(
    @Request() req: any,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: BulkDeleteCandidatesDto,
  ) {
    return this.service.deleteApplications(req.user, customerId, dto.ids);
  }

  @Delete('applications/:id')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  deleteApplication(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
  ) {
    return this.service.deleteApplications(req.user, customerId, [id]);
  }

  @Post('applications/:id/interview')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  scheduleInterview(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: ScheduleInterviewDto,
  ) {
    return this.service.scheduleInterview(req.user, customerId, id, dto);
  }

  @Get('applications/:id/resume')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  async downloadResume(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.getResumeBuffer(req.user, customerId, id);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(buffer);
  }

  @Post('applications/:id/convert')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  convertToEmployee(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerId: string | undefined,
    @Body() dto: ConvertCandidateToEmployeeDto,
  ) {
    return this.service.convertToEmployee(req.user, customerId, id, dto);
  }

  @Post('notifications/:logId/retry')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  retryNotification(
    @Request() req: any,
    @Param('logId', ParseIntPipe) logId: number,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.retryNotification(req.user, customerId, logId);
  }

  @Get('applications/export')
  @Roles('SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'SALES_MANAGER')
  async exportApplications(
    @Request() req: any,
    @Res() res: Response,
    @Query() query: any,
  ) {
    const out = await this.service.exportApplications(req.user, query?.customerId, query);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return res.send(out.buffer);
  }
}
