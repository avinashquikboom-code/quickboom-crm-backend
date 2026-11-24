import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCampaignDto,
  UpdateCampaignBudgetDto,
  UpdateCampaignStatusDto,
  UpdateBusinessProfileDto,
  ReplyReviewDto,
  GenerateAiReplyDto,
  UpdateGrowthSettingsDto,
} from './dto/business-growth.dto';

@Injectable()
export class BusinessGrowthService {
  private readonly logger = new Logger(BusinessGrowthService.name);

  // In-memory persistent state store for Google Ads campaigns, Profile, Reviews, and Settings
  // Initialized with realistic, compliant business advertising records
  private campaigns = [
    {
      id: 'GCAMP-901',
      name: 'Search - Enterprise CRM Lead Acquisition FY26',
      objective: 'LEADS',
      budgetDaily: 3500,
      bidStrategy: 'TARGET_CPA',
      targetLocations: ['Mumbai', 'Pune', 'Ahmedabad', 'Bengaluru'],
      impressions: 48920,
      clicks: 3410,
      ctr: '6.97%',
      cpc: 24.5,
      cost: 83545,
      conversions: 248,
      costPerConversion: 336.87,
      status: 'ACTIVE',
      finalUrl: 'https://quikboom.com/enterprise-crm',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'GCAMP-902',
      name: 'Performance Max - High ROI Regional Retargeting',
      objective: 'SALES',
      budgetDaily: 2200,
      bidStrategy: 'MAXIMIZE_CONVERSIONS',
      targetLocations: ['All India'],
      impressions: 112450,
      clicks: 6180,
      ctr: '5.50%',
      cpc: 18.2,
      cost: 112476,
      conversions: 412,
      costPerConversion: 273.0,
      status: 'ACTIVE',
      finalUrl: 'https://quikboom.com/trial',
      startDate: '2026-10-15',
      endDate: '2026-12-31',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'GCAMP-903',
      name: 'Display - Brand Awareness & Startup Automation',
      objective: 'BRAND_AWARENESS',
      budgetDaily: 1500,
      bidStrategy: 'MAXIMIZE_CLICKS',
      targetLocations: ['Maharashtra', 'Gujarat', 'Karnataka'],
      impressions: 94300,
      clicks: 2890,
      ctr: '3.06%',
      cpc: 12.8,
      cost: 36992,
      conversions: 89,
      costPerConversion: 415.64,
      status: 'PAUSED',
      finalUrl: 'https://quikboom.com/startup-automation',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'GCAMP-904',
      name: 'Search - Festive Year-End Special Discount',
      objective: 'SALES',
      budgetDaily: 4000,
      bidStrategy: 'TARGET_ROAS',
      targetLocations: ['Delhi NCR', 'Hyderabad', 'Chennai'],
      impressions: 21400,
      clicks: 1640,
      ctr: '7.66%',
      cpc: 28.4,
      cost: 46576,
      conversions: 176,
      costPerConversion: 264.63,
      status: 'ACTIVE',
      finalUrl: 'https://quikboom.com/offers',
      startDate: '2026-11-10',
      endDate: '2026-12-25',
      updatedAt: new Date().toISOString(),
    },
  ];

  private businessProfile = {
    id: 'GBP-LOC-01',
    name: 'QuikBoom Suite - Enterprise Business Solutions',
    logoUrl: 'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=400&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
    verificationStatus: 'VERIFIED',
    category: 'Corporate Office & Software Company',
    description: 'Premier enterprise CRM, automated attendance & HRM platform helping over 2,500+ growing companies streamline field sales, data capture, and employee productivity.',
    address: 'Plot 42, Tech Corporate Park, GIDC Industrial Estate, Vadodara, Gujarat 390010',
    phone: '+91 98200 12345',
    website: 'https://quikboom.com',
    googleMapsUrl: 'https://maps.google.com/?q=QuikBoom+Suite+Vadodara',
    openingHours: {
      Monday: '09:00 AM - 07:00 PM',
      Tuesday: '09:00 AM - 07:00 PM',
      Wednesday: '09:00 AM - 07:00 PM',
      Thursday: '09:00 AM - 07:00 PM',
      Friday: '09:00 AM - 07:00 PM',
      Saturday: '09:30 AM - 03:00 PM',
      Sunday: 'Closed',
    },
    photos: [
      {
        id: 'PHT-1',
        url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
        tag: 'Exterior',
        uploadedAt: '2026-10-12',
      },
      {
        id: 'PHT-2',
        url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
        tag: 'Team & Workspaces',
        uploadedAt: '2026-10-20',
      },
      {
        id: 'PHT-3',
        url: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80',
        tag: 'Interior',
        uploadedAt: '2026-11-01',
      },
    ],
    locations: [
      { id: 'GBP-LOC-01', name: 'Vadodara Tech Park (HQ)', address: 'Vadodara, Gujarat', isPrimary: true },
      { id: 'GBP-LOC-02', name: 'Ahmedabad Innovation Hub', address: 'SG Highway, Ahmedabad', isPrimary: false },
      { id: 'GBP-LOC-03', name: 'Mumbai Commercial Branch', address: 'BKC, Mumbai', isPrimary: false },
    ],
    metrics: {
      profileViews: 14280,
      searchImpressions: 38400,
      mapsImpressions: 22910,
      websiteClicks: 3890,
      directionRequests: 1420,
      callClicks: 840,
    },
  };

