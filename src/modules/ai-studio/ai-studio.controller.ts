import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiCreditService } from './ai-credit.service';
import { AiGenerationService } from './ai-generation.service';
import {
  GenerateContentDto,
  UpdateGenerationDto,
  PurchaseCreditsDto,
  VerifyCreditPurchaseDto,
  UpdateAiServiceConfigDto,
} from './dto/ai-studio.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('AI Studio')
@Controller()
export class AiStudioController {
  constructor(
    private readonly aiCreditService: AiCreditService,
    private readonly aiGenerationService: AiGenerationService,
  ) {}

  private resolveCustomerId(req: any): number {
    const user = req.user;
    const rawId =
      user?.customerId ??
      (user?.role === 'CUSTOMER' ? user?.customerId || user?.id : undefined) ??
      req.headers?.['x-customer-id'];
    const parsed = parseInt(String(rawId), 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new ForbiddenException('Valid customer authentication session is required');
    }
    return parsed;
  }

  // =========================================================================
  // PUBLIC / CUSTOMER BROWSING & CONFIG APIS
  // =========================================================================

  @Get('ai/services')
  @ApiOperation({ summary: 'Get active AI service configurations and credit pricing' })
  async getServices() {
    const data = await this.aiCreditService.getServiceConfigs();
    return { statusCode: 200, success: true, data };
  }

  // =========================================================================
  // CUSTOMER WALLET & CREDITS APIS (ISOLATED)
  // =========================================================================

  @Get('ai/wallet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current customer AI credit wallet balance' })
  async getWallet(@Req() req: any) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.aiCreditService.getOrCreateWallet(customerId);
    return { statusCode: 200, success: true, data };
  }

  @Get('ai/wallet/transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get credit transaction history for logged-in customer' })
  async getTransactions(@Req() req: any) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.aiCreditService.getTransactions(customerId);
    return { statusCode: 200, success: true, data };
  }

  @Post('ai/wallet/purchase')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Initialize Razorpay order for purchasing AI credits' })
  async purchaseCredits(@Req() req: any, @Body() dto: PurchaseCreditsDto) {
    const customerId = this.resolveCustomerId(req);
    const result = await this.aiCreditService.createPurchaseOrder(customerId, dto);
    return { statusCode: 201, success: true, ...result };
  }

  @Post('ai/wallet/verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Verify payment and credit AI wallet' })
  async verifyCredits(@Req() req: any, @Body() dto: VerifyCreditPurchaseDto) {
    const customerId = this.resolveCustomerId(req);
    const result = await this.aiCreditService.verifyPurchase(customerId, dto);
    return { statusCode: 200, success: true, ...result };
  }

  // =========================================================================
  // CUSTOMER AI CONTENT GENERATION APIS (ISOLATED)
  // =========================================================================

  @Post('ai/generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate AI social post, poster, video, caption or hashtags' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image'))
  async generateContent(
    @Req() req: any,
    @Body() dto: GenerateContentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const customerId = this.resolveCustomerId(req);
    const result = await this.aiGenerationService.generate(customerId, dto, file);
    return {
      statusCode: 201,
      success: true,
      message: 'AI Content generated successfully',
      ...result,
    };
  }

  @Get('ai/generations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get generation history for current customer' })
  async getMyGenerations(@Req() req: any, @Query('type') type?: string) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.aiGenerationService.getMyGenerations(customerId, type);
    return { statusCode: 200, success: true, data };
  }

  @Get('ai/generations/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get single generation details or poll async render status' })
  async getGenerationStatus(@Req() req: any, @Param('id') id: string) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.aiGenerationService.getJobStatus(customerId, id);
    return { statusCode: 200, success: true, data };
  }

  @Patch('ai/generations/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save edited caption or hashtags for a generation' })
  async updateGeneration(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateGenerationDto,
  ) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.aiGenerationService.updateGeneration(customerId, id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Generation updated successfully',
      data,
    };
  }

  // =========================================================================
  // ADMIN PANEL APIS
  // =========================================================================

  @Get('admin/ai/services')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all AI service configurations (Admin)' })
  async getAdminServices() {
    const data = await this.aiCreditService.getServiceConfigs();
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/ai/services/:code')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update credit cost, price or status for an AI service (Admin)' })
  async updateServiceConfig(
    @Param('code') code: string,
    @Body() dto: UpdateAiServiceConfigDto,
  ) {
    const data = await this.aiCreditService.updateServiceConfig(code, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Service configuration updated successfully',
      data,
    };
  }

  @Get('admin/ai/generations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'List all customer generations with filters and pagination (Admin)' })
  async getAllGenerationsAdmin(@Query() query: any) {
    const data = await this.aiGenerationService.getAllGenerationsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/ai/transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Audit ledger of all customer credit transactions (Admin)' })
  async getAllTransactionsAdmin(@Query() query: any) {
    const data = await this.aiCreditService.getAllTransactionsAdmin(query);
    return { statusCode: 200, success: true, data };
  }
}
