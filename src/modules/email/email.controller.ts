import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { SendEmailDto } from './dto/send-email.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Email')
@Controller('email')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send an email via configured SMTP settings' })
  async sendEmail(
    @Body() dto: SendEmailDto,
    @CurrentUser() user: any,
  ) {
    return this.emailService.sendEmail(dto, user);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current SMTP configuration status (masked)' })
  async getStatus() {
    return this.emailService.getSmtpStatus();
  }
}
