import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LeadPriority, LeadStatus, RecordCreatedFrom } from '@prisma/client';

export function normalizeLeadStatus(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const parenMatch = trimmed.match(/\(([^)]+)\)$/);
  const rawKey = parenMatch ? parenMatch[1].trim() : trimmed;
  const upper = rawKey.toUpperCase().replace(/[\s-]+/g, '_');
  // Canonical and new 12-stage sequence mappings
  if (upper === 'NEW') return LeadStatus.NEW;
  if (upper === 'CONTACTED') return LeadStatus.CONTACTED;
  if (upper === 'CALL_BACK' || upper === 'CALLBACK') return LeadStatus.CALL_BACK;
  if (upper === 'DETAILS_SENT' || upper === 'DETAILSSENT') return LeadStatus.DETAILS_SENT;
  if (upper === 'FOLLOW_UP' || upper === 'FOLLOWUP') return LeadStatus.FOLLOW_UP;
  if (upper === 'VISIT_SCHEDULED' || upper === 'VISITSCHEDULED') return LeadStatus.VISIT_SCHEDULED;
  if (upper === 'VISIT_DONE' || upper === 'VISITDONE') return LeadStatus.VISIT_DONE;
  if (upper === 'PROPOSAL_SENT' || upper === 'PROPOSALSENT') return LeadStatus.PROPOSAL_SENT;
  if (upper === 'NEGOTIATION') return LeadStatus.NEGOTIATION;
  if (upper === 'FINAL_CALL' || upper === 'FINALCALL') return LeadStatus.FINAL_CALL;
  if (upper === 'WON') return LeadStatus.WON;
  if (upper === 'LOST') return LeadStatus.LOST;
  // Legacy compatibility mappings
  if (upper === 'VISIT') return LeadStatus.VISIT;
  if (upper === 'QUALIFIED') return LeadStatus.QUALIFIED;
  if (upper === 'PROPOSAL') return LeadStatus.PROPOSAL;
  if (upper === 'PAYMENT' || upper === 'PAYMENT_PENDING') return LeadStatus.PAYMENT;
  if (upper === 'WORK_STARTED' || upper === 'WORKSTARTED') return LeadStatus.WORK_STARTED;
  if (upper === 'CANCELLED') return LeadStatus.CANCELLED;
  if (upper === 'CONVERTED' || upper === 'WON_CONVERTED' || upper === 'CONVERT') return LeadStatus.CONVERTED;
  return upper;
}

export function cleanOptionalField({ value }: { value: any }): any {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const upper = trimmed.toUpperCase();
    if (upper === 'N/A' || upper === 'NA' || upper === 'NONE' || upper === 'NULL' || upper === '-') {
      return undefined;
    }
    return trimmed;
  }
  return value;
}

