import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';

export const Public = () => SetMetadata('isPublic', true);

export class PublicEnquiryDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  phone: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  budget?: string;

  @IsString()
  @MinLength(5)
  message: string;
}

export class NewsletterSubscribeDto {
  @IsEmail()
  email: string;
}

@ApiTags('Public Website')
@Controller('public')
export class PublicWebsiteController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post('enquiries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a public website enquiry and persist as a CRM Lead' })
  async submitEnquiry(@Body() dto: PublicEnquiryDto) {
    const fullName = dto.fullName.trim();
    const parts = fullName.split(/\s+/);
    const firstName = parts[0] || fullName;
    const lastName = parts.slice(1).join(' ') || '-';

    const [customer, creator] = await Promise.all([
      this.prisma.customer.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { id: 'asc' } }),
      this.prisma.user.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { id: 'asc' } }),
    ]);

    if (!customer || !creator) {
      throw new BadRequestException('Enquiry workspace is not initialized.');
    }

    const newStage = await this.prisma.leadStage.findFirst({
      where: { customerId: customer.id, key: 'NEW', deletedAt: null },
      select: { id: true },
    });

    const lead = await this.prisma.lead.create({
      data: {
        customerId: customer.id,
        createdById: creator.id,
        title: `${dto.service || 'Agency Enquiry'} — ${dto.companyName || fullName}`,
        firstName,
        lastName,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone.trim(),
        companyName: dto.companyName?.trim() || null,
        category: dto.service?.trim() || 'Digital Marketing',
        source: 'WEBSITE',
        status: 'NEW',
        stageId: newStage?.id ?? null,
        workNotes: [
          dto.service ? `Service: ${dto.service}` : null,
          dto.budget ? `Budget: ${dto.budget}` : null,
          `Message: ${dto.message.trim()}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });

    await this.prisma.auditLog
      .create({
        data: {
          customerId: customer.id,
          userId: creator.id,
          userName: fullName,
          userRole: 'PUBLIC_VISITOR',
          source: 'WEBSITE',
          action: 'CREATE',
          module: 'Website Enquiry',
          description: `New website enquiry from ${fullName} (${dto.email}) for ${dto.service || 'General'}`,
          entityType: 'Lead',
          entityId: String(lead.id),
          endpoint: '/api/v1/public/enquiries',
          method: 'POST',
        },
      })
      .catch(() => null);

    return {
      success: true,
      enquiryId: lead.id,
      message: 'Thank you! Your enquiry has been received. Our team will contact you shortly.',
    };
  }

  @Public()
  @Post('newsletter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe to agency newsletter' })
  async subscribeNewsletter(@Body() dto: NewsletterSubscribeDto) {
    const email = dto.email.trim().toLowerCase();
    const customer = await this.prisma.customer.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { id: 'asc' } });
    if (customer) {
      await this.prisma.auditLog
        .create({
          data: {
            customerId: customer.id,
            userName: email,
            userRole: 'PUBLIC_VISITOR',
            source: 'WEBSITE',
            action: 'SUBSCRIBE',
            module: 'Newsletter',
            description: `Newsletter subscription: ${email}`,
            endpoint: '/api/v1/public/newsletter',
            method: 'POST',
          },
        })
        .catch(() => null);
    }
    return {
      success: true,
      message: 'Subscribed successfully! You will receive our latest digital growth insights.',
    };
  }
}
