import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterCustomerDto,
  RegisterEmployeeDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyMobileOtpDto,
} from './dto/auth.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SetMetadata } from '@nestjs/common';

export const Public = () => SetMetadata('isPublic', true);

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send 6-digit OTP code to mobile number via SMS' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code and authenticate user' })
  @ApiResponse({ status: 200, description: 'User authenticated successfully' })
  async verifyOtp(@Body() dto: VerifyMobileOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new Customer and Customer Admin' })
  @ApiResponse({ status: 210, description: 'Customer created successfully' })
  async register(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Public()
  @Post('register/employee')
  @ApiOperation({ summary: 'Register a new Employee (Company or Freelancer)' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  async registerEmployee(@Body() dto: RegisterEmployeeDto) {
    return this.authService.registerEmployee(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login with email and password' })
  @ApiResponse({ status: 200, description: 'Logged in successfully' })
  async login(@Body() dto: LoginDto, @Headers('x-client-type') clientType?: string) {
    return this.authService.login(dto, clientType);
  }

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super Admin login for Admin Panel' })
  async adminLogin(@Body() dto: LoginDto) {
    return this.authService.login(dto, 'ADMIN');
  }

  @Public()
  @Post('employee/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Employee mobile application login' })
  async employeeLogin(@Body() dto: LoginDto) {
    return this.authService.login(dto, 'EMPLOYEE_MOBILE');
  }

  @Public()
  @Post('login/employee')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Employee mobile application login alias' })
  async loginEmployee(@Body() dto: LoginDto) {
    return this.authService.login(dto, 'EMPLOYEE');
  }

  @Public()
  @Post('mobile/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mobile application login alias' })
  async mobileLogin(@Body() dto: LoginDto) {
    return this.authService.login(dto, 'EMPLOYEE_MOBILE');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT Access Token using Refresh Token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Public()
  @Post('refresh-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias for refresh token' })
  async refreshTokensAlias(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP via email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({ summary: 'Get current logged-in user profile' })
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id || user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get current user identity' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id || user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('roles')
  @ApiOperation({ summary: 'Get all database roles' })
  async getRoles(@CurrentUser() user: any) {
    return this.authService.getRoles(user.customerId);
  }
}
