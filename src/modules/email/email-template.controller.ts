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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EmailTemplateService } from './email-template.service';
import { EmailService } from './email.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { PreviewEmailTemplateDto, TestSendTemplateDto } from './dto/preview-email-template.dto';

@ApiTags('Email Templates')
@Controller('email/templates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmailTemplateController {
  constructor(
    private readonly emailTemplateService: EmailTemplateService,
    private readonly emailService: EmailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all email templates for customer/system' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.emailTemplateService.findAll(user?.customerId, { category, isActive, search });
  }

  @Get('events')
  @ApiOperation({ summary: 'Get list of predefined system events and placeholders' })
  async getEvents() {
    return this.emailTemplateService.getEventDefinitions();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get email template by ID' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.emailTemplateService.findOne(id, user?.customerId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom email template' })
  async create(
    @Body() dto: CreateEmailTemplateDto,
    @CurrentUser() user: any,
  ) {
    return this.emailTemplateService.create(dto, user?.customerId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing email template' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmailTemplateDto,
    @CurrentUser() user: any,
  ) {
    return this.emailTemplateService.update(id, dto, user?.customerId);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle active status of an email template' })
  async toggleActive(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.emailTemplateService.toggleActive(id, user?.customerId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a custom email template' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.emailTemplateService.remove(id, user?.customerId);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Generate live preview of an email template with sample variables' })
  async preview(@Body() dto: PreviewEmailTemplateDto) {
    return this.emailTemplateService.preview(dto);
  }

  @Post('test-send')
  @ApiOperation({ summary: 'Send a test email using template content via configured SMTP' })
  async testSend(
    @Body() dto: TestSendTemplateDto,
    @CurrentUser() user: any,
  ) {
    let subject = dto.subject;
    let body = dto.body;

    if (!subject || !body) {
      if (dto.templateId) {
        const tpl = await this.emailTemplateService.findOne(Number(dto.templateId), user?.customerId);
        subject = subject || tpl.subject;
        body = body || tpl.body;
      } else if (dto.templateKey) {
        const tpl = await this.emailTemplateService.findByKey(dto.templateKey, user?.customerId);
        if (tpl) {
          subject = subject || tpl.subject;
          body = body || tpl.body;
        }
      }
    }

    if (!subject || !body) {
      subject = 'Test Email from QuickBoom CRM';
      body = 'This is a test email sent to verify SMTP and Email Template configuration.';
    }

    // Interpolate sample variables
    const preview = this.emailTemplateService.preview({
      subject,
      body,
      variables: dto.variables,
    });

    const isHtml = preview.body.includes('<') && preview.body.includes('>');

    return this.emailService.sendEmail(
      {
        to: dto.to,
        subject: `[TEST] ${preview.subject}`,
        body: preview.body,
        html: isHtml ? preview.body : undefined,
        text: !isHtml ? preview.body : undefined,
        recordType: 'EMAIL_TEMPLATE_TEST',
        recordId: dto.templateId ? String(dto.templateId) : undefined,
      },
      user,
    );
  }
}