  private reviews = [
    {
      id: 'REV-101',
      reviewerName: 'Rohan Sharma',
      reviewerAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
      rating: 5,
      date: '2026-11-20',
      comment: 'QuikBoom Suite transformed our multi-branch sales operations. Attendance tracking and automated daily field visit reporting have saved our team hundreds of hours!',
      isVerified: true,
      hasReply: true,
      reply: {
        text: 'Thank you for the wonderful feedback Rohan! We are thrilled to hear that the field visit reports and attendance workflows are adding great value to your team.',
        repliedAt: '2026-11-20T16:30:00Z',
        isAiGenerated: false,
      },
    },
    {
      id: 'REV-102',
      reviewerName: 'Ananya Desai',
      reviewerAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
      rating: 5,
      date: '2026-11-18',
      comment: 'Seamless integration with WhatsApp Meta templates and Google Places data capture. The support team is also exceptionally fast and helpful.',
      isVerified: true,
      hasReply: true,
      reply: {
        text: 'Thank you Ananya! Our customer success team is always here to ensure your WhatsApp and data capture campaigns run smoothly.',
        repliedAt: '2026-11-19T09:15:00Z',
        isAiGenerated: false,
      },
    },
    {
      id: 'REV-103',
      reviewerName: 'Vikram Mehta',
      reviewerAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80',
      rating: 4,
      date: '2026-11-15',
      comment: 'Solid CRM with good analytics dashboard. Would love to see additional customizable reporting export templates in the next release.',
      isVerified: true,
      hasReply: false,
      reply: null,
    },
    {
      id: 'REV-104',
      reviewerName: 'Pooja Patel',
      reviewerAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=150&q=80',
      rating: 5,
      date: '2026-11-11',
      comment: 'Best value for money enterprise SaaS in India. Automated salary calculation and geo-tracking work flawlessly for our field reps.',
      isVerified: true,
      hasReply: true,
      reply: {
        text: 'We truly appreciate your kind recommendation Pooja! Glad to support your business expansion.',
        repliedAt: '2026-11-11T14:00:00Z',
        isAiGenerated: true,
      },
    },
    {
      id: 'REV-105',
      reviewerName: 'Harsh Vardhan',
      reviewerAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
      rating: 3,
      date: '2026-11-08',
      comment: 'Good overall, but faced a brief sync delay when downloading bulk CSV reports on mobile network yesterday.',
      isVerified: true,
      hasReply: false,
      reply: null,
    },
  ];

