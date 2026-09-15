import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsIn,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export enum InfluencerApplicationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  ALL = 'ALL',
}

export class FilterInfluencerApplicationsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter applications by status',
    enum: InfluencerApplicationStatus,
    example: InfluencerApplicationStatus.PENDING,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsEnum(InfluencerApplicationStatus, {
    message: 'status must be one of the following values: PENDING, APPROVED, REJECTED, SUSPENDED, ALL',
  })
  status?: InfluencerApplicationStatus;

  @ApiPropertyOptional({ description: 'Filter by category slug or name' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Search term for name, handle, email, phone, city' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class FilterInfluencersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category slug or name', example: 'fashion' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter only featured influencers', example: true })
  @IsOptional()
  featured?: boolean | string;

  @ApiPropertyOptional({ description: 'Filter by platform', example: 'INSTAGRAM' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Search term for influencer name, handle or city' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by status (ACTIVE/INACTIVE)' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateInfluencerCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Instagram Influencers' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Unique slug', example: 'instagram' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({ description: 'Icon name or URL' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: 'Category description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Display sort order', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInfluencerCategoryDto {
  @ApiPropertyOptional({ description: 'Category name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Slug' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ description: 'Icon' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInfluencerDto {
  @ApiProperty({ description: 'Full name of the influencer', example: 'Ananya Sharma' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Social media handle', example: '@ananya_lifestyle' })
  @IsOptional()
  @IsString()
  handle?: string;

  @ApiPropertyOptional({ description: 'Avatar / Profile image URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'High-res profile image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ description: 'Cover banner image URL' })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({ description: 'Primary platform', example: 'INSTAGRAM', default: 'INSTAGRAM' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Category name', example: 'Fashion' })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiPropertyOptional({ description: 'Location / State / Country', example: 'Ahmedabad' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'City', example: 'Ahmedabad' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Local area / neighborhood', example: 'Bodakdev' })
  @IsOptional()
  @IsString()
  localArea?: string;

  @ApiPropertyOptional({ description: 'Follower count as number', example: 125000 })
  @IsOptional()
  @IsInt()
  followers?: number;

  @ApiPropertyOptional({ description: 'Display follower count', example: '125K' })
  @IsOptional()
  @IsString()
  followersCount?: string;

  @ApiPropertyOptional({ description: 'Engagement rate in percent', example: 4.8 })
  @IsOptional()
  @IsNumber()
  engagementRate?: number;

  @ApiPropertyOptional({ description: 'Verified creator status', default: true })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ description: 'Featured in carousel', default: true })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: 'Active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Lifecycle status', default: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Verification status badge', default: 'VERIFIED' })
  @IsOptional()
  @IsString()
  verificationStatus?: string;

  @ApiPropertyOptional({ description: 'Top Creator badge', default: false })
  @IsOptional()
  @IsBoolean()
  topCreator?: boolean;

  @ApiPropertyOptional({ description: 'Starting package price' })
  @IsOptional()
  @IsNumber()
  startingPrice?: number;

  @ApiPropertyOptional({ description: 'Creator bio' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'Supported languages', example: ['Hindi', 'English'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ description: 'Instagram handle' })
  @IsOptional()
  @IsString()
  instagramHandle?: string;

  @ApiPropertyOptional({ description: 'YouTube handle' })
  @IsOptional()
  @IsString()
  youtubeHandle?: string;

  @ApiPropertyOptional({ description: 'Gender' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Age range' })
  @IsOptional()
  @IsString()
  ageRange?: string;

  @ApiPropertyOptional({ description: 'Direct booking or portfolio link' })
  @IsOptional()
  @IsString()
  bookingUrl?: string;

  @ApiPropertyOptional({ description: 'Base campaign pricing in INR' })
  @IsOptional()
  @IsNumber()
  pricing?: number;

  @ApiPropertyOptional({ description: 'Rating out of 5', default: 4.9 })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ description: 'Sort display order', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateInfluencerDto {
  @ApiPropertyOptional({ description: 'Full name of the influencer' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Social media handle' })
  @IsOptional()
  @IsString()
  handle?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Profile image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ description: 'Cover banner image URL' })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({ description: 'Primary platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Category name' })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiPropertyOptional({ description: 'Location' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Local area' })
  @IsOptional()
  @IsString()
  localArea?: string;

  @ApiPropertyOptional({ description: 'Followers count' })
  @IsOptional()
  @IsInt()
  followers?: number;

  @ApiPropertyOptional({ description: 'Display follower string' })
  @IsOptional()
  @IsString()
  followersCount?: string;

  @ApiPropertyOptional({ description: 'Engagement rate' })
  @IsOptional()
  @IsNumber()
  engagementRate?: number;

  @ApiPropertyOptional({ description: 'Verified status' })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ description: 'Featured status' })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Lifecycle status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Verification status' })
  @IsOptional()
  @IsString()
  verificationStatus?: string;

  @ApiPropertyOptional({ description: 'Top Creator' })
  @IsOptional()
  @IsBoolean()
  topCreator?: boolean;

  @ApiPropertyOptional({ description: 'Starting price' })
  @IsOptional()
  @IsNumber()
  startingPrice?: number;

  @ApiPropertyOptional({ description: 'Bio' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'Languages' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ description: 'Instagram handle' })
  @IsOptional()
  @IsString()
  instagramHandle?: string;

  @ApiPropertyOptional({ description: 'YouTube handle' })
  @IsOptional()
  @IsString()
  youtubeHandle?: string;

  @ApiPropertyOptional({ description: 'Gender' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Age range' })
  @IsOptional()
  @IsString()
  ageRange?: string;

  @ApiPropertyOptional({ description: 'Booking URL' })
  @IsOptional()
  @IsString()
  bookingUrl?: string;

  @ApiPropertyOptional({ description: 'Pricing' })
  @IsOptional()
  @IsNumber()
  pricing?: number;

  @ApiPropertyOptional({ description: 'Rating' })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// =========================================================================
// INFLUENCER PACKAGE DTOS
// =========================================================================

export class CreateInfluencerPackageDto {
  @ApiProperty({ description: 'Package name', example: '1 Reel Package' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Package type', example: 'REEL', default: 'POST' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Package description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Deliverable duration or turnaround', example: '3-5 Days' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiProperty({ description: 'Package price in INR', example: 5000 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ description: 'Mark as popular package', default: false })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ description: 'Status', default: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateInfluencerPackageDto {
  @ApiPropertyOptional({ description: 'Package name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Package type' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Duration' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ description: 'Price in INR' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Is popular' })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ description: 'Status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// =========================================================================
// AVAILABILITY DTOS
// =========================================================================

export class SetInfluencerAvailabilityDto {
  @ApiProperty({ description: 'Available date in ISO format or YYYY-MM-DD', example: '2026-09-18' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({ description: 'Is date available', default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: 'Optional slot start time', example: '10:00 AM' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: 'Optional slot end time', example: '06:00 PM' })
  @IsOptional()
  @IsString()
  endTime?: string;
}

// =========================================================================
// BOOKING DTOS
// =========================================================================

export class CreateInfluencerBookingDto {
  @ApiProperty({ description: 'Influencer ID' })
  @IsInt()
  @Type(() => Number)
  influencerId: number;

  @ApiPropertyOptional({ description: 'Package ID selected by customer' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  packageId?: number;

  @ApiProperty({ description: 'Campaign date', example: '2026-09-18' })
  @IsString()
  @IsNotEmpty()
  campaignDate: string;

  @ApiProperty({ description: 'Brand name', example: 'Quick Boom' })
  @IsString()
  @IsNotEmpty()
  brandName: string;

  @ApiProperty({ description: 'Contact person name', example: 'Rahul Sharma' })
  @IsString()
  @IsNotEmpty()
  contactPerson: string;

  @ApiProperty({ description: 'Contact phone / WhatsApp number', example: '+91 9876543210' })
  @IsString()
  @IsNotEmpty()
  mobileNumber: string;

  @ApiProperty({ description: 'Contact email address', example: 'contact@brand.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Registered business name', example: 'Quick Boom Agency' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiPropertyOptional({ description: 'Brand Instagram handle', example: '@brand_official' })
  @IsOptional()
  @IsString()
  instagramId?: string;

  @ApiPropertyOptional({ description: 'Campaign objective', example: 'Brand Awareness' })
  @IsOptional()
  @IsString()
  campaignObjective?: string;

  @ApiPropertyOptional({ description: 'Additional campaign brief or notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class VerifyInfluencerPaymentDto {
  @ApiProperty({ description: 'Booking ID string or database ID' })
  @IsNotEmpty()
  bookingId: string | number;

  @ApiPropertyOptional({ description: 'Razorpay payment ID or offline reference', example: 'pay_xxxxxxxx' })
  @IsOptional()
  @IsString()
  razorpayPaymentId?: string;

  @ApiPropertyOptional({ description: 'Razorpay order ID', example: 'order_xxxxxxxx' })
  @IsOptional()
  @IsString()
  razorpayOrderId?: string;

  @ApiPropertyOptional({ description: 'Razorpay signature or OFFLINE', example: 'xxxxxxxxxxxxxxxx' })
  @IsOptional()
  @IsString()
  razorpaySignature?: string;

  @ApiPropertyOptional({ description: 'Payment method: RAZORPAY or OFFLINE', example: 'RAZORPAY' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'Offline payment reference or UTR number', example: 'UTR123456789' })
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional({ description: 'Payment proof URL if uploaded' })
  @IsOptional()
  @IsString()
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Customer payment notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBookingStatusDto {
  @ApiProperty({
    description: 'Updated booking status',
    enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED'],
  })
  @IsString()
  @IsIn(['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED'])
  status: string;

  @ApiPropertyOptional({ description: 'Rejection or cancellation reason' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({
    description: 'Updated payment status',
    enum: ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED'],
  })
  @IsString()
  @IsIn(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED'])
  paymentStatus: string;
}

export class RegisterInfluencerDto {
  @ApiProperty({ description: 'Full Name of the influencer', example: 'Rohan Joshi' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Email address', example: 'rohan.joshi@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Mobile / contact number', example: '+91 9876543210' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'Account password (minimum 6 chars)', example: 'Secret@123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ description: 'Category ID from categories catalog' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Category Name' })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiPropertyOptional({ description: 'Profile bio / description' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'Location / State / Country', default: 'India' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Primary platform', default: 'INSTAGRAM' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Instagram handle or URL' })
  @IsOptional()
  @IsString()
  instagramHandle?: string;

  @ApiPropertyOptional({ description: 'YouTube handle or channel URL' })
  @IsOptional()
  @IsString()
  youtubeHandle?: string;

  @ApiPropertyOptional({ description: 'Other social media profile links (Facebook, TikTok, LinkedIn)' })
  @IsOptional()
  socialLinks?: any;

  @ApiPropertyOptional({ description: 'Profile avatar image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({ description: 'Estimated follower count as integer' })
  @IsOptional()
  @IsInt()
  followers?: number;

  @ApiPropertyOptional({ description: 'Formatted follower count (e.g. 50K)' })
  @IsOptional()
  @IsString()
  followersCount?: string;

  @ApiPropertyOptional({ description: 'Estimated base/starting fee' })
  @IsOptional()
  @IsNumber()
  startingPrice?: number;
}

export class RejectInfluencerDto {
  @ApiProperty({ description: 'Reason for rejection', example: 'Social profile could not be verified' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ResubmitInfluencerDto {
  @ApiPropertyOptional({ description: 'Full Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Category Name' })
  @IsOptional()
  @IsString()
  categoryName?: string;

  @ApiPropertyOptional({ description: 'Bio / description' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'Location' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Instagram handle or URL' })
  @IsOptional()
  @IsString()
  instagramHandle?: string;

  @ApiPropertyOptional({ description: 'YouTube handle or URL' })
  @IsOptional()
  @IsString()
  youtubeHandle?: string;

  @ApiPropertyOptional({ description: 'Other social media links' })
  @IsOptional()
  socialLinks?: any;

  @ApiPropertyOptional({ description: 'Profile image' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ description: 'Follower count' })
  @IsOptional()
  @IsInt()
  followers?: number;

  @ApiPropertyOptional({ description: 'Follower count text' })
  @IsOptional()
  @IsString()
  followersCount?: string;
}

