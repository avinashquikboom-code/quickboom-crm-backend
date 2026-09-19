import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@quikboom.com' })
  @IsString()
  @IsNotEmpty({ message: 'Email or phone identifier is required' })
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @ApiPropertyOptional({ enum: ['ADMIN', 'EMPLOYEE_MOBILE', 'CUSTOMER', 'COMPANY_ADMIN', 'EMPLOYEE', 'SUPER_ADMIN'], example: 'ADMIN' })
  @IsOptional()
  @IsString()
  appType?: string;
}

export class RegisterCustomerDto {
  @ApiPropertyOptional({ example: 'Acme Corporation' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'john@acme.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Password123!' })
  @IsString()
  @IsOptional()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;
}

export class RegisterEmployeeDto {
  @ApiProperty({ example: 'Rahul Sharma' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  fullName: string;

  @ApiPropertyOptional({ example: 'Rahul' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Sharma' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'rahul.sharma@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @ApiPropertyOptional({ example: 'Password123!' })
  @IsString()
  @IsOptional()
  confirmPassword?: string;

  @ApiProperty({ enum: ['COMPANY', 'FREELANCER'], example: 'COMPANY' })
  @IsNotEmpty({ message: 'Please select employee type.' })
  @IsEnum(['COMPANY', 'FREELANCER'], { message: 'employeeType must be either COMPANY or FREELANCER' })
  employeeType: 'COMPANY' | 'FREELANCER';

  @ApiPropertyOptional({ example: 'REF2026' })
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ApiPropertyOptional({ example: 'Acme Media' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  planId?: number;

  @ApiPropertyOptional({ example: 'OFFLINE' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'john@acme.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'NewPassword123!' })
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class SendEmailOtpDto {
  @ApiProperty({ example: 'admin@quickboom.com', description: 'Registered account email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email: string;
}

export class VerifyOtpDto {
  @ApiPropertyOptional({ example: 'john@acme.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP verification code' })
  @IsString()
  @IsNotEmpty({ message: 'OTP is required' })
  otp: string;
}

export class SendOtpDto {
  @ApiPropertyOptional({
    example: '9876543210',
    description: '10-digit Indian mobile number with or without +91',
  })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional({
    example: 'admin@quickboom.com',
    description: 'Registered account email address',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;
}

export class VerifyMobileOtpDto {
  @ApiProperty({
    example: '9876543210',
    description: '10-digit Indian mobile number with or without +91',
  })
  @IsString()
  @IsNotEmpty()
  mobile: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code received via SMS',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;
}