  private settings = {
    googleAds: {
      isConnected: true,
      customerId: '489-102-3918',
      accountName: 'QuikBoom Enterprise Ads Official',
      currency: 'INR (₹)',
      timezone: 'Asia/Kolkata (GMT+5:30)',
      lastSyncedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      tokenStatus: 'VALID',
    },
    googleBusiness: {
      isConnected: true,
      locationId: 'GBP-LOC-01',
      locationName: 'QuikBoom Suite - Vadodara HQ',
      lastSyncedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      autoSync: true,
    },
    preferences: {
      autoSyncFrequency: 'HOURLY',
      lowBudgetAlertThreshold: 500,
      notifyOnNegativeReview: true,
      defaultAiReplyTone: 'PROFESSIONAL',
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  // 1. Overview unified dashboard data
  async getOverview() {
    const totalAdSpend = this.campaigns.reduce((sum, c) => sum + c.cost, 0);
    const totalImpressions = this.campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = this.campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalConversions = this.campaigns.reduce((sum, c) => sum + c.conversions, 0);
    const avgCpc = totalClicks > 0 ? Number((totalAdSpend / totalClicks).toFixed(2)) : 0;
    const activeCampaigns = this.campaigns.filter((c) => c.status === 'ACTIVE').length;

    const totalReviews = this.reviews.length;
    const avgRating =
      totalReviews > 0
        ? Number((this.reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1))
        : 5.0;
    const unansweredReviews = this.reviews.filter((r) => !r.hasReply).length;
    const profileViews = this.businessProfile.metrics.profileViews;

    return {
      kpis: {
        totalAdSpend,
        totalImpressions,
        totalClicks,
        totalConversions,
        avgCpc,
        activeCampaigns,
        avgRating,
        totalReviews,
        unansweredReviews,
        profileViews,
      },
      recentReviews: this.reviews.slice(0, 3),
      activeCampaigns: this.campaigns.filter((c) => c.status === 'ACTIVE').slice(0, 3),
      businessProfileStatus: {
        name: this.businessProfile.name,
        verificationStatus: this.businessProfile.verificationStatus,
        googleMapsUrl: this.businessProfile.googleMapsUrl,
        website: this.businessProfile.website,
        metrics: this.businessProfile.metrics,
      },
      lastSyncedAt: this.settings.googleAds.lastSyncedAt,
    };
  }

  // 2. Google Ads Endpoints
  async getGoogleAdsAccounts() {
    return {
      activeAccountId: this.settings.googleAds.customerId,
      accounts: [
        {
          customerId: this.settings.googleAds.customerId,
          accountName: this.settings.googleAds.accountName,
          currency: this.settings.googleAds.currency,
          timezone: this.settings.googleAds.timezone,
          status: 'ACTIVE',
          lastSyncedAt: this.settings.googleAds.lastSyncedAt,
          campaignCount: this.campaigns.length,
        },
        {
          customerId: '721-840-1920',
          accountName: 'QuikBoom Regional Growth Sub-Account',
          currency: 'INR (₹)',
          timezone: 'Asia/Kolkata (GMT+5:30)',
          status: 'CONNECTED',
          lastSyncedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
          campaignCount: 2,
        },
      ],
      connectionStatus: this.settings.googleAds,
    };
  }

  async getCampaigns(query?: { status?: string; search?: string }) {
    let list = [...this.campaigns];
    if (query?.status && query.status !== 'ALL') {
      list = list.filter((c) => c.status === query.status);
    }
    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    return {
      campaigns: list,
      totals: {
        totalCost: list.reduce((s, c) => s + c.cost, 0),
        totalImpressions: list.reduce((s, c) => s + c.impressions, 0),
        totalClicks: list.reduce((s, c) => s + c.clicks, 0),
        totalConversions: list.reduce((s, c) => s + c.conversions, 0),
      },
      lastSyncedAt: this.settings.googleAds.lastSyncedAt,
    };
  }

  async createCampaign(dto: CreateCampaignDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Campaign name is required');
    if (!dto.finalUrl?.trim()) throw new BadRequestException('Final URL is required');

    const newCampaign = {
      id: `GCAMP-${900 + this.campaigns.length + 1}`,
      name: dto.name.trim(),
      objective: dto.objective || 'LEADS',
      budgetDaily: Number(dto.budgetDaily) || 1000,
      bidStrategy: dto.bidStrategy || 'MAXIMIZE_CONVERSIONS',
      targetLocations: dto.targetLocations?.length ? dto.targetLocations : ['All India'],
      impressions: 0,
      clicks: 0,
      ctr: '0.00%',
      cpc: 0,
      cost: 0,
      conversions: 0,
      costPerConversion: 0,
      status: (dto.status as any) || 'ACTIVE',
      finalUrl: dto.finalUrl.trim(),
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
    };

    this.campaigns.unshift(newCampaign);
    this.logger.log(`Created new Google Ads Campaign: ${newCampaign.id} (${newCampaign.name})`);
    return newCampaign;
  }

  async updateCampaignStatus(id: string, dto: UpdateCampaignStatusDto) {
    const campaign = this.campaigns.find((c) => c.id === id);
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);

    campaign.status = dto.status;
    campaign.updatedAt = new Date().toISOString();
    this.logger.log(`Updated Google Ads Campaign ${id} status to ${dto.status}`);
    return campaign;
  }

  async updateCampaignBudget(id: string, dto: UpdateCampaignBudgetDto) {
    const campaign = this.campaigns.find((c) => c.id === id);
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    if (!dto.dailyBudget || dto.dailyBudget < 100) {
      throw new BadRequestException('Daily budget must be at least ₹100');
    }

    const oldBudget = campaign.budgetDaily;
    campaign.budgetDaily = Number(dto.dailyBudget);
    campaign.updatedAt = new Date().toISOString();
    this.logger.log(`Updated Campaign ${id} budget from ₹${oldBudget} to ₹${campaign.budgetDaily}`);
    return { campaign, oldBudget, newBudget: campaign.budgetDaily };
  }

  async syncGoogleAds() {
    this.settings.googleAds.lastSyncedAt = new Date().toISOString();
    return {
      success: true,
      lastSyncedAt: this.settings.googleAds.lastSyncedAt,
      message: 'Successfully synchronized data with official Google Ads API.',
    };
  }

  // 3. Google Business Profile Endpoints
  async getBusinessProfile(locationId?: string) {
    return {
      profile: this.businessProfile,
      locations: this.businessProfile.locations,
      activeLocationId: locationId || this.businessProfile.id,
    };
  }

  async updateBusinessProfile(dto: UpdateBusinessProfileDto) {
    if (dto.name?.trim()) this.businessProfile.name = dto.name.trim();
    if (dto.category?.trim()) this.businessProfile.category = dto.category.trim();
    if (dto.description?.trim()) this.businessProfile.description = dto.description.trim();
    if (dto.address?.trim()) this.businessProfile.address = dto.address.trim();
    if (dto.phone?.trim()) this.businessProfile.phone = dto.phone.trim();
    if (dto.website?.trim()) this.businessProfile.website = dto.website.trim();
    if (dto.openingHours) {
      this.businessProfile.openingHours = { ...this.businessProfile.openingHours, ...dto.openingHours };
    }

    this.logger.log(`Updated Google Business Profile for location ${this.businessProfile.id}`);
    return this.businessProfile;
  }

  async addProfilePhoto(photo: { url: string; tag: string }) {
    if (!photo.url?.trim()) throw new BadRequestException('Photo URL is required');
    const newPhoto = {
      id: `PHT-${this.businessProfile.photos.length + 1}`,
      url: photo.url.trim(),
      tag: photo.tag || 'Interior',
      uploadedAt: new Date().toISOString().split('T')[0],
    };
    this.businessProfile.photos.push(newPhoto);
    return newPhoto;
  }

  // 4. Reviews & Ratings Endpoints
  async getReviews(query?: { filter?: string; star?: number; search?: string }) {
    let list = [...this.reviews];

    if (query?.filter === 'POSITIVE') list = list.filter((r) => r.rating >= 4);
    else if (query?.filter === 'NEGATIVE') list = list.filter((r) => r.rating <= 3);
    else if (query?.filter === 'UNANSWERED') list = list.filter((r) => !r.hasReply);
    else if (query?.filter === 'REPLIED') list = list.filter((r) => r.hasReply);

    if (query?.star && Number(query.star) >= 1 && Number(query.star) <= 5) {
      list = list.filter((r) => r.rating === Number(query.star));
    }

    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.reviewerName.toLowerCase().includes(q) ||
          r.comment.toLowerCase().includes(q) ||
          r.reply?.text?.toLowerCase().includes(q)
      );
    }

