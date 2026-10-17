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
  Logger,
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
  AdminAdjustCreditsDto,
} from './dto/ai-studio.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccountGuard } from '../../common/guards/account.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserAdmin, isUserAdminOrStaff, isUserSuperAdmin } from '../../common/utils/account.util';

@ApiTags('AI Studio')
@Controller()
export class AiStudioController {
  private readonly logger = new Logger(AiStudioController.name);

  constructor(
    private readonly aiCreditService: AiCreditService,
    private readonly aiGenerationService: AiGenerationService,
  ) {}

  private async resolveCustomerId(req: any): Promise<number> {
    return this.aiCreditService.resolveCustomerId(req.user, req.headers);
  }

  // =========================================================================
  // ADMIN PANEL APIS
  // =========================================================================

  @Get('admin/ai/services')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Get all AI service configurations (Admin)' })
  async getAdminServices() {
    const data = await this.aiCreditService.getServiceConfigs();
    return { statusCode: 200, success: true, data };
  }

  @Patch('admin/ai/services/:code')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
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
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'List all customer generations with filters and pagination (Admin)' })
  async getAllGenerationsAdmin(@Query() query: any) {
    const data = await this.aiGenerationService.getAllGenerationsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/ai/transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'Audit ledger of all customer credit transactions (Admin)' })
  async getAllTransactionsAdmin(@Query() query: any) {
    const data = await this.aiCreditService.getAllTransactionsAdmin(query);
    return { statusCode: 200, success: true, data };
  }
}
