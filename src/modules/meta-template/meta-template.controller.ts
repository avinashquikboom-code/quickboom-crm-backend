import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetaTemplateService } from './meta-template.service';
import {
  CreateMetaTemplateDto,
  UpdateMetaTemplateDto,
  QueryMetaTemplateDto,
  PreviewMetaTemplateDto,
  TestSendMetaTemplateDto,
} from './dto/meta-template.dto';

@ApiTags('Meta WhatsApp Templates')
@Controller(['templates/meta', 'meta-templates', 'admin/meta-templates'])
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MetaTemplateController {
  private readonly logger = new Logger(MetaTemplateController.name);

  constructor(private readonly metaTemplateService: MetaTemplateService) {}

  @Get()
  @ApiOperation({ summary: 'Get all Meta message templates with filters and pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'language', required: false })
  @ApiQuery({ name: 'isLocalActive', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query() query: QueryMetaTemplateDto,
    @Req() req: any,
  ) {
    const effectiveStatus = query.status || query.metaStatus || 'ALL';
    this.logger.log(
      `[META_TEMPLATES_REQUEST]\nmethod=${req?.method || 'GET'}\npath=${req?.originalUrl || req?.url || '/api/v1/templates/meta'}\nadminUserId=${user?.id || 'none'}\ncompanyId=${user?.customerId ?? 'NONE'}\ntenantId=${user?.customerId ?? 'NONE'}\npage=${query.page || 1}\nlimit=${query.limit || 50}\nstatus=${effectiveStatus}`,
    );

    const result = await this.metaTemplateService.findAll(user?.customerId, query);

    this.logger.log(
      `[META_TEMPLATES_RESULT]\nstatus=200\ncount=${result?.items?.length ?? 0}`,
    );

    return result;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated statistics of Meta message templates' })
  async getStats(@CurrentUser() user: any, @Req() req: any) {
    this.logger.log(
      `[META_TEMPLATES_REQUEST]\nmethod=${req?.method || 'GET'}\npath=${req?.originalUrl || req?.url || '/api/v1/templates/meta/stats'}\nadminUserId=${user?.id || 'none'}\ncompanyId=${user?.customerId ?? 'NONE'}\ntenantId=${user?.customerId ?? 'NONE'}\npage=1\nlimit=1\nstatus=ALL`,
    );

    const result = await this.metaTemplateService.getStats(user?.customerId);

    this.logger.log(
      `[META_TEMPLATES_RESULT]\nstatus=200\ncount=${result?.total ?? 0}`,
    );

    return result;
  }

  @Get('variables')
  @ApiOperation({ summary: 'Get supported CRM template variables for Meta templates' })
  async getVariables() {
    return this.metaTemplateService.getVariables();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single Meta template by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.metaTemplateService.findOne(id, user?.customerId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new Meta message template' })
  async create(@Body() dto: CreateMetaTemplateDto, @CurrentUser() user: any) {
    return this.metaTemplateService.create(dto, user?.customerId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing Meta message template' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMetaTemplateDto,
    @CurrentUser() user: any,
  ) {
    return this.metaTemplateService.update(id, dto, user?.customerId);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle local active status of a Meta template' })
  async toggleActive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.metaTemplateService.toggleActive(id, user?.customerId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a Meta template with stage-in-use protection' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.metaTemplateService.remove(id, user?.customerId);
  }

  @Post(['sync', 'sync-meta'])
  @ApiOperation({ summary: 'Synchronize templates from Meta Business Cloud API' })
  async syncFromMeta(@CurrentUser() user: any) {
    return this.metaTemplateService.syncFromMeta(user?.customerId);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview Meta message template with interpolated variables' })
  async preview(@Body() dto: PreviewMetaTemplateDto, @CurrentUser() user: any) {
    return this.metaTemplateService.preview(dto, user?.customerId);
  }

  @Post('test-send')
  @ApiOperation({ summary: 'Send a live test WhatsApp message using the selected Meta template via Meta Cloud API' })
  async testSend(@Body() dto: TestSendMetaTemplateDto, @CurrentUser() user: any) {
    return this.metaTemplateService.testSend(dto, user);
  }
}

