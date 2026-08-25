import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CustomPlanService } from './custom-plan.service';
import {
  CreateCustomPlanOptionDto,
  UpdateCustomPlanOptionDto,
} from './dto/custom-plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Custom Plan Builder (Admin)')
@Controller()
export class CustomPlanController {
  constructor(private readonly customPlanService: CustomPlanService) {}

  // ==========================================
  // ADMIN CONFIGURATION & MANAGEMENT ENDPOINTS
  // ==========================================

  @Get('admin/custom-plan/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all custom plan options (Admin)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  async getAdminOptions(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.customPlanService.getAdminOptions({ search, category });
  }

  @Post('admin/custom-plan/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new custom plan option (Admin)' })
  async createOption(@Body() dto: CreateCustomPlanOptionDto) {
    return this.customPlanService.createOption(dto);
  }

  @Patch('admin/custom-plan/options/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update custom plan option (Admin)' })
  async updateOption(
    @Param('id') id: string,
    @Body() dto: UpdateCustomPlanOptionDto,
  ) {
    return this.customPlanService.updateOption(id, dto);
  }

  @Delete('admin/custom-plan/options/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete or archive custom plan option (Admin)' })
  async deleteOption(@Param('id') id: string) {
    return this.customPlanService.deleteOption(id);
  }

  @Get('admin/custom-plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all custom plan orders (Admin)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAdminCustomPlans(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customPlanService.getAdminCustomPlans({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('admin/custom-plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get custom plan order details (Admin)' })
  async getAdminCustomPlanById(@Param('id') id: string) {
    return this.customPlanService.getAdminCustomPlanById(id);
  }
}
