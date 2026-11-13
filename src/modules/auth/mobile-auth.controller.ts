import { Controller, Post, Body, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterEmployeeDto, SendOtpDto, VerifyMobileOtpDto } from './dto/auth.dto';
import { SetMetadata } from '@nestjs/common';

export const Public = () => SetMetadata('isPublic', true);

@ApiTags('Mobile Authentication')
@Controller(['mobile/auth', 'customer-auth'])
export class MobileAuthController {
  constructor(private readonly authService: AuthService) {}

  // ✅ EMPLOYEE REGISTRATION
  @Public()
  @Post('register/employee')
  @ApiOperation({ summary: 'Register a new Employee (Company or Freelancer)' })
  @ApiResponse({ status: 201, description: 'Employee registered successfully' })
  async registerEmployee(@Body() dto: RegisterEmployeeDto) {
    return this.authService.registerEmployee(dto);
  }

  // ✅ SEND OTP (MSG91)
  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send 6-digit OTP to Indian mobile number via MSG91' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  // ✅ VERIFY OTP
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify mobile OTP and login' })
  @ApiResponse({ status: 200, description: 'User logged in successfully' })
  async verifyOtp(@Body() dto: VerifyMobileOtpDto, @Headers('x-app') app?: string) {
    const appName = String(app || '').toLowerCase();
    return this.authService.verifyOtp(dto, appName === 'crm', appName === 'customer');
  }

  // ✅ CUSTOMER LOGIN
  @Public()
  @Post(['login/customer', 'login'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer mobile and portal login' })
  @ApiResponse({ status: 200, description: 'Customer logged in successfully' })
  async loginCustomer(
    @Body() loginDto: LoginDto,
    @Headers('x-app') app?: string,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'CUSTOMER_MOBILE', false);
  }

  // ✅ EMPLOYEE LOGIN
  @Public()
  @Post('login/employee')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Employee mobile login' })
  @ApiResponse({ status: 200, description: 'Employee logged in successfully' })
  async loginEmployee(
    @Body() loginDto: LoginDto,
    @Headers('x-app') app?: string,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'EMPLOYEE', String(app || '').toLowerCase() === 'crm');
  }

  // ✅ COMPANY ADMIN LOGIN
  @Public()
  @Post('login/company-admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Company Admin mobile login' })
  @ApiResponse({ status: 200, description: 'Company admin logged in successfully' })
  async loginCompanyAdmin(
    @Body() loginDto: LoginDto,
    @Headers('x-app') app?: string,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'COMPANY_ADMIN', String(app || '').toLowerCase() === 'crm');
  }

  // ✅ LOGOUT
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mobile user logout' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout() {
    return { success: true, message: 'Logged out successfully' };
  }
}
