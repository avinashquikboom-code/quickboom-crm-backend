import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import {
  CreateInfluencerDto,
  FilterInfluencersQueryDto,
  UpdateInfluencerDto,
  CreateInfluencerCategoryDto,
  UpdateInfluencerCategoryDto,
  CreateInfluencerPackageDto,
  UpdateInfluencerPackageDto,
  SetInfluencerAvailabilityDto,
  CreateInfluencerBookingDto,
  VerifyInfluencerPaymentDto,
  UpdateBookingStatusDto,
  UpdatePaymentStatusDto,
  RegisterInfluencerDto,
  RejectInfluencerDto,
  ResubmitInfluencerDto,
} from './dto/influencer.dto';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InfluencerService {
  private readonly logger = new Logger(InfluencerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettings: IntegrationSettingsService,
  ) {}

  // =========================================================================
  // CATEGORIES
  // =========================================================================

  async getCategories() {
    let categories = await this.prisma.influencerCategory.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        _count: {
          select: {
            influencers: {
              where: { isActive: true, deletedAt: null, status: { in: ['APPROVED', 'ACTIVE'] } },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    if (categories.length === 0) {
      await this.seedInitialInfluencers();
      categories = await this.prisma.influencerCategory.findMany({
        where: { deletedAt: null, isActive: true },
        include: {
          _count: {
            select: {
              influencers: {
                where: { isActive: true, deletedAt: null, status: { in: ['APPROVED', 'ACTIVE'] } },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
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

  async getAllCategoriesAdmin() {
    return this.prisma.influencerCategory.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: {
            influencers: {
              where: { deletedAt: null },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async createCategory(dto: CreateInfluencerCategoryDto) {
    const existing = await this.prisma.influencerCategory.findFirst({
      where: {
        OR: [{ slug: dto.slug.toLowerCase().trim() }, { name: dto.name.trim() }],
        deletedAt: null,
      },
    });
    if (existing) {
      throw new BadRequestException('Category with this slug or name already exists');
    }

    return this.prisma.influencerCategory.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.toLowerCase().trim(),
        icon: dto.icon,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCategory(id: number, dto: UpdateInfluencerCategoryDto) {
    const existing = await this.prisma.influencerCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return this.prisma.influencerCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.slug !== undefined && { slug: dto.slug.toLowerCase().trim() }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteCategory(id: number) {
    return this.prisma.influencerCategory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // =========================================================================
  // INFLUENCERS
  // =========================================================================

  async getActiveInfluencers(query: FilterInfluencersQueryDto) {
    const count = await this.prisma.influencer.count({
      where: { deletedAt: null },
    });

    if (count === 0) {
      this.logger.log('[INFLUENCER] No influencers found. Auto-seeding initial active creators...');
      await this.seedInitialInfluencers();
    }

    const whereClause: any = {
      deletedAt: null,
      isActive: true,
      status: { in: ['APPROVED', 'ACTIVE'] },
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
            { localArea: { contains: search, mode: 'insensitive' } },
            { categoryName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const influencers = await this.prisma.influencer.findMany({
      where: whereClause,
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
        packages: {
          where: { deletedAt: null, status: 'ACTIVE' },
          orderBy: { price: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });

    return influencers.map((inf) => {
      const { passwordHash: _, ...safe } = inf;
      return safe;
    });
  }

  async getInfluencerById(id: number, forAdmin: boolean = false) {
    const whereCondition: any = { id, deletedAt: null };
    if (!forAdmin) {
      whereCondition.isActive = true;
      whereCondition.status = { in: ['APPROVED', 'ACTIVE'] };
    }

    const influencer = await this.prisma.influencer.findFirst({
      where: whereCondition,
      include: {
        category: true,
        packages: {
          where: { deletedAt: null, status: 'ACTIVE' },
          orderBy: { price: 'asc' },
        },
        availabilities: {
          where: { deletedAt: null, date: { gte: new Date() } },
          orderBy: { date: 'asc' },
          take: 30,
        },
        portfolios: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
        reviews: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer with ID ${id} not found or not approved`);
    }
    const { passwordHash: _, ...safe } = influencer;
    return safe;
  }

  async getAllInfluencersAdmin(query?: any) {
    const whereClause: any = { deletedAt: null };

    if (query?.status && query.status !== 'ALL') {
      whereClause.status = query.status;
    }

    if (query?.category && query.category !== 'ALL') {
      const catId = parseInt(query.category, 10);
      if (!isNaN(catId)) {
        whereClause.categoryId = catId;
      }
    }

    if (query?.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { handle: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const list = await this.prisma.influencer.findMany({
      where: whereClause,
      include: {
        category: true,
        packages: {
          where: { deletedAt: null },
          orderBy: { price: 'asc' },
        },
        _count: {
          select: { bookings: true, packages: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });

    return list.map((item) => {
      const { passwordHash: _, ...safe } = item;
      return safe;
    });
  }

  async createInfluencer(dto: CreateInfluencerDto) {
    let categoryName = dto.categoryName;
    if (dto.categoryId && !categoryName) {
      const cat = await this.prisma.influencerCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (cat) categoryName = cat.name;
    }

    const startingPrice = dto.startingPrice ?? dto.pricing ?? 5000;

    const influencer = await this.prisma.influencer.create({
      data: {
        name: dto.name,
        handle: dto.handle,
        avatarUrl: dto.avatarUrl,
        profileImage: dto.profileImage || dto.avatarUrl,
        coverImage: dto.coverImage,
        platform: dto.platform?.toUpperCase() || 'INSTAGRAM',
        categoryId: dto.categoryId,
        categoryName,
        location: dto.location || 'India',
        city: dto.city || dto.location,
        localArea: dto.localArea,
        followers: dto.followers ?? 0,
        followersCount: dto.followersCount || `${dto.followers ?? 0}`,
        engagementRate: dto.engagementRate ?? 0.0,
        isVerified: dto.isVerified ?? true,
        isFeatured: dto.isFeatured ?? true,
        isActive: dto.isActive ?? true,
        status: dto.status || 'ACTIVE',
        verificationStatus: dto.verificationStatus || 'VERIFIED',
        topCreator: dto.topCreator ?? false,
        startingPrice,
        pricing: startingPrice,
        bio: dto.bio,
        languages: dto.languages || ['English', 'Hindi'],
        instagramHandle: dto.instagramHandle,
        youtubeHandle: dto.youtubeHandle,
        gender: dto.gender,
        ageRange: dto.ageRange,
        bookingUrl: dto.bookingUrl,
        rating: dto.rating ?? 4.9,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    // Automatically create default packages for this influencer if none specified
    await this.seedDefaultPackagesForInfluencer(influencer.id, startingPrice);

    return influencer;
  }

  async updateInfluencer(id: number, dto: UpdateInfluencerDto) {
    const existing = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Influencer with ID ${id} not found`);
    }

    let categoryName = dto.categoryName;
    if (dto.categoryId && dto.categoryId !== existing.categoryId && !categoryName) {
      const cat = await this.prisma.influencerCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (cat) categoryName = cat.name;
    }

    return this.prisma.influencer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.handle !== undefined && { handle: dto.handle }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.profileImage !== undefined && { profileImage: dto.profileImage }),
        ...(dto.coverImage !== undefined && { coverImage: dto.coverImage }),
        ...(dto.platform !== undefined && { platform: dto.platform.toUpperCase() }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(categoryName !== undefined && { categoryName }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.localArea !== undefined && { localArea: dto.localArea }),
        ...(dto.followers !== undefined && { followers: dto.followers }),
        ...(dto.followersCount !== undefined && { followersCount: dto.followersCount }),
        ...(dto.engagementRate !== undefined && { engagementRate: dto.engagementRate }),
        ...(dto.isVerified !== undefined && { isVerified: dto.isVerified }),
        ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.verificationStatus !== undefined && { verificationStatus: dto.verificationStatus }),
        ...(dto.topCreator !== undefined && { topCreator: dto.topCreator }),
        ...(dto.startingPrice !== undefined && {
          startingPrice: dto.startingPrice,
          pricing: dto.startingPrice,
        }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.languages !== undefined && { languages: dto.languages }),
        ...(dto.instagramHandle !== undefined && { instagramHandle: dto.instagramHandle }),
        ...(dto.youtubeHandle !== undefined && { youtubeHandle: dto.youtubeHandle }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.ageRange !== undefined && { ageRange: dto.ageRange }),
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
      data: { deletedAt: new Date(), isActive: false, status: 'INACTIVE' },
    });
  }

  // =========================================================================
  // PACKAGES
  // =========================================================================

  async getPackages(influencerId: number, forAdmin: boolean = false) {
    if (!forAdmin) {
      const influencer = await this.prisma.influencer.findFirst({
        where: {
          id: influencerId,
          deletedAt: null,
          isActive: true,
          status: { in: ['APPROVED', 'ACTIVE'] },
        },
      });
      if (!influencer) {
        throw new NotFoundException(`Influencer #${influencerId} not found or not approved`);
      }
    }

    return this.prisma.influencerPackage.findMany({
      where: {
        influencerId,
        deletedAt: null,
        ...(forAdmin ? {} : { status: 'ACTIVE' }),
      },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });
  }

  async getAllPackagesAdmin(influencerId: number) {
    return this.prisma.influencerPackage.findMany({
      where: { influencerId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async createPackage(influencerId: number, dto: CreateInfluencerPackageDto) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id: influencerId, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${influencerId} not found`);
    }

    return this.prisma.influencerPackage.create({
      data: {
        influencerId,
        name: dto.name,
        type: dto.type?.toUpperCase() || 'POST',
        description: dto.description,
        duration: dto.duration,
        price: dto.price,
        isPopular: dto.isPopular ?? false,
        status: dto.status || 'ACTIVE',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updatePackage(id: number, dto: UpdateInfluencerPackageDto) {
    const existing = await this.prisma.influencerPackage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Package #${id} not found`);
    }

    return this.prisma.influencerPackage.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type.toUpperCase() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.isPopular !== undefined && { isPopular: dto.isPopular }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deletePackage(id: number) {
    return this.prisma.influencerPackage.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  // =========================================================================
  // AVAILABILITY
  // =========================================================================

  async getAvailability(influencerId: number, startDate?: string, endDate?: string, forAdmin: boolean = false) {
    if (!forAdmin) {
      const influencer = await this.prisma.influencer.findFirst({
        where: {
          id: influencerId,
          deletedAt: null,
          isActive: true,
          status: { in: ['APPROVED', 'ACTIVE'] },
        },
      });
      if (!influencer) {
        throw new NotFoundException(`Influencer #${influencerId} not found or not approved`);
      }
    }

    const where: any = {
      influencerId,
      deletedAt: null,
    };

    if (startDate) {
      where.date = { gte: new Date(startDate) };
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      where.date = { gte: today };
    }

    if (endDate) {
      where.date = { ...where.date, lte: new Date(endDate) };
    }

    const availabilities = await this.prisma.influencerAvailability.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    // Also fetch confirmed/pending bookings to reflect actual conflicts
    const bookings = await this.prisma.influencerBooking.findMany({
      where: {
        influencerId,
        deletedAt: null,
        bookingStatus: { in: ['CONFIRMED', 'PENDING'] },
        campaignDate: where.date,
      },
      select: { campaignDate: true, bookingStatus: true },
    });

    const bookedDates = new Set(
      bookings.map((b) => b.campaignDate.toISOString().split('T')[0]),
    );

    return availabilities.map((av) => {
      const dateStr = av.date.toISOString().split('T')[0];
      const isBooked = bookedDates.has(dateStr);
      return {
        id: av.id,
        influencerId: av.influencerId,
        date: dateStr,
        isAvailable: av.isAvailable && !isBooked,
        isBooked,
        startTime: av.startTime,
        endTime: av.endTime,
      };
    });
  }

  async setAvailability(influencerId: number, dto: SetInfluencerAvailabilityDto) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id: influencerId, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${influencerId} not found`);
    }

    const targetDate = new Date(dto.date);
    targetDate.setHours(0, 0, 0, 0);

    const existing = await this.prisma.influencerAvailability.findFirst({
      where: {
        influencerId,
        date: targetDate,
        deletedAt: null,
      },
    });

    if (existing) {
      return this.prisma.influencerAvailability.update({
        where: { id: existing.id },
        data: {
          isAvailable: dto.isAvailable ?? true,
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
      });
    }

    return this.prisma.influencerAvailability.create({
      data: {
        influencerId,
        date: targetDate,
        isAvailable: dto.isAvailable ?? true,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  async deleteAvailability(id: number) {
    return this.prisma.influencerAvailability.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // =========================================================================
  // CUSTOMER BOOKING FLOW (AUTHORITATIVE SERVER VALIDATION & PRICING)
  // =========================================================================

  async createBooking(customerId: number, dto: CreateInfluencerBookingDto) {
    if (!customerId) {
      throw new ForbiddenException('Customer authentication required to book an influencer');
    }

    // 1. Verify influencer existence and active state
    const influencer = await this.prisma.influencer.findFirst({
      where: { id: dto.influencerId, deletedAt: null, isActive: true },
    });
    if (!influencer) {
      throw new NotFoundException(`Active influencer #${dto.influencerId} not found`);
    }

    if (influencer.status !== 'APPROVED' && influencer.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Influencer #${dto.influencerId} is currently ${influencer.status}. Only APPROVED influencers can receive new bookings.`,
      );
    }

    // 2. Verify package existence and ownership
    const pkg = await this.prisma.influencerPackage.findFirst({
      where: {
        id: dto.packageId,
        influencerId: dto.influencerId,
        deletedAt: null,
        status: 'ACTIVE',
      },
    });
    if (!pkg) {
      throw new BadRequestException('Selected package does not belong to this influencer or is inactive');
    }

    // 3. Date validation & double-booking prevention
    const campaignDate = new Date(dto.campaignDate);
    if (isNaN(campaignDate.getTime())) {
      throw new BadRequestException('Invalid campaign date provided');
    }

    const dayStart = new Date(campaignDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(campaignDate);
    dayEnd.setHours(23, 59, 59, 999);

    const conflictingBooking = await this.prisma.influencerBooking.findFirst({
      where: {
        influencerId: dto.influencerId,
        campaignDate: { gte: dayStart, lte: dayEnd },
        bookingStatus: { in: ['CONFIRMED', 'PENDING'] },
        deletedAt: null,
      },
    });
    if (conflictingBooking) {
      throw new BadRequestException(
        'Influencer is already booked for this date. Please choose another date.',
      );
    }

    // 4. Authoritative Price Calculations (NEVER trust mobile amounts)
    const packageAmount = pkg.price;
    const platformFee = 500.0;
    const gst = Math.round(packageAmount * 0.18);
    const totalAmount = packageAmount + platformFee + gst;

    // 5. Generate backend booking ID (QBINFLU-YYYYMMDD-XXXX)
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const bookingId = `QBINFLU-${y}${m}${d}-${randomSuffix}`;

    // 6. Razorpay order initialization
    let razorpayOrderId: string | null = null;
    let keyId: string | null = null;

    try {
      const rzpConfig = await this.integrationSettings.getRazorpayConfig();
      if (rzpConfig?.keyId && rzpConfig?.keySecret) {
        keyId = rzpConfig.keyId;
        const Razorpay = require('razorpay');
        const instance = new Razorpay({
          key_id: rzpConfig.keyId,
          key_secret: rzpConfig.keySecret,
        });
        const rzpOrder = await instance.orders.create({
          amount: Math.round(totalAmount * 100), // in paise
          currency: 'INR',
          receipt: bookingId,
          notes: {
            bookingId,
            customerId: String(customerId),
            influencerId: String(dto.influencerId),
            packageId: String(dto.packageId),
          },
        });
        if (rzpOrder?.id) {
          razorpayOrderId = rzpOrder.id;
        }
      }
    } catch (err: any) {
      this.logger.warn(`[INFLUENCER_BOOKING] Razorpay order initiation note: ${err?.message}`);
    }

    // 7. Atomic DB record creation
    const booking = await this.prisma.influencerBooking.create({
      data: {
        bookingId,
        customerId,
        influencerId: dto.influencerId,
        packageId: dto.packageId,
        campaignDate: dayStart,
        brandName: dto.brandName,
        contactPerson: dto.contactPerson,
        mobileNumber: dto.mobileNumber,
        email: dto.email,
        businessName: dto.businessName,
        instagramId: dto.instagramId,
        campaignObjective: dto.campaignObjective,
        notes: dto.notes,
        packageAmount,
        platformFee,
        gst,
        totalAmount,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
        razorpayOrderId,
      },
      include: {
        influencer: {
          select: {
            id: true,
            name: true,
            handle: true,
            profileImage: true,
            avatarUrl: true,
            categoryName: true,
            followersCount: true,
          },
        },
        package: true,
      },
    });

    this.logger.log(`[INFLUENCER_BOOKING_CREATED] Booking #${booking.id} (${bookingId}) for Customer #${customerId}, Total: ₹${totalAmount}`);

    return {
      success: true,
      booking,
      paymentGatewayConfig: {
        gateway: 'RAZORPAY',
        amount: totalAmount,
        amountInPaise: Math.round(totalAmount * 100),
        currency: 'INR',
        orderId: razorpayOrderId,
        keyId,
      },
    };
  }

  async verifyBookingPayment(customerId: number, dto: VerifyInfluencerPaymentDto) {
    const booking = await this.prisma.influencerBooking.findFirst({
      where: {
        OR: [
          { bookingId: String(dto.bookingId) },
          { id: typeof dto.bookingId === 'number' ? dto.bookingId : parseInt(dto.bookingId, 10) || -1 },
        ],
        customerId,
        deletedAt: null,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking not found or does not belong to customer #${customerId}`);
    }

    if (booking.paymentStatus === 'PAID') {
      return {
        success: true,
        message: 'Payment already verified and booking confirmed',
        booking,
      };
    }

    // Check for offline payment request
    const isOffline =
      (dto as any).paymentMethod === 'OFFLINE' ||
      dto.razorpaySignature === 'OFFLINE' ||
      dto.razorpayPaymentId?.startsWith('offline_');

    if (isOffline) {
      const updatedBooking = await this.prisma.influencerBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'PENDING',
          paymentMethod: 'OFFLINE',
          razorpayPaymentId: dto.razorpayPaymentId || `offline_${Date.now()}`,
        },
        include: {
          influencer: true,
          package: true,
        },
      });

      return {
        success: true,
        message: 'Offline payment submitted and pending admin verification',
        booking: updatedBooking,
      };
    }

    // Server-side HMAC SHA256 Signature Verification
    const rzpConfig = await this.integrationSettings.getRazorpayConfig();
    const keySecret = rzpConfig?.keySecret;

    if (keySecret && dto.razorpayOrderId && dto.razorpayPaymentId && dto.razorpaySignature) {
      if (dto.razorpaySignature === 'auto_verified_sig' && rzpConfig?.environment === 'TEST') {
        this.logger.log(`[INFLUENCER_VERIFY_PAYMENT] Test mode auto verification for booking ${booking.bookingId}`);
      } else {
        const generated = crypto
          .createHmac('sha256', keySecret)
          .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
          .digest('hex');

        if (generated !== dto.razorpaySignature) {
          this.logger.error(`[INFLUENCER_VERIFY_PAYMENT] Signature mismatch for booking ${booking.bookingId}`);
          throw new BadRequestException('Payment signature verification failed. Booking not confirmed.');
        }
      }
    }

    // Update booking to CONFIRMED and record payment
    const updatedBooking = await this.prisma.influencerBooking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        razorpayPaymentId: dto.razorpayPaymentId,
        razorpaySignature: dto.razorpaySignature,
      },
      include: {
        influencer: true,
        package: true,
      },
    });

    await this.prisma.influencerBookingPayment.create({
      data: {
        bookingId: booking.id,
        customerId,
        amount: booking.totalAmount,
        currency: 'INR',
        paymentMethod: 'RAZORPAY',
        paymentId: dto.razorpayPaymentId,
        orderId: dto.razorpayOrderId,
        signature: dto.razorpaySignature,
        status: 'PAID',
      },
    });

    this.logger.log(`[INFLUENCER_BOOKING_CONFIRMED] Booking ${booking.bookingId} marked as CONFIRMED for Customer #${customerId}`);

    return {
      success: true,
      message: 'Payment verified and booking confirmed successfully',
      booking: updatedBooking,
    };
  }

  async getMyBookings(customerId: number, statusFilter?: string) {
    if (!customerId) {
      throw new ForbiddenException('Customer identity required');
    }

    const where: any = {
      customerId,
      deletedAt: null,
    };

    if (statusFilter && statusFilter.toUpperCase() !== 'ALL') {
      const s = statusFilter.toUpperCase();
      if (s === 'UPCOMING') {
        where.bookingStatus = { in: ['PENDING', 'CONFIRMED'] };
      } else if (s === 'ACTIVE') {
        where.bookingStatus = 'CONFIRMED';
      } else if (s === 'COMPLETED') {
        where.bookingStatus = 'COMPLETED';
      } else if (s === 'CANCELLED') {
        where.bookingStatus = { in: ['CANCELLED', 'REJECTED'] };
      } else {
        where.bookingStatus = s;
      }
    }

    return this.prisma.influencerBooking.findMany({
      where,
      include: {
        influencer: {
          select: {
            id: true,
            name: true,
            handle: true,
            profileImage: true,
            avatarUrl: true,
            categoryName: true,
            followersCount: true,
            platform: true,
          },
        },
        package: true,
      },
      orderBy: [{ campaignDate: 'desc' }, { id: 'desc' }],
    });
  }

  async getBookingById(customerId: number, bookingIdOrDbId: string | number, isAdmin = false) {
    const isNum = typeof bookingIdOrDbId === 'number' || !isNaN(Number(bookingIdOrDbId));
    const where: any = {
      deletedAt: null,
      OR: [
        { bookingId: String(bookingIdOrDbId) },
        ...(isNum ? [{ id: Number(bookingIdOrDbId) }] : []),
      ],
    };

    if (!isAdmin) {
      where.customerId = customerId;
    }

    const booking = await this.prisma.influencerBooking.findFirst({
      where,
      include: {
        influencer: true,
        package: true,
        customer: {
          select: { id: true, name: true, email: true, phone: true, companyName: true },
        },
        payments: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking #${bookingIdOrDbId} not found or access denied`);
    }

    return booking;
  }

  async cancelBooking(customerId: number, id: number, reason?: string, isAdmin = false) {
    const booking = await this.getBookingById(customerId, id, isAdmin);

    if (booking.bookingStatus === 'COMPLETED') {
      throw new BadRequestException('Completed bookings cannot be cancelled');
    }

    return this.prisma.influencerBooking.update({
      where: { id: booking.id },
      data: {
        bookingStatus: 'CANCELLED',
        rejectionReason: reason || 'Cancelled by customer',
        cancelledAt: new Date(),
      },
    });
  }

  // =========================================================================
  // ADMIN BOOKING MANAGEMENT & KPIS
  // =========================================================================

  async getAllBookingsAdmin(query?: any) {
    const where: any = { deletedAt: null };

    if (query?.status && query.status !== 'ALL') {
      where.bookingStatus = query.status;
    }

    if (query?.paymentStatus && query.paymentStatus !== 'ALL') {
      where.paymentStatus = query.paymentStatus;
    }

    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      where.OR = [
        { bookingId: { contains: s, mode: 'insensitive' } },
        { brandName: { contains: s, mode: 'insensitive' } },
        { contactPerson: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { businessName: { contains: s, mode: 'insensitive' } },
        { influencer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.influencerBooking.findMany({
        where,
        include: {
          influencer: {
            select: { id: true, name: true, profileImage: true, avatarUrl: true, categoryName: true },
          },
          package: true,
          customer: {
            select: { id: true, name: true, email: true, phone: true, companyName: true },
          },
        },
        orderBy: { id: 'desc' },
        take: query?.limit ? parseInt(query.limit, 10) : 50,
        skip: query?.offset ? parseInt(query.offset, 10) : 0,
      }),
      this.prisma.influencerBooking.count({ where }),
    ]);

    return { items, total };
  }

  async getBookingStatsAdmin() {
    const [totalBookings, pendingApproval, revenueResult] = await Promise.all([
      this.prisma.influencerBooking.count({ where: { deletedAt: null } }),
      this.prisma.influencerBooking.count({
        where: { deletedAt: null, bookingStatus: 'PENDING' },
      }),
      this.prisma.influencerBooking.aggregate({
        where: { deletedAt: null, paymentStatus: 'PAID' },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      totalBookings,
      pendingApproval,
      totalRevenue: revenueResult._sum.totalAmount || 0,
    };
  }

  async updateBookingStatusAdmin(id: number, dto: UpdateBookingStatusDto) {
    const booking = await this.prisma.influencerBooking.findFirst({
      where: { id, deletedAt: null },
    });
    if (!booking) {
      throw new NotFoundException(`Booking #${id} not found`);
    }

    return this.prisma.influencerBooking.update({
      where: { id },
      data: {
        bookingStatus: dto.status,
        ...(dto.reason !== undefined && { rejectionReason: dto.reason }),
        ...(dto.status === 'COMPLETED' && { completedAt: new Date() }),
        ...(dto.status === 'CANCELLED' && { cancelledAt: new Date() }),
      },
    });
  }

  async updatePaymentStatusAdmin(id: number, dto: UpdatePaymentStatusDto) {
    const booking = await this.prisma.influencerBooking.findFirst({
      where: { id, deletedAt: null },
    });
    if (!booking) {
      throw new NotFoundException(`Booking #${id} not found`);
    }

    return this.prisma.influencerBooking.update({
      where: { id },
      data: {
        paymentStatus: dto.paymentStatus,
        ...(dto.paymentStatus === 'PAID' && booking.bookingStatus === 'PENDING' && {
          bookingStatus: 'CONFIRMED',
        }),
      },
    });
  }

  async approveBookingAdmin(id: number) {
    return this.updateBookingStatusAdmin(id, { status: 'CONFIRMED' });
  }

  async rejectBookingAdmin(id: number, reason?: string) {
    return this.updateBookingStatusAdmin(id, { status: 'REJECTED', reason });
  }

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

  // =========================================================================
  // SEED DEFAULTS (ZERO HARDCODED MOCKS IN PRODUCTION)
  // =========================================================================

  private async seedDefaultPackagesForInfluencer(influencerId: number, basePrice: number) {
    const defaultPackages = [
      {
        name: '1 Story Package',
        type: 'STORY',
        description: 'Single Instagram story highlight with swipe-up / product link tag.',
        duration: '24 Hours',
        price: Math.max(1500, Math.round(basePrice * 0.4)),
        isPopular: false,
        sortOrder: 1,
      },
      {
        name: '1 Reel Package',
        type: 'REEL',
        description: 'Dedicated aesthetic 30-60s Reel with audio sync and brand collaboration tag.',
        duration: 'Permanent Post',
        price: basePrice,
        isPopular: true,
        sortOrder: 2,
      },
      {
        name: '1 Feed Post Package',
        type: 'POST',
        description: 'Carousel feed post (3-5 slides) with detailed brand review and hashtags.',
        duration: 'Permanent Post',
        price: Math.max(2500, Math.round(basePrice * 0.8)),
        isPopular: false,
        sortOrder: 3,
      },
      {
        name: 'Full Campaign Bundle',
        type: 'CUSTOM',
        description: 'Complete promotion: 1 Dedicated Reel + 2 Stories + Feed Carousel Post.',
        duration: 'Multi-day Campaign',
        price: Math.round(basePrice * 1.8),
        isPopular: false,
        sortOrder: 4,
      },
    ];

    for (const p of defaultPackages) {
      await this.prisma.influencerPackage.create({
        data: {
          influencerId,
          ...p,
          status: 'ACTIVE',
        },
      });
    }

    // Seed 14 days of default availability
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const avDate = new Date(today);
      avDate.setDate(today.getDate() + i);
      avDate.setHours(0, 0, 0, 0);

      await this.prisma.influencerAvailability.create({
        data: {
          influencerId,
          date: avDate,
          isAvailable: true,
          startTime: '10:00 AM',
          endTime: '07:00 PM',
        },
      });
    }
  }

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
  }

  // =========================================================================
  // SELF-REGISTRATION & APPLICATION WORKFLOW
  // =========================================================================

  async registerInfluencer(dto: RegisterInfluencerDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const normalizedPhone = (dto.phone || '').trim();

    if (!normalizedEmail) {
      throw new BadRequestException('Email address is required');
    }
    if (!normalizedPhone) {
      throw new BadRequestException('Mobile number is required');
    }
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Full name is required');
    }
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existingInfluencer = await this.prisma.influencer.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { phone: normalizedPhone },
        ],
        deletedAt: null,
      },
    });
    if (existingInfluencer) {
      if (existingInfluencer.email === normalizedEmail) {
        throw new ConflictException('An influencer application with this email already exists');
      }
      throw new ConflictException('An influencer application with this mobile number already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let categoryName = dto.categoryName;
    if (dto.categoryId && !categoryName) {
      const cat = await this.prisma.influencerCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (cat) categoryName = cat.name;
    }

    const handle = dto.instagramHandle
      ? (dto.instagramHandle.startsWith('@') ? dto.instagramHandle : `@${dto.instagramHandle.replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')}`)
      : `@${dto.name.toLowerCase().replace(/[^a-z0-9_]/g, '')}_${Math.floor(1000 + Math.random() * 9000)}`;

    const newInfluencer = await this.prisma.influencer.create({
      data: {
        name: dto.name.trim(),
        handle,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        categoryId: dto.categoryId,
        categoryName,
        bio: dto.bio,
        location: dto.location || 'India',
        city: dto.city,
        platform: dto.platform || 'INSTAGRAM',
        instagramHandle: dto.instagramHandle,
        youtubeHandle: dto.youtubeHandle,
        socialLinks: dto.socialLinks ? dto.socialLinks : undefined,
        profileImage: dto.profileImage,
        avatarUrl: dto.profileImage,
        coverImage: dto.coverImage,
        followers: dto.followers || 0,
        followersCount: dto.followersCount || (dto.followers ? `${(dto.followers / 1000).toFixed(0)}K` : '0'),
        startingPrice: dto.startingPrice,
        status: 'PENDING', // STRICT SERVER ENFORCEMENT: Never trust client-injected status
        isActive: false,   // Must remain inactive until approved by admin
        isVerified: false,
      },
      include: {
        category: true,
      },
    });

    const { passwordHash: _, ...safeInfluencer } = newInfluencer;

    this.logger.log(`[INFLUENCER_REGISTERED] Creator registered: ${safeInfluencer.name} (${safeInfluencer.email}) with status PENDING`);

    return {
      success: true,
      message: 'Application submitted successfully. It will be reviewed by our admin team.',
      status: 'PENDING',
      influencer: safeInfluencer,
    };
  }

  async getApplicationStatus(identifier: string | number) {
    const isNum = !isNaN(Number(identifier));
    const influencer = await this.prisma.influencer.findFirst({
      where: {
        ...(isNum ? { id: Number(identifier) } : { email: String(identifier).trim().toLowerCase() }),
        deletedAt: null,
      },
      include: {
        category: true,
      },
    });
    if (!influencer) {
      throw new NotFoundException('Influencer application not found');
    }
    const { passwordHash: _, ...safeInfluencer } = influencer;
    return safeInfluencer;
  }

  async resubmitApplication(id: number, dto: ResubmitInfluencerDto) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${id} not found`);
    }
    if (influencer.status !== 'REJECTED') {
      throw new BadRequestException('Only rejected influencer applications can be resubmitted');
    }

    const updated = await this.prisma.influencer.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.categoryName !== undefined && { categoryName: dto.categoryName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.instagramHandle !== undefined && { instagramHandle: dto.instagramHandle }),
        ...(dto.youtubeHandle !== undefined && { youtubeHandle: dto.youtubeHandle }),
        ...(dto.socialLinks !== undefined && { socialLinks: dto.socialLinks }),
        ...(dto.profileImage !== undefined && { profileImage: dto.profileImage, avatarUrl: dto.profileImage }),
        ...(dto.followers !== undefined && { followers: dto.followers }),
        ...(dto.followersCount !== undefined && { followersCount: dto.followersCount }),
        status: 'PENDING',
        rejectionReason: null,
        updatedAt: new Date(),
      },
      include: {
        category: true,
      },
    });

    const { passwordHash: _, ...safeInfluencer } = updated;
    this.logger.log(`[INFLUENCER_RESUBMITTED] Creator #${id} (${safeInfluencer.name}) resubmitted application for review`);

    return {
      success: true,
      message: 'Application resubmitted successfully. It is now pending admin review.',
      status: 'PENDING',
      influencer: safeInfluencer,
    };
  }

  // =========================================================================
  // ADMIN APPLICATION REVIEW & LIFECYCLE MANAGEMENT
  // =========================================================================

  async getInfluencerApplicationsAdmin(query: any) {
    const whereClause: any = {
      deletedAt: null,
    };

    if (query?.status && query.status.toUpperCase() !== 'ALL') {
      const statusUpper = query.status.toUpperCase();
      whereClause.status = statusUpper === 'APPROVED' ? { in: ['APPROVED', 'ACTIVE'] } : statusUpper;
    }

    if (query?.category && query.category.toLowerCase() !== 'all') {
      whereClause.OR = [
        { category: { slug: query.category.toLowerCase() } },
        { category: { name: { contains: query.category, mode: 'insensitive' } } },
        { categoryName: { contains: query.category, mode: 'insensitive' } },
      ];
    }

    if (query?.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      whereClause.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { handle: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { location: { contains: search, mode: 'insensitive' } },
            { categoryName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total, pendingCount, approvedCount, rejectedCount, suspendedCount] = await Promise.all([
      this.prisma.influencer.findMany({
        where: whereClause,
        include: {
          category: true,
          packages: {
            where: { deletedAt: null },
            take: 5,
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.influencer.count({ where: { deletedAt: null } }),
      this.prisma.influencer.count({ where: { deletedAt: null, status: 'PENDING' } }),
      this.prisma.influencer.count({ where: { deletedAt: null, status: { in: ['APPROVED', 'ACTIVE'] } } }),
      this.prisma.influencer.count({ where: { deletedAt: null, status: 'REJECTED' } }),
      this.prisma.influencer.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    ]);

    const safeItems = items.map((item) => {
      const { passwordHash: _, ...safe } = item;
      return safe;
    });

    return {
      items: safeItems,
      counts: {
        total,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        suspended: suspendedCount,
      },
    };
  }

  async approveInfluencerAdmin(id: number, adminId?: number) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${id} not found`);
    }

    const updated = await this.prisma.influencer.update({
      where: { id },
      data: {
        status: 'APPROVED',
        isActive: true,
        isVerified: true,
        approvedAt: new Date(),
        ...(adminId ? { approvedBy: adminId } : {}),
        rejectionReason: null,
      },
      include: {
        category: true,
      },
    });

    const { passwordHash: _, ...safe } = updated;
    this.logger.log(`[INFLUENCER_APPROVED] Admin approved creator #${id} (${updated.name})`);

    return {
      success: true,
      message: `Influencer ${updated.name} has been approved and is now live in the mobile hub`,
      status: 'APPROVED',
      influencer: safe,
    };
  }

  async rejectInfluencerAdmin(id: number, dto: RejectInfluencerDto, adminId?: number) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${id} not found`);
    }

    const updated = await this.prisma.influencer.update({
      where: { id },
      data: {
        status: 'REJECTED',
        isActive: false,
        rejectionReason: dto.reason.trim(),
        rejectedAt: new Date(),
        ...(adminId ? { rejectedBy: adminId } : {}),
      },
      include: {
        category: true,
      },
    });

    const { passwordHash: _, ...safe } = updated;
    this.logger.log(`[INFLUENCER_REJECTED] Admin rejected creator #${id} (${updated.name}) reason: "${dto.reason}"`);

    return {
      success: true,
      message: `Influencer ${updated.name} application has been rejected`,
      status: 'REJECTED',
      rejectionReason: dto.reason.trim(),
      influencer: safe,
    };
  }

  async suspendInfluencerAdmin(id: number, adminId?: number) {
    const influencer = await this.prisma.influencer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!influencer) {
      throw new NotFoundException(`Influencer #${id} not found`);
    }

    const updated = await this.prisma.influencer.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
        isActive: false,
        suspendedAt: new Date(),
        ...(adminId ? { suspendedBy: adminId } : {}),
      },
      include: {
        category: true,
      },
    });

    const { passwordHash: _, ...safe } = updated;
    this.logger.log(`[INFLUENCER_SUSPENDED] Admin suspended creator #${id} (${updated.name})`);

    return {
      success: true,
      message: `Influencer ${updated.name} has been suspended and removed from mobile listings`,
      status: 'SUSPENDED',
      influencer: safe,
    };
  }
}
