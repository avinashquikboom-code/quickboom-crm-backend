import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Acme Enterprise India' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Acme Global Holdings' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'acme.quikboom.com' })
  @IsString()
  @IsOptional()
  domain?: string;

  @ApiPropertyOptional({ example: 'contact@acme.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '+91 98765 43210' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: '+91 98765 00000' })
  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @ApiPropertyOptional({ example: '101, Business Park, BKC' })
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

  @ApiPropertyOptional({ example: 'India' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '400051' })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiPropertyOptional({ example: 'ENTERPRISE' })
  @IsString()
  @IsOptional()
  customerType?: string;

  @ApiPropertyOptional({ example: 'Information Technology' })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiPropertyOptional({ example: 'DIRECT' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  teamId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  assignedTeamId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  assignedEmployeeId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  createdByEmployeeId?: number;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsString()
  @IsOptional()
  assignedEmployee?: string;

  @ApiPropertyOptional({ example: 'Sales' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'VIP enterprise client with custom SLA.' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @IsOptional()
  userLimit?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsNumber()
  @IsOptional()
  leadLimit?: number;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Acme Enterprise Solutions' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Acme Global Holdings' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'contact@acme.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '+91 98765 00000' })
  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @ApiPropertyOptional({ example: '101, Business Park, BKC' })
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

  @ApiPropertyOptional({ example: 'India' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '400051' })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiPropertyOptional({ example: 'ENTERPRISE' })
  @IsString()
  @IsOptional()
  customerType?: string;

  @ApiPropertyOptional({ example: 'Information Technology' })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiPropertyOptional({ example: 'DIRECT' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  teamId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  assignedTeamId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  assignedEmployeeId?: number;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsString()
  @IsOptional()
  assignedEmployee?: string;

  @ApiPropertyOptional({ example: 'Sales' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'Updated notes.' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsNumber()
  @IsOptional()
  userLimit?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsNumber()
  @IsOptional()
  leadLimit?: number;
}

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ example: 'Acme Enterprises' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Acme Global Holdings Pvt Ltd' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '+91 98765 00000' })
  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @ApiPropertyOptional({ example: '101, Business Park, BKC' })
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

  @ApiPropertyOptional({ example: 'India' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '400051' })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiPropertyOptional({ example: 'Information Technology' })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsString()
  @IsOptional()
  logo?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsString()
  @IsOptional()
  profileImage?: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsString()
  @IsOptional()
  contactPerson?: string;
}

export class AssignCustomerTeamDto {
  @ApiPropertyOptional({ example: 2, description: 'ID of the Team to assign this customer to (or null to unassign)' })
  @IsNumber()
  @IsOptional()
  teamId?: number | null;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  assignedTeamId?: number | null;
}
