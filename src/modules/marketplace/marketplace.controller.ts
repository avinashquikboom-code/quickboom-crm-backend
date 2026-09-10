import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MarketplaceService } from './marketplace.service';
import { CreateMarketplaceToolDto, UpdateMarketplaceToolDto } from './dto/marketplace-tool.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Marketplace Tools')
@Controller()
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // ==========================================
  // CUSTOMER / CLIENT APIS
  // ==========================================

  @Get(['marketplace/tools', 'customer/marketplace/tools'])
  @ApiOperation({ summary: 'Get active business marketplace tools for Customer Home and Marketplace' })
  async getMarketplaceTools() {
    const data = await this.marketplaceService.getActiveMarketplaceTools();
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  // ==========================================
  // ADMIN PANEL APIS
  // ==========================================

  @Get('admin/marketplace/tools')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all marketplace tools including inactive (Admin)' })
  async getAllMarketplaceToolsAdmin() {
    const data = await this.marketplaceService.getAllMarketplaceToolsAdmin();
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Post('admin/marketplace/tools')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create new marketplace tool (Admin)' })
  async createMarketplaceTool(@Body() dto: CreateMarketplaceToolDto) {
    const data = await this.marketplaceService.createMarketplaceTool(dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Marketplace tool created successfully',
      data,
    };
  }

  @Patch('admin/marketplace/tools/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update marketplace tool (Admin)' })
  async updateMarketplaceTool(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketplaceToolDto,
  ) {
    const data = await this.marketplaceService.updateMarketplaceTool(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Marketplace tool updated successfully',
      data,
    };
  }

  @Delete('admin/marketplace/tools/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete marketplace tool (Admin)' })
  async deleteMarketplaceTool(@Param('id', ParseIntPipe) id: number) {
    const data = await this.marketplaceService.deleteMarketplaceTool(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Marketplace tool deleted successfully',
      data,
    };
  }
}
