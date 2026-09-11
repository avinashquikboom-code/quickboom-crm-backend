import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LeadPriority, LeadStatus } from '@prisma/client';

export function normalizeLeadStatus(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
  if (upper === 'WON_CONVERTED' || upper === 'CONVERT') return LeadStatus.CONVERTED;
  if (upper === 'FOLLOWUP') return LeadStatus.FOLLOW_UP;
  return upper;
}

export class CreateLeadDto {
  @ApiProperty({ example: 'Enterprise Cloud Modernization' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

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

  @ApiPropertyOptional({ example: '123 Business Hub, MG Road' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: 'IT & Software' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'WEBSITE' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ enum: LeadStatus, example: LeadStatus.NEW })
  @Transform(({ value }) => normalizeLeadStatus(value))
  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: LeadPriority, example: LeadPriority.HIGH })
  @IsEnum(LeadPriority)
  @IsOptional()
  priority?: LeadPriority;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  stageId?: number;

  @ApiPropertyOptional({ example: 45000.0 })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({ example: 1 })
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

  @ApiPropertyOptional({ example: 'Initial requirement notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

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

  @ApiPropertyOptional({ example: 'Product Demo & Architecture Review' })
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional({ example: '2026-08-20' })
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
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.FOLLOW_UP })
  @Transform(({ value }) => normalizeLeadStatus(value))
  @IsEnum(LeadStatus)
  @IsNotEmpty()
  status: LeadStatus;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  stageId?: number;

  @ApiPropertyOptional({ example: 'Moved to next pipeline stage' })
  @IsString()
  @IsOptional()
  notes?: string;
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
}

export class UpdateLeadStageDto extends PartialType(CreateLeadStageDto) {}

