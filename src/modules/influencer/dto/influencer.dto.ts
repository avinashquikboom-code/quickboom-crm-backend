import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}

export class CreateInfluencerDto {
  @ApiProperty({ description: 'Full name of the influencer', example: 'Ananya Sharma' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Social media handle', example: '@ananya_lifestyle' })
  @IsOptional()
  @IsString()
  handle?: string;

  @ApiPropertyOptional({ description: 'Avatar / Profile image URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'High-res profile/cover image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

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

  @ApiPropertyOptional({ description: 'Creator bio' })
  @IsOptional()
  @IsString()
  bio?: string;

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

  @ApiPropertyOptional({ description: 'Avatar / Profile image URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Profile image URL' })
  @IsOptional()
  @IsString()
  profileImage?: string;

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

  @ApiPropertyOptional({ description: 'Bio' })
  @IsOptional()
  @IsString()
  bio?: string;

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
