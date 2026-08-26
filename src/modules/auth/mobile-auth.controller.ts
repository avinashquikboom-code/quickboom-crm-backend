import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/auth.dto';
import { SetMetadata } from '@nestjs/common';

export const Public = () => SetMetadata('isPublic', true);

@ApiTags('Mobile Authentication')
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(private readonly authService: AuthService) {}

  // ✅ CUSTOMER LOGIN
  @Public()
  @Post('login/customer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer mobile login' })
  @ApiResponse({ status: 200, description: 'Customer logged in successfully' })
  async loginCustomer(
    @Body() loginDto: LoginDto,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'CUSTOMER');
  }

  // ✅ EMPLOYEE LOGIN
  @Public()
  @Post('login/employee')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Employee mobile login' })
  @ApiResponse({ status: 200, description: 'Employee logged in successfully' })
  async loginEmployee(
    @Body() loginDto: LoginDto,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'EMPLOYEE');
  }

  // ✅ COMPANY ADMIN LOGIN
  @Public()
  @Post('login/company-admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Company Admin mobile login' })
  @ApiResponse({ status: 200, description: 'Company admin logged in successfully' })
  async loginCompanyAdmin(
    @Body() loginDto: LoginDto,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'COMPANY_ADMIN');
  }
}
