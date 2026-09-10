import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMarketplaceToolDto, UpdateMarketplaceToolDto } from './dto/marketplace-tool.dto';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves active, published marketplace tools for customer home and marketplace views.
   * If database is empty, seeds the standard suite of business growth tools into the database.
   */
  async getActiveMarketplaceTools() {
    let tools = await this.prisma.marketplaceTool.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isPublished: true,
      },
      orderBy: {
        sortOrder: 'asc',
      },
    });

    if (tools.length === 0) {
      this.logger.log('[MARKETPLACE] No marketplace tools found. Seeding initial business tools into database...');
      await this.seedInitialTools();
      tools = await this.prisma.marketplaceTool.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          isPublished: true,
        },
        orderBy: {
          sortOrder: 'asc',
        },
      });
    }

    return tools;
  }

  /**
   * Retrieves all marketplace tools for Admin Panel management.
   */
  async getAllMarketplaceToolsAdmin() {
    return this.prisma.marketplaceTool.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        sortOrder: 'asc',
      },
    });
  }

  /**
   * Creates a new marketplace tool via Admin Panel.
   */
  async createMarketplaceTool(dto: CreateMarketplaceToolDto) {
    return this.prisma.marketplaceTool.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        icon: dto.icon || 'default',
        category: dto.category || 'GROWTH_TOOLS',
        route: dto.route,
        externalUrl: dto.externalUrl,
        badge: dto.badge,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        isPublished: dto.isPublished ?? true,
      },
    });
  }

  /**
   * Updates an existing marketplace tool via Admin Panel.
   */
  async updateMarketplaceTool(id: number, dto: UpdateMarketplaceToolDto) {
    const existing = await this.prisma.marketplaceTool.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Marketplace tool with ID ${id} not found`);
    }

    return this.prisma.marketplaceTool.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.route !== undefined && { route: dto.route }),
        ...(dto.externalUrl !== undefined && { externalUrl: dto.externalUrl }),
        ...(dto.badge !== undefined && { badge: dto.badge }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
    });
  }

  /**
   * Soft-deletes a marketplace tool.
   */
  async deleteMarketplaceTool(id: number) {
    const existing = await this.prisma.marketplaceTool.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Marketplace tool with ID ${id} not found`);
    }

    return this.prisma.marketplaceTool.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  /**
   * Seed standard suite of reference business growth tools.
   */
  private async seedInitialTools() {
    const seedData = [
      {
        title: 'WhatsApp Marketing Tool',
        subtitle: 'Campaigns & Automation',
        description: 'Bulk messaging, auto-replies, campaigns.',
        icon: 'whatsapp',
        category: 'GROWTH_TOOLS',
        route: '/customer/social-media-work',
        badge: 'POPULAR',
        sortOrder: 1,
        isActive: true,
        isPublished: true,
      },
      {
        title: 'Social Media Scheduler',
        subtitle: 'Multi-platform planner',
        description: 'Instagram, Facebook, LinkedIn post scheduling.',
        icon: 'calendar',
        category: 'GROWTH_TOOLS',
        route: '/customer/calendar',
        badge: 'NEW',
        sortOrder: 2,
        isActive: true,
        isPublished: true,
      },
      {
        title: 'CRM & Lead Manager',
        subtitle: 'Pipeline & Conversions',
        description: 'Lead tracking, follow-ups, customer database.',
        icon: 'crm',
        category: 'GROWTH_TOOLS',
        route: '/customer/leads',
        badge: 'ESSENTIAL',
        sortOrder: 3,
        isActive: true,
        isPublished: true,
      },
      {
        title: 'Invoice & Billing Software',
        subtitle: 'Invoicing & Tax Compliance',
        description: 'GST invoices, payment reminders.',
        icon: 'invoice',
        category: 'FINANCE_TOOLS',
        route: '/customer/orders',
        badge: 'GST READY',
        sortOrder: 4,
        isActive: true,
        isPublished: true,
      },
      {
        title: 'AI Content Generator',
        subtitle: 'Copywriting & Creative AI',
        description: 'Captions, ad copies, blog content.',
        icon: 'ai',
        category: 'CREATIVE_TOOLS',
        route: '/customer/custom-plan',
        badge: 'AI POWERED',
        sortOrder: 5,
        isActive: true,
        isPublished: true,
      },
      {
        title: 'Email Marketing Tool',
        subtitle: 'Outreach & Newsletters',
        description: 'Bulk email campaigns and automation.',
        icon: 'email',
        category: 'GROWTH_TOOLS',
        route: '/customer/support',
        badge: 'FAST',
        sortOrder: 6,
        isActive: true,
        isPublished: true,
      },
    ];

    for (const tool of seedData) {
      await this.prisma.marketplaceTool.create({
        data: tool,
      });
    }
  }
}