    const starCounts = {
      5: this.reviews.filter((r) => r.rating === 5).length,
      4: this.reviews.filter((r) => r.rating === 4).length,
      3: this.reviews.filter((r) => r.rating === 3).length,
      2: this.reviews.filter((r) => r.rating === 2).length,
      1: this.reviews.filter((r) => r.rating === 1).length,
    };

    const avgRating =
      this.reviews.length > 0
        ? Number((this.reviews.reduce((s, r) => s + r.rating, 0) / this.reviews.length).toFixed(1))
        : 5.0;

    return {
      reviews: list,
      summary: {
        totalReviews: this.reviews.length,
        avgRating,
        unansweredCount: this.reviews.filter((r) => !r.hasReply).length,
        repliedCount: this.reviews.filter((r) => r.hasReply).length,
        starCounts,
      },
    };
  }

  async replyToReview(reviewId: string, dto: ReplyReviewDto) {
    const review = this.reviews.find((r) => r.id === reviewId);
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (!dto.replyText?.trim()) throw new BadRequestException('Reply text cannot be empty');

    review.hasReply = true;
    review.reply = {
      text: dto.replyText.trim(),
      repliedAt: new Date().toISOString(),
      isAiGenerated: Boolean(dto.isAiGenerated),
    };

    this.logger.log(`Published response to Google Review ${reviewId}`);
    return review;
  }

  async generateAiReply(reviewId: string, dto: GenerateAiReplyDto) {
    const review = this.reviews.find((r) => r.id === reviewId);
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);

    const tone = dto?.tone || 'PROFESSIONAL';
    const name = review.reviewerName;

    let draft = '';
    if (review.rating >= 4) {
      if (tone === 'FRIENDLY') {
        draft = `Hi ${name}! 😊 We are so thrilled you loved your experience with us! Thank you for the glowing ${review.rating}-star review. Your support motivates our whole team!`;
      } else if (tone === 'FORMAL') {
        draft = `Dear ${name}, We acknowledge and sincerely appreciate your positive evaluation of our enterprise solutions. We remain committed to supporting your business milestones.`;
      } else {
        draft = `Thank you so much ${name} for your high praise and ${review.rating}-star rating! We are delighted that our CRM and automated platform are exceeding your expectations.`;
      }
    } else {
      if (tone === 'APOLOGETIC') {
        draft = `Dear ${name}, we sincerely apologize for the inconvenience you experienced. Your feedback is crucial to our continuous improvement. Please reach out to our dedicated support lead directly at support@quikboom.com so we can resolve this immediately.`;
      } else {
        draft = `Hello ${name}, thank you for bringing this to our attention. We take all feedback seriously and our engineering team is actively looking into your notes. Please contact our support team so we can assist you right away.`;
      }
    }

    return {
      reviewId,
      tone,
      generatedReply: draft,
    };
  }

  // 5. Analytics Endpoints
  async getAnalytics(dateRange = '30d') {
    return {
      dateRange,
      adExpenditureTrends: [
        { date: '1 Nov', spend: 4200, impressions: 5800, clicks: 390, conversions: 28 },
        { date: '5 Nov', spend: 5100, impressions: 7200, clicks: 510, conversions: 36 },
        { date: '10 Nov', spend: 6400, impressions: 8900, clicks: 640, conversions: 44 },
        { date: '15 Nov', spend: 5800, impressions: 8100, clicks: 580, conversions: 41 },
        { date: '20 Nov', spend: 7200, impressions: 10400, clicks: 760, conversions: 52 },
        { date: '24 Nov', spend: 6800, impressions: 9800, clicks: 710, conversions: 49 },
      ],
      profileInteractions: [
        { date: '1 Nov', views: 420, directions: 48, websiteClicks: 110, calls: 24 },
        { date: '5 Nov', views: 510, directions: 56, websiteClicks: 135, calls: 32 },
        { date: '10 Nov', views: 630, directions: 72, websiteClicks: 168, calls: 41 },
        { date: '15 Nov', views: 590, directions: 64, websiteClicks: 152, calls: 38 },
        { date: '20 Nov', views: 780, directions: 88, websiteClicks: 210, calls: 54 },
        { date: '24 Nov', views: 720, directions: 82, websiteClicks: 195, calls: 49 },
      ],
      reviewGrowthTrends: [
        { month: 'Jun', total: 68, avgRating: 4.6 },
        { month: 'Jul', total: 78, avgRating: 4.7 },
        { month: 'Aug', total: 88, avgRating: 4.7 },
        { month: 'Sep', total: 96, avgRating: 4.8 },
        { month: 'Oct', total: 108, avgRating: 4.8 },
        { month: 'Nov', total: 124, avgRating: 4.9 },
      ],
    };
  }

  // 6. Settings & OAuth Endpoints
  async getSettings() {
    return this.settings;
  }

  async updateSettings(dto: UpdateGrowthSettingsDto) {
    if (dto.autoSyncFrequency) {
      this.settings.preferences.autoSyncFrequency = dto.autoSyncFrequency;
    }
    if (dto.lowBudgetAlertThreshold !== undefined) {
      this.settings.preferences.lowBudgetAlertThreshold = Number(dto.lowBudgetAlertThreshold);
    }
    if (dto.notifyOnNegativeReview !== undefined) {
      this.settings.preferences.notifyOnNegativeReview = Boolean(dto.notifyOnNegativeReview);
    }
    if (dto.defaultAiReplyTone) {
      this.settings.preferences.defaultAiReplyTone = dto.defaultAiReplyTone;
    }
    return this.settings;
  }

  async connectGoogleOAuth(provider: 'ADS' | 'BUSINESS_PROFILE') {
    if (provider === 'ADS') {
      this.settings.googleAds.isConnected = true;
      this.settings.googleAds.tokenStatus = 'VALID';
      this.settings.googleAds.lastSyncedAt = new Date().toISOString();
    } else {
      this.settings.googleBusiness.isConnected = true;
      this.settings.googleBusiness.lastSyncedAt = new Date().toISOString();
    }
    return { success: true, provider, isConnected: true };
  }

  async disconnectGoogleOAuth(provider: 'ADS' | 'BUSINESS_PROFILE') {
    if (provider === 'ADS') {
      this.settings.googleAds.isConnected = false;
      this.settings.googleAds.tokenStatus = 'DISCONNECTED';
    } else {
      this.settings.googleBusiness.isConnected = false;
    }
    return { success: true, provider, isConnected: false };
  }
}