export class CreateLeadDto {
  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct && direct !== 'Business Lead' && direct !== 'Direct Lead' && direct !== 'New Lead') return direct;

    // 1. Real business / display / company name
    const comp = cleanOptionalField({ value: obj?.companyName }) || cleanOptionalField({ value: obj?.businessName });
    if (comp && comp !== 'Business Lead' && comp !== 'Direct Lead' && comp !== 'New Lead') return comp;

    if (obj?.displayName) {
      const dn = typeof obj.displayName === 'object' ? obj.displayName?.text : obj.displayName;
      const cleanDn = cleanOptionalField({ value: dn });
      if (cleanDn && cleanDn !== 'Business Lead' && cleanDn !== 'Direct Lead' && cleanDn !== 'New Lead') return cleanDn;
    }

    const place = cleanOptionalField({ value: obj?.placeName }) ||
      cleanOptionalField({ value: obj?.establishmentName }) ||
      cleanOptionalField({ value: obj?.organizationName }) ||
      cleanOptionalField({ value: obj?.formattedName });
    if (place && place !== 'Business Lead' && place !== 'Direct Lead' && place !== 'New Lead') return place;

    // 2. Real name if not resource ID or placeholder
    if (obj?.name && typeof obj.name === 'string' && obj.name.trim() && !obj.name.startsWith('places/')) {
      const cleanN = obj.name.trim();
      if (cleanN !== 'Business Lead' && cleanN !== 'Direct Lead' && cleanN !== 'New Lead') return cleanN;
    }

    // 3. Contact person name
    const contactName = [
      obj?.firstName || obj?.first_name,
      obj?.lastName || obj?.last_name,
    ].filter(Boolean).join(' ').trim();
    if (
      contactName &&
      contactName !== 'Business Owner' &&
      contactName !== 'Unknown Business' &&
      contactName !== 'Business Lead' &&
      contactName !== 'Direct Lead' &&
      contactName !== 'New Lead'
    ) return contactName;

    // 4. Fallback
    if (obj?.email || obj?.emailAddress) return (obj.email || obj.emailAddress).trim();
    if (obj?.phone || obj?.mobile) return (obj.phone || obj.mobile).trim();
    return undefined;
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Alice' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct && direct !== 'Business Lead' && direct !== 'Business Owner' && direct !== 'Unknown Business' && direct !== 'Business' && direct !== 'Lead') return direct;
    const fn = cleanOptionalField({ value: obj?.first_name });
    if (fn && fn !== 'Business Lead' && fn !== 'Business Owner' && fn !== 'Unknown Business' && fn !== 'Business' && fn !== 'Lead') return fn;
    if (
      obj?.name &&
      typeof obj.name === 'string' &&
      obj.name.trim() &&
      obj.name.trim() !== 'Business Lead' &&
      obj.name.trim() !== 'Direct Lead' &&
      obj.name.trim() !== 'New Lead' &&
      obj.name.trim() !== 'Business' &&
      obj.name.trim() !== 'Lead' &&
      obj.name.trim() !== obj?.companyName &&
      obj.name.trim() !== obj?.title &&
      obj.name.trim() !== obj?.businessName &&
      !obj.name.startsWith('places/')
    ) {
      return obj.name.trim().split(/\s+/)[0];
    }
    return '';
  })
  @IsString()
  @IsOptional()
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'Alice', description: 'Alias for firstName' })
  @IsString()
  @IsOptional()
  first_name?: string | null;

  @ApiPropertyOptional({ example: 'Smith' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct && direct !== 'Business Lead' && direct !== 'Business Owner' && direct !== 'Unknown Business' && direct !== 'Business' && direct !== 'Lead') return direct;
    const ln = cleanOptionalField({ value: obj?.last_name });
    if (ln && ln !== 'Business Lead' && ln !== 'Business Owner' && ln !== 'Unknown Business' && ln !== 'Business' && ln !== 'Lead') return ln;
    if (
      obj?.name &&
      typeof obj.name === 'string' &&
      obj.name.trim() &&
      obj.name.trim() !== 'Business Lead' &&
      obj.name.trim() !== 'Direct Lead' &&
      obj.name.trim() !== 'New Lead' &&
      obj.name.trim() !== 'Business' &&
      obj.name.trim() !== 'Lead' &&
      obj.name.trim() !== obj?.companyName &&
      obj.name.trim() !== obj?.title &&
      obj.name.trim() !== obj?.businessName &&
      !obj.name.startsWith('places/')
    ) {
      const parts = obj.name.trim().split(/\s+/);
      return parts.slice(1).join(' ') || '';
    }
    return '';
  })
  @IsString()
  @IsOptional()
  lastName?: string | null;

  @ApiPropertyOptional({ example: 'Smith', description: 'Alias for lastName' })
  @IsString()
  @IsOptional()
  last_name?: string | null;

  @ApiPropertyOptional({ example: 'Alice Smith', description: 'Full name fallback' })
  @IsString()
  @IsOptional()
  name?: string | null;

  @ApiPropertyOptional({ example: 'alice@techcorp.com' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    const raw = direct || cleanOptionalField({ value: obj?.emailAddress || obj?.email_address });
    if (raw && typeof raw === 'string') {
      return raw.trim().toLowerCase();
    }
    return undefined;
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com', description: 'Alias for email' })
  @IsOptional()
  emailAddress?: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com', description: 'Alias for email' })
  @IsOptional()
  email_address?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct) return direct;
    const m = cleanOptionalField({
      value: obj?.mobile || obj?.mobileNumber || obj?.phoneNumber || obj?.contactNumber || obj?.phone_number,
    });
    if (m) return m;
    return undefined;
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Alias for phone' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Alias for phone' })
  @IsString()
  @IsOptional()
  mobileNumber?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Alias for phone' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Alias for phone' })
  @IsString()
  @IsOptional()
  phone_number?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Alias for phone' })
  @IsString()
  @IsOptional()
  contactNumber?: string;

  @ApiPropertyOptional({ example: 'Alice Smith', description: 'Alias for full name' })
  @IsString()
  @IsOptional()
  full_name?: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com', description: 'Google Discovery user email' })
  @IsOptional()
  user_email?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Google Discovery user phone' })
  @IsString()
  @IsOptional()
  user_phone?: string;

  @ApiPropertyOptional({ example: '+91 98200 12345', description: 'Google Discovery user phone' })
  @IsString()
  @IsOptional()
  user_phone_number?: string;

  @ApiPropertyOptional({ description: 'Google Lead Ads user_column_data array' })
  @IsOptional()
  user_column_data?: any[];

  @ApiPropertyOptional({ description: 'Google / external column data array' })
  @IsOptional()
  column_data?: any[];

  @ApiPropertyOptional({ description: 'Google / external form data array' })
  @IsOptional()
  form_data?: any[];

  @ApiPropertyOptional({ description: 'External field key-value array' })
  @IsOptional()
  fields?: any[];

  @ApiPropertyOptional({ example: 'google_lead_12345', description: 'Google Lead ID' })
  @IsString()
  @IsOptional()
  lead_id?: string;

  @ApiPropertyOptional({ example: 'form_98765' })
  @IsString()
  @IsOptional()
  form_id?: string;

  @ApiPropertyOptional({ example: 'campaign_456' })
  @IsString()
  @IsOptional()
  campaign_id?: string;

  @ApiPropertyOptional({ example: 'Google Discovery Campaign' })
  @IsString()
  @IsOptional()
  campaign_name?: string;

  @ApiPropertyOptional({ description: 'Google Webhook verification key' })
  @IsString()
  @IsOptional()
  google_key?: string;

  @ApiPropertyOptional({ description: 'Nested lead data container' })
  @IsOptional()
  lead_data?: any;

  @ApiPropertyOptional({ description: 'Nested Google lead container' })
  @IsOptional()
  google_lead?: any;

  @ApiPropertyOptional({ description: 'Generic nested data payload' })
  @IsOptional()
  data?: any;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct && direct !== 'Business Lead' && direct !== 'Direct Lead' && direct !== 'New Lead') return direct;
    const bName = cleanOptionalField({ value: obj?.businessName }) || cleanOptionalField({ value: obj?.business_name });
    if (bName && bName !== 'Business Lead' && bName !== 'Direct Lead' && bName !== 'New Lead') return bName;
    if (obj?.displayName) {
      const dn = typeof obj.displayName === 'object' ? obj.displayName?.text : obj.displayName;
      const cleanDn = cleanOptionalField({ value: dn });
      if (cleanDn && cleanDn !== 'Business Lead' && cleanDn !== 'Direct Lead' && cleanDn !== 'New Lead') return cleanDn;
    }
    const place = cleanOptionalField({ value: obj?.placeName }) ||
      cleanOptionalField({ value: obj?.establishmentName }) ||
      cleanOptionalField({ value: obj?.organizationName }) ||
      cleanOptionalField({ value: obj?.formattedName });
    if (place && place !== 'Business Lead' && place !== 'Direct Lead' && place !== 'New Lead') return place;
    if (obj?.name && typeof obj.name === 'string' && obj.name.trim() && !obj.name.startsWith('places/')) {
      const cleanN = obj.name.trim();
      if (cleanN !== 'Business Lead' && cleanN !== 'Direct Lead' && cleanN !== 'New Lead') return cleanN;
    }
    const t = cleanOptionalField({ value: obj?.title });
    if (t && t !== 'Business Lead' && t !== 'Direct Lead' && t !== 'New Lead') return t;
    return null;
  })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub', description: 'Google Discovery display name' })
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (typeof value === 'string') return cleanOptionalField({ value });
    if (typeof value === 'object' && value.text) return cleanOptionalField({ value: value.text });
    return undefined;
  })
  @IsOptional()
  displayName?: any;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub', description: 'Alias for business / place name' })
  @IsString()
  @IsOptional()
  placeName?: string;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub', description: 'Alias for business / establishment name' })
  @IsString()
  @IsOptional()
  establishmentName?: string;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub', description: 'Alias for business / organization name' })
  @IsString()
  @IsOptional()
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Gold\'s Gym & Fitness Hub', description: 'Alias for formatted business name' })
  @IsString()
  @IsOptional()
  formattedName?: string;

  @ApiPropertyOptional({ example: 'uuid-1234-5678', description: 'Unique capture event / request identifier' })
  @IsString()
  @IsOptional()
  captureRequestId?: string;

  @ApiPropertyOptional({ example: 'ChIJ1234567890', description: 'Source record ID' })
  @IsString()
  @IsOptional()
  sourceRecordId?: string;

  @ApiPropertyOptional({ example: 'https://techcorp.com' })
  @Transform(cleanOptionalField)
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: '123 Business Hub, MG Road' })
  @Transform(cleanOptionalField)
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @Transform(({ value, obj }) => {
    const directCity = cleanOptionalField({ value });
    if (directCity) return directCity;
    const loc = cleanOptionalField({ value: obj?.location });
    if (loc) return loc;
    return null;
  })
  @IsString()
  @IsOptional()
  city?: string | null;

  @ApiPropertyOptional({ example: 'Mumbai', description: 'Alias for city' })
  @Transform(({ value, obj }) => {
    const directLoc = cleanOptionalField({ value });
    if (directLoc) return directLoc;
    const c = cleanOptionalField({ value: obj?.city });
    if (c) return c;
    return null;
  })
  @IsString()
  @IsOptional()
  location?: string | null;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @Transform(cleanOptionalField)
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '560078' })
  @Transform(({ value, obj }) => {
    const direct = cleanOptionalField({ value });
    if (direct) return direct;
    const fallback = cleanOptionalField({
      value: obj?.postalCode || obj?.zipCode || obj?.pinCode || obj?.pin_code,
    });
    if (fallback) return fallback;
    return undefined;
  })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiPropertyOptional({ example: '560078', description: 'Alias for pincode' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({ example: '560078', description: 'Alias for pincode' })
  @IsString()
  @IsOptional()
  zipCode?: string;

  @ApiPropertyOptional({ example: '560078', description: 'Alias for pincode' })
  @IsString()
  @IsOptional()
  pinCode?: string;

  @ApiPropertyOptional({ example: '560078', description: 'Alias for pincode' })
  @IsString()
  @IsOptional()
  pin_code?: string;

  @ApiPropertyOptional({ example: 'IT & Software' })
  @Transform(cleanOptionalField)
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'WEBSITE' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ enum: RecordCreatedFrom, example: RecordCreatedFrom.ADMIN_PANEL, description: 'Creation platform origin (MOBILE_APP or ADMIN_PANEL)' })
  @IsOptional()
  createdFrom?: RecordCreatedFrom | string;

  @ApiPropertyOptional({ example: LeadStatus.NEW })
  @Transform(({ value }) => (value ? normalizeLeadStatus(value) : undefined))
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ enum: LeadPriority, example: LeadPriority.HIGH })
  @IsEnum(LeadPriority)
  @IsOptional()
  priority?: LeadPriority;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  stageId?: number;

  @ApiPropertyOptional({ example: 45000.0 })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({ example: 1 })
  @Transform(cleanOptionalField)
  @IsOptional()
  assignedToId?: number | string;

  @ApiPropertyOptional({ example: '2026-08-20T10:00:00.000Z' })
  @IsOptional()
  nextFollowUpDate?: Date;

  @ApiPropertyOptional({ example: '11:00 AM' })
  @IsString()
  @IsOptional()
  nextFollowUpTime?: string;

  @ApiPropertyOptional({ example: '2026-08-25T09:00:00.000Z' })
  @IsOptional()
  workStartDate?: Date;

  @ApiPropertyOptional({ example: 'Project scope kick-off notes' })
  @IsString()
  @IsOptional()
  workNotes?: string;

  @ApiPropertyOptional({ example: 'Alpha Delivery Squad' })
  @IsString()
  @IsOptional()
  assignedTeam?: string;

  @ApiPropertyOptional({ example: 10000.0 })
  @IsNumber()
  @IsOptional()
  paidAmount?: number;

  @ApiPropertyOptional({ example: 'PENDING' })
  @IsString()
  @IsOptional()
  paymentStatus?: string;

  @ApiPropertyOptional({ example: 'BANK_TRANSFER' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'TXN-984723' })
  @IsString()
  @IsOptional()
  paymentRef?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 19.076 })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8777 })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ example: 'ChIJN1t_tDeuEmsRUsoyG83frY4' })
  @Transform(cleanOptionalField)
  @IsString()
  @IsOptional()
  googlePlaceId?: string;

  @ApiPropertyOptional({ example: 4.8 })
  @IsNumber()
  @IsOptional()
  rating?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsNumber()
  @IsOptional()
  reviewCount?: number;

  @ApiPropertyOptional({ description: 'Social media links dictionary (instagram, facebook, linkedin, youtube, twitter, website)' })
  @IsOptional()
  socialMedia?: Record<string, string>;

  @ApiPropertyOptional({ example: 'https://instagram.com/company', description: 'Alias for socialMedia.instagram' })
  @IsString()
  @IsOptional()
  instagram?: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/company', description: 'Alias for socialMedia.facebook' })
  @IsString()
  @IsOptional()
  facebook?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/company/profile', description: 'Alias for socialMedia.linkedin' })
  @IsString()
  @IsOptional()
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/@channel', description: 'Alias for socialMedia.youtube' })
  @IsString()
  @IsOptional()
  youtube?: string;

  @ApiPropertyOptional({ example: 'https://x.com/company', description: 'Alias for socialMedia.twitter' })
  @IsString()
  @IsOptional()
  twitter?: string;

  @ApiPropertyOptional({ example: 'Initial requirement notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class AddLeadImageDto {
  @ApiPropertyOptional({ example: 'https://example.com/store.jpg' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({ example: 'Storefront entrance photo' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ example: 'leads/images/123-abc.jpg' })
  @IsString()
  @IsOptional()
  key?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  templateId?: number;

  @ApiPropertyOptional({ example: 'Your Lead Status Has Been Updated' })
  @IsString()
  @IsOptional()
  customSubject?: string;

  @ApiPropertyOptional({ example: 'Dear Customer...' })
  @IsString()
  @IsOptional()
  customBody?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  sendWhatsapp?: boolean;

  @ApiPropertyOptional({ example: 'Hi Rahul...' })
  @IsString()
  @IsOptional()
  whatsappMessage?: string;

  @ApiPropertyOptional({ example: 'lead_stage_proposal' })
  @IsString()
  @IsOptional()
  whatsappTemplateName?: string;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  whatsappTemplateId?: number;
}

export class CheckDuplicateDto {
  @ApiPropertyOptional({ example: '+91 98200 12345' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'TechCorp Solutions' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'https://techcorp.com' })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: 'ChIJN1t_tDeuEmsRUsoyG83frY4' })
  @IsString()
  @IsOptional()
  googlePlaceId?: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com' })
  @IsString()
  @IsOptional()
  email?: string;
}

export class ConvertLeadDto {
  @ApiPropertyOptional({ example: 'TechCorp Solutions Pvt Ltd' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'Enterprise Deal Q3' })
  @IsString()
  @IsOptional()
  dealTitle?: string;

  @ApiPropertyOptional({ example: 150000.0 })
  @IsNumber()
  @IsOptional()
  dealValue?: number;

  @ApiPropertyOptional({ example: 'Lead successfully qualified and converted to enterprise customer' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateLeadNoteDto {
  @ApiProperty({ example: 'Client requested demo schedule next Monday.' })
  @IsString()
  @IsNotEmpty()
  content: string;
}

export class LogFollowUpDto {
  @ApiProperty({ example: 'Interested', description: 'Interested, Not Interested, Call Later, No Response, Wrong Number, Follow-up Required' })
  @IsString()
  @IsNotEmpty()
  outcome: string;

  @ApiPropertyOptional({ example: 'Spoke with CEO, requested on-site architecture visit.' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-08-19' })
  @IsOptional()
  nextFollowUpDate?: string;

  @ApiPropertyOptional({ example: '03:00 PM' })
  @IsString()
  @IsOptional()
  nextFollowUpTime?: string;
}

export class ManageVisitDto {
  @ApiProperty({ example: 'SCHEDULE', description: 'SCHEDULE | START | COMPLETE' })
  @IsString()
  @IsNotEmpty()
  action: 'SCHEDULE' | 'START' | 'COMPLETE';

  @ApiPropertyOptional({ example: 12, description: 'Assigned employee/visitor ID' })
  @Allow()
  @IsOptional()
  employeeId?: number | string;

  @ApiPropertyOptional({ example: 'Product Demo & Architecture Review' })
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional({ example: '2026-08-20' })
  @Allow()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ example: '11:00 AM' })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiPropertyOptional({ example: 'Andheri East, Mumbai' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 19.1136 })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8697 })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Client was impressed with offline sync capability.' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'Demonstrated complete CRM pipeline, verified GPS tracking.' })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiPropertyOptional({ example: 'Positive, requested commercial proposal.' })
  @IsString()
  @IsOptional()
  customerResponse?: string;
}

export class ProposalItemDto {
  @ApiProperty({ example: 'Enterprise CRM Annual License' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 5 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 15000 })
  @IsNumber()
  unitPrice: number;

  @ApiProperty({ example: 75000 })
  @IsNumber()
  total: number;
}

export class CreateProposalDto {
  @ApiPropertyOptional({ example: 'PROP-2026-001' })
  @IsString()
  @IsOptional()
  proposalNo?: string;

  @ApiPropertyOptional({ type: [ProposalItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items?: ProposalItemDto[];

  @ApiProperty({ example: 75000 })
  @IsNumber()
  subTotal: number;

  @ApiProperty({ example: 13500 })
  @IsNumber()
  taxAmount: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiProperty({ example: 83500 })
  @IsNumber()
  totalAmount: number;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  validUntil?: string;

  @ApiPropertyOptional({ example: 'Includes 24/7 technical SLA and data migration support.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class FinalCallDto {
  @ApiPropertyOptional({ example: 83500 })
  @IsNumber()
  @IsOptional()
  proposalAmount?: number;

  @ApiProperty({ example: 'Accepted', description: 'Accepted | Negotiation | Call Later | Rejected | Interested' })
  @IsString()
  @IsNotEmpty()
  customerResponse: string;

  @ApiPropertyOptional({ example: 'Agreed on 5% discount, payment via NEFT next Monday.' })
  @IsString()
  @IsOptional()
  negotiationNotes?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsOptional()
  expectedClosingDate?: string;

  @ApiPropertyOptional({ example: 'Send payment invoice' })
  @IsString()
  @IsOptional()
  nextAction?: string;
}

export class RecordPaymentDto {
  @ApiProperty({ example: 83500 })
  @IsNumber()
  totalAmount: number;

  @ApiProperty({ example: 83500 })
  @IsNumber()
  paidAmount: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  pendingAmount?: number;

  @ApiProperty({ example: 'BANK_TRANSFER', description: 'RAZORPAY | BANK_TRANSFER | CASH | CREDIT_CARD | OTHER' })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiPropertyOptional({ example: '2026-08-18' })
  @IsOptional()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'HDFC-NEFT-92847291' })
  @IsString()
  @IsOptional()
  transactionRef?: string;

  @ApiProperty({ example: 'PAID', description: 'PENDING | PARTIAL | PAID | FAILED | CANCELLED' })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ example: '100% advance received via NEFT.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class StartWorkDto {
  @ApiProperty({ example: '2026-08-20' })
  @IsNotEmpty()
  workStartDate: string;

  @ApiPropertyOptional({ example: 'CRM Implementation Squad Alpha' })
  @IsString()
  @IsOptional()
  assignedTeam?: string;

  @ApiPropertyOptional({ example: 'Enterprise CRM Deployment & Data Import' })
  @IsString()
  @IsOptional()
  serviceName?: string;

  @ApiPropertyOptional({ example: 'Initial sprint kickoff scheduled with IT Admin.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateLeadStatusDto {
  @ApiPropertyOptional({ example: LeadStatus.FOLLOW_UP })
  @Transform(({ value }) => (value ? normalizeLeadStatus(value) : undefined))
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  stageId?: number;

  @ApiPropertyOptional({ example: 'Moved to next pipeline stage' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  templateId?: number;

  @ApiPropertyOptional({ example: 'Your Lead Status Has Been Updated' })
  @IsString()
  @IsOptional()
  customSubject?: string;

  @ApiPropertyOptional({ example: 'Dear Rahul...' })
  @IsString()
  @IsOptional()
  customBody?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  sendWhatsapp?: boolean;

  @ApiPropertyOptional({ example: 'Hi Rahul...' })
  @IsString()
  @IsOptional()
  whatsappMessage?: string;

  @ApiPropertyOptional({ example: 'lead_stage_proposal' })
  @IsString()
  @IsOptional()
  whatsappTemplateName?: string;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  whatsappTemplateId?: number;
}

export class SendLeadWhatsAppDto {
  @ApiPropertyOptional({ example: 'Hi Rahul, here is an update regarding your inquiry...' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({ example: 'lead_stage_proposal' })
  @IsString()
  @IsOptional()
  templateName?: string;

  @ApiPropertyOptional({ example: 'Proposal' })
  @IsString()
  @IsOptional()
  stageName?: string;

  @ApiPropertyOptional({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  stageId?: number;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  whatsappTemplateId?: number;
}

export class SendLeadEmailDto {
  @ApiPropertyOptional({ example: 'Update regarding your inquiry' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ example: 'Hi Rahul, we have prepared your project proposal...' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  templateId?: number;
}


export class CreateLeadStageDto {
  @ApiProperty({ example: 'Interested' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '#10B981' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ example: '#ECFDF5' })
  @IsString()
  @IsOptional()
  bgColor?: string;

  @ApiPropertyOptional({ example: '#A7F3D0' })
  @IsString()
  @IsOptional()
  borderColor?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Whether automatic email notification is enabled for this stage' })
  @IsBoolean()
  @IsOptional()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Email template ID to send on stage transition' })
  @IsNumber()
  @IsOptional()
  emailTemplateId?: number | null;

  @ApiPropertyOptional({ example: true, description: 'Whether automatic WhatsApp notification is enabled for this stage' })
  @IsBoolean()
  @IsOptional()
  whatsappEnabled?: boolean;

  @ApiPropertyOptional({ example: 2, description: 'Meta WhatsApp template ID to send on stage transition' })
  @IsNumber()
  @IsOptional()
  whatsappTemplateId?: number | null;
}

export class UpdateLeadStageDto extends PartialType(CreateLeadStageDto) {}

export class ReorderLeadStagesItemDto {
  @ApiProperty({ example: 3, description: 'Stage ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 2, description: 'New sort order / position (1-based)' })
  @IsNumber()
  sortOrder: number;
}

export class ReorderLeadStagesDto {
  @ApiProperty({
    type: [ReorderLeadStagesItemDto],
    description: 'Array of stage IDs and their new sort order positions',
    example: [
      { id: 1, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
      { id: 2, sortOrder: 3 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderLeadStagesItemDto)
  stages: ReorderLeadStagesItemDto[];
}

export class BulkDeleteLeadsDto {
  @ApiPropertyOptional({
    description: 'Array of numeric Lead IDs to delete',
    type: [Number],
    example: [101, 102, 103],
  })
  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((v) => Number(v)).filter((n) => !isNaN(n) && n > 0)));
    }
    if (typeof value === 'string') {
      return Array.from(new Set(value.split(',').map((v) => Number(v.trim())).filter((n) => !isNaN(n) && n > 0)));
    }
    if (typeof value === 'number' && !isNaN(value) && value > 0) {
      return [value];
    }
    return value;
  })
  ids?: number[];

  @ApiPropertyOptional({
    description: 'Alternative alias array for Lead IDs to delete',
    type: [Number],
    example: [101, 102, 103],
  })
  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((v) => Number(v)).filter((n) => !isNaN(n) && n > 0)));
    }
    if (typeof value === 'string') {
      return Array.from(new Set(value.split(',').map((v) => Number(v.trim())).filter((n) => !isNaN(n) && n > 0)));
    }
    if (typeof value === 'number' && !isNaN(value) && value > 0) {
      return [value];
    }
    return value;
  })
  leadIds?: number[];

  get resolvedIds(): number[] {
    const list = this.ids || this.leadIds || [];
    return Array.from(new Set(list.map(Number).filter((n) => !isNaN(n) && n > 0)));
  }
}

