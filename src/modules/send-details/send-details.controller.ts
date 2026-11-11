import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { S3Service } from '../s3/s3.service';
import { SendDetailsService } from './send-details.service';
import {
  CreateSendDetailsDocumentDto,
  UpdateSendDetailsDocumentDto,
  UpdateSendDetailsConfigDto,
  ManualSendDetailsDto,
  RetryDeliveryDto,
} from './dto/send-details.dto';

@ApiTags('Send Details')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SendDetailsController {
  private readonly logger = new Logger(SendDetailsController.name);

  constructor(
    private readonly sendDetailsService: SendDetailsService,
    private readonly s3Service: S3Service,
  ) {}

  // -------------------------------------------------------------
  // ADMIN & CONFIGURATION ENDPOINTS
  // -------------------------------------------------------------

  @Get('admin/send-details/documents')
  @ApiOperation({ summary: 'Get all configured Send Details documents' })
  async getDocuments(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getDocuments(cid);
  }

  @Post('admin/send-details/documents')
  @ApiOperation({ summary: 'Add a new Send Details document' })
  async createDocument(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateSendDetailsDocumentDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.createDocument(cid, dto);
  }

  @Patch('admin/send-details/documents/:id')
  @ApiOperation({ summary: 'Update a Send Details document' })
  async updateDocument(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSendDetailsDocumentDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.updateDocument(cid, id, dto);
  }

  @Delete('admin/send-details/documents/:id')
  @ApiOperation({ summary: 'Delete a Send Details document' })
  async deleteDocument(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.deleteDocument(cid, id);
  }

  @Post('admin/send-details/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document attachment for Send Details (PDF, Doc, Image)' })
  async uploadDocumentFile(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }

    const cid = Number(customerId || user?.customerId);
    let fileUrl: string;

    try {
      // 1. Attempt S3 upload
      const s3Result = await this.s3Service.uploadFile(file, `send-details/${cid}`);
      fileUrl = s3Result.imageUrl;
    } catch (s3Error: any) {
      this.logger.warn(`[SEND_DETAILS] S3 upload failed or unavailable: ${s3Error?.message}. Using local storage.`);
      // 2. Local fallback
      const uploadsDir = path.join(process.cwd(), 'uploads', 'send-details', String(cid));
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const safeOriginalName = (file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeOriginalName}`;
      const filePath = path.join(uploadsDir, filename);

      fs.writeFileSync(filePath, file.buffer);
      fileUrl = `/uploads/send-details/${cid}/${filename}`;
    }

    return {
      fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
    };
  }

  @Get('admin/send-details/config')
  @ApiOperation({ summary: 'Get current Send Details automation configuration' })
  async getConfig(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getConfig(cid);
  }

  @Patch('admin/send-details/config')
  @ApiOperation({ summary: 'Update Send Details automation configuration' })
  async updateConfig(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateSendDetailsConfigDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.updateConfig(cid, dto);
  }

  @Get('admin/send-details/history')
  @ApiOperation({ summary: 'Get Send Details delivery history for all leads' })
  async getAdminHistory(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('leadId') leadId?: string,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getDeliveryHistory(cid, leadId ? Number(leadId) : undefined);
  }

  @Get('admin/send-details/leads/:leadId/history')
  @ApiOperation({ summary: 'Get Send Details delivery history for a specific lead' })
  async getLeadHistoryAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('leadId', ParseIntPipe) leadId: number,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getDeliveryHistory(cid, leadId);
  }

  @Post('admin/send-details/leads/:leadId/send')
  @ApiOperation({ summary: 'Manually send business details to lead from Admin' })
  async manualSendAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('leadId', ParseIntPipe) leadId: number,
    @Body() dto: ManualSendDetailsDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.sendManual(cid, leadId, user?.id, dto);
  }

  @Post('admin/send-details/deliveries/:deliveryId/retry')
  @ApiOperation({ summary: 'Retry a failed delivery from Admin' })
  async retryDeliveryAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('deliveryId', ParseIntPipe) deliveryId: number,
    @Body() dto: RetryDeliveryDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.retryDelivery(cid, deliveryId, user?.id, dto);
  }

  // -------------------------------------------------------------
  // MOBILE APP ENDPOINTS
  // -------------------------------------------------------------

  @Get('mobile/send-details/documents')
  @ApiOperation({ summary: 'List available Send Details documents for mobile app' })
  async getMobileDocuments(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getDocuments(cid);
  }

  @Get('mobile/leads/:id/send-details/history')
  @ApiOperation({ summary: 'Get Send Details delivery history for lead in mobile app' })
  async getMobileLeadHistory(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) leadId: number,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.getDeliveryHistory(cid, leadId);
  }

  @Post('mobile/leads/:id/send-details')
  @ApiOperation({ summary: 'Manually dispatch Send Details to a lead from mobile app' })
  async sendMobileDetails(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) leadId: number,
    @Body() dto: ManualSendDetailsDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.sendManual(cid, leadId, user?.id, dto);
  }

  @Post('mobile/leads/:id/send-details/:deliveryId/retry')
  @ApiOperation({ summary: 'Retry failed Send Details delivery from mobile app' })
  async retryMobileDelivery(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('deliveryId', ParseIntPipe) deliveryId: number,
    @Body() dto: RetryDeliveryDto,
  ) {
    const cid = Number(customerId || user?.customerId);
    return this.sendDetailsService.retryDelivery(cid, deliveryId, user?.id, dto);
  }
}

