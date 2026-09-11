import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InfluencerService } from './influencer.service';
import { CreateInfluencerDto, FilterInfluencersQueryDto, UpdateInfluencerDto } from './dto/influencer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Influencer Hub')
@Controller()
export class InfluencerController {
  constructor(private readonly influencerService: InfluencerService) {}

  // =========================================================================
  // CUSTOMER / CLIENT APIS
  // =========================================================================

  @Get(['influencers/categories', 'customer/influencer-categories'])
  @ApiOperation({ summary: 'Get active influencer categories with counts' })
  async getCategories() {
    const data = await this.influencerService.getCategories();
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Get(['influencers', 'customer/influencers'])
  @ApiOperation({ summary: 'Get active influencers for Customer Home and Listing screen' })
  async getActiveInfluencers(@Query() query: FilterInfluencersQueryDto) {
    const data = await this.influencerService.getActiveInfluencers(query);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Get(['influencers/:id', 'customer/influencers/:id'])
  @ApiOperation({ summary: 'Get single influencer details' })
  async getInfluencerById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.getInfluencerById(id);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Post('customer/influencers/:id/favorite')
  @ApiOperation({ summary: 'Toggle favorite status for an influencer' })
  async toggleFavorite(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const customerId = req.user?.customerId || req.user?.id;
    const data = await this.influencerService.toggleFavorite(id, customerId);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Post('customer/influencers/:id/book')
  @ApiOperation({ summary: 'Book or request collaboration with an influencer' })
  async bookInfluencer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req: any,
  ) {
    const customerId = req.user?.customerId || req.user?.id;
    const data = await this.influencerService.bookInfluencer(id, customerId, body);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  // =========================================================================
  // ADMIN PANEL MANAGEMENT APIS
  // =========================================================================

  @Get('admin/influencers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get all influencers including inactive (Admin)' })
  async getAllInfluencersAdmin() {
    const data = await this.influencerService.getAllInfluencersAdmin();
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }

  @Post('admin/influencers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create new influencer (Admin)' })
  async createInfluencer(@Body() dto: CreateInfluencerDto) {
    const data = await this.influencerService.createInfluencer(dto);
    return {
      statusCode: 201,
      success: true,
      message: 'Influencer created successfully',
      data,
    };
  }

  @Patch('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update influencer details/status (Admin)' })
  async updateInfluencer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInfluencerDto,
  ) {
    const data = await this.influencerService.updateInfluencer(id, dto);
    return {
      statusCode: 200,
      success: true,
      message: 'Influencer updated successfully',
      data,
    };
  }

  @Delete('admin/influencers/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete or deactivate influencer (Admin)' })
  async deleteInfluencer(@Param('id', ParseIntPipe) id: number) {
    const data = await this.influencerService.deleteInfluencer(id);
    return {
      statusCode: 200,
      success: true,
      message: 'Influencer deleted successfully',
      data,
    };
  }
}
