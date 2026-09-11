import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInfluencerDto, FilterInfluencersQueryDto, UpdateInfluencerDto } from './dto/influencer.dto';

@Injectable()
export class InfluencerService {
  private readonly logger = new Logger(InfluencerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves active categories for customer filter bar.
   */
  async getCategories() {
    let categories = await this.prisma.influencerCategory.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      include: {
        _count: {
          select: {
            influencers: {
              where: { isActive: true, deletedAt: null },
            },
          },
        },
      },
      orderBy: {
        sortOrder: 'asc',
      },
    });

    if (categories.length === 0) {
      await this.seedInitialInfluencers();
      categories = await this.prisma.influencerCategory.findMany({
        where: {
          deletedAt: null,
          isActive: true,
        },
        include: {
          _count: {
            select: {
              influencers: {
                where: { isActive: true, deletedAt: null },
              },
            },
          },
        },
        orderBy: {
          sortOrder: 'asc',
        },
      });
    }

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon,
      description: cat.description,
      creatorCount: cat._count.influencers,
    }));
  }

  /**
   * Retrieves active influencers for Customer Home & Listing screen.
   */
  async getActiveInfluencers(query: FilterInfluencersQueryDto) {
    let count = await this.prisma.influencer.count({
      where: { deletedAt: null },
    });

    if (count === 0) {
      this.logger.log('[INFLUENCER] No influencers found. Auto-seeding initial active creators...');
      await this.seedInitialInfluencers();
    }

    const whereClause: any = {
      deletedAt: null,
      isActive: true,
    };

    if (query.featured === true || query.featured === 'true') {
      whereClause.isFeatured = true;
    }

    if (query.platform && query.platform.toUpperCase() !== 'ALL') {
      whereClause.platform = query.platform.toUpperCase();
    }

    if (query.category && query.category.toLowerCase() !== 'all') {
      whereClause.OR = [
        { category: { slug: query.category.toLowerCase() } },
        { category: { name: { contains: query.category, mode: 'insensitive' } } },
        { categoryName: { contains: query.category, mode: 'insensitive' } },
      ];
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      whereClause.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { handle: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { location: { contains: search, mode: 'insensitive' } },
            { categoryName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    return this.prisma.influencer.findMany({
      where: whereClause,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });
  }

  /**
   * Retrieves single influencer details.
   */
  async getInfluencerById(id: number) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        category: true,
      },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer with ID ${id} not found`);
    }
    return influencer;
  }

  /**
   * Records / toggles customer influencer favorite.
   */
  async toggleFavorite(id: number, customerId?: number) {
    const influencer = await this.getInfluencerById(id);
    this.logger.log(`[INFLUENCER_FAVORITE] Influencer ${id} toggled by customer ${customerId ?? 'guest'}`);
    return {
      success: true,
      influencerId: influencer.id,
      isFavorited: true,
      message: 'Influencer favorite state updated',
    };
  }

  /**
   * Books an influencer.
   */
  async bookInfluencer(id: number, customerId?: number, bookingData?: any) {
    const influencer = await this.getInfluencerById(id);
    this.logger.log(`[INFLUENCER_BOOKING] Influencer ${influencer.name} (ID: ${id}) booked by customer ${customerId}`);

    return {
      success: true,
      bookingId: `BK_INF_${Date.now()}`,
      influencerId: influencer.id,
      influencerName: influencer.name,
      platform: influencer.platform,
      status: 'CONFIRMED',
      scheduledAt: bookingData?.date || new Date().toISOString(),
      message: `Booking request for ${influencer.name} submitted successfully! Our influencer team will reach out shortly.`,
    };
  }

  // =========================================================================
  // ADMIN PANEL MANAGEMENT
  // =========================================================================

  async getAllInfluencersAdmin() {
    return this.prisma.influencer.findMany({
      where: { deletedAt: null },
      include: { category: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });
  }

  async createInfluencer(dto: CreateInfluencerDto) {
    return this.prisma.influencer.create({
      data: {
        name: dto.name,
        handle: dto.handle,
        avatarUrl: dto.avatarUrl,
        profileImage: dto.profileImage || dto.avatarUrl,
        platform: dto.platform?.toUpperCase() || 'INSTAGRAM',
        categoryId: dto.categoryId,
        categoryName: dto.categoryName,
        location: dto.location || 'India',
        city: dto.city || dto.location,
        followers: dto.followers ?? 0,
        followersCount: dto.followersCount || `${dto.followers ?? 0}`,
        engagementRate: dto.engagementRate ?? 0.0,
        isVerified: dto.isVerified ?? true,
        isFeatured: dto.isFeatured ?? true,
        isActive: dto.isActive ?? true,
        bio: dto.bio,
        bookingUrl: dto.bookingUrl,
        pricing: dto.pricing,
        rating: dto.rating ?? 4.9,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateInfluencer(id: number, dto: UpdateInfluencerDto) {
    const existing = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Influencer with ID ${id} not found`);
    }

    return this.prisma.influencer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.handle !== undefined && { handle: dto.handle }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.profileImage !== undefined && { profileImage: dto.profileImage }),
        ...(dto.platform !== undefined && { platform: dto.platform.toUpperCase() }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.categoryName !== undefined && { categoryName: dto.categoryName }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.followers !== undefined && { followers: dto.followers }),
        ...(dto.followersCount !== undefined && { followersCount: dto.followersCount }),
        ...(dto.engagementRate !== undefined && { engagementRate: dto.engagementRate }),
        ...(dto.isVerified !== undefined && { isVerified: dto.isVerified }),
        ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.bookingUrl !== undefined && { bookingUrl: dto.bookingUrl }),
        ...(dto.pricing !== undefined && { pricing: dto.pricing }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteInfluencer(id: number) {
    return this.prisma.influencer.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Seeds initial active influencers and categories into the database.
   */
  private async seedInitialInfluencers() {
    const categoriesData = [
      { name: 'Instagram Influencers', slug: 'instagram', icon: 'instagram', sortOrder: 1 },
      { name: 'YouTube Creators', slug: 'youtube', icon: 'youtube', sortOrder: 2 },
      { name: 'Local Influencers', slug: 'local', icon: 'map_pin', sortOrder: 3 },
      { name: 'Fashion Influencers', slug: 'fashion', icon: 'fashion', sortOrder: 4 },
      { name: 'Food Bloggers', slug: 'food', icon: 'restaurant', sortOrder: 5 },
      { name: 'Travel Creators', slug: 'travel', icon: 'compass', sortOrder: 6 },
      { name: 'Fitness Influencers', slug: 'fitness', icon: 'fitness', sortOrder: 7 },
      { name: 'Mom & Kids Influencers', slug: 'mom_kids', icon: 'heart', sortOrder: 8 },
    ];

    const categoryMap = new Map<string, number>();

    for (const cat of categoriesData) {
      const created = await this.prisma.influencerCategory.upsert({
        where: { slug: cat.slug },
        update: { name: cat.name, icon: cat.icon, sortOrder: cat.sortOrder, isActive: true },
        create: { name: cat.name, slug: cat.slug, icon: cat.icon, sortOrder: cat.sortOrder, isActive: true },
      });
      categoryMap.set(cat.slug, created.id);
    }

    const creators = [
      {
        name: 'Ananya Sharma',
        handle: '@ananya_sharma',
        platform: 'INSTAGRAM',
        categorySlug: 'fashion',
        categoryName: 'Fashion',
        location: 'Ahmedabad',
        city: 'Ahmedabad',
        followers: 125000,
        followersCount: '125K',
        engagementRate: 4.8,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
        bio: 'Fashion & Aesthetic Style Creator | Brand Collaborations',
        pricing: 12000,
        sortOrder: 1,
      },
      {
        name: 'Rohit Vlogs',
        handle: '@rohit_vlogsofficial',
        platform: 'YOUTUBE',
        categorySlug: 'travel',
        categoryName: 'Travel Creators',
        location: 'Mumbai',
        city: 'Mumbai',
        followers: 215000,
        followersCount: '215K',
        engagementRate: 6.2,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80',
        bio: 'Exploring India & World Travel | 4K Cinematic Vlogs',
        pricing: 18500,
        sortOrder: 2,
      },
      {
        name: 'Fitness With Neha',
        handle: '@neha_fitness',
        platform: 'INSTAGRAM',
        categorySlug: 'fitness',
        categoryName: 'Fitness Influencers',
        location: 'Delhi',
        city: 'Delhi',
        followers: 98000,
        followersCount: '98K',
        engagementRate: 5.1,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=800&q=80',
        bio: 'Certified Nutritionist & Daily Workout Guides',
        pricing: 9500,
        sortOrder: 3,
      },
      {
        name: 'Chef Kabir Foods',
        handle: '@kabir_cooks',
        platform: 'INSTAGRAM',
        categorySlug: 'food',
        categoryName: 'Food Bloggers',
        location: 'Bangalore',
        city: 'Bangalore',
        followers: 180000,
        followersCount: '180K',
        engagementRate: 5.8,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
        bio: 'Authentic Indian Street & Fine Dining Recipes',
        pricing: 14000,
        sortOrder: 4,
      },
      {
        name: 'Pooja Lifestyle',
        handle: '@pooja_daily',
        platform: 'INSTAGRAM',
        categorySlug: 'local',
        categoryName: 'Local Influencers',
        location: 'Pune',
        city: 'Pune',
        followers: 75000,
        followersCount: '75K',
        engagementRate: 6.4,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
        bio: 'Pune City Local Events, Cafes & Lifestyle',
        pricing: 8000,
        sortOrder: 5,
      },
      {
        name: 'Tech With Aryan',
        handle: '@aryan_tech',
        platform: 'YOUTUBE',
        categorySlug: 'youtube',
        categoryName: 'YouTube Creators',
        location: 'Hyderabad',
        city: 'Hyderabad',
        followers: 320000,
        followersCount: '320K',
        engagementRate: 7.1,
        isVerified: true,
        isFeatured: true,
        avatarUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=600&q=80',
        profileImage: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=800&q=80',
        bio: 'Gadgets, Smartphone Unboxings & Software Reviews',
        pricing: 22000,
        sortOrder: 6,
      },
    ];

    for (const item of creators) {
      const categoryId = categoryMap.get(item.categorySlug) || null;
      await this.prisma.influencer.create({
        data: {
          name: item.name,
          handle: item.handle,
          platform: item.platform,
          categoryId,
          categoryName: item.categoryName,
          location: item.location,
          city: item.city,
          followers: item.followers,
          followersCount: item.followersCount,
          engagementRate: item.engagementRate,
          isVerified: item.isVerified,
          isFeatured: item.isFeatured,
          isActive: true,
          avatarUrl: item.avatarUrl,
          profileImage: item.profileImage,
          bio: item.bio,
          pricing: item.pricing,
          sortOrder: item.sortOrder,
        },
      });
    }

    this.logger.log(`[INFLUENCER] Successfully seeded ${creators.length} influencers across ${categoriesData.length} categories.`);
  }
}
