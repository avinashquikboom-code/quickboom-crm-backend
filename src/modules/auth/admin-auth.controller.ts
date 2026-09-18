import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { SetMetadata } from '@nestjs/common';

export const Public = () => SetMetadata('isPublic', true);

@ApiTags('Admin Authentication')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AuthService) {}

  // ✅ SUPER ADMIN LOGIN
  @Public()
  @Post('login/super-admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super Admin login for Admin Panel' })
  @ApiResponse({ status: 200, description: 'Super Admin logged in successfully' })
  async loginSuperAdmin(
    @Body() loginDto: LoginDto,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, 'SUPER_ADMIN');
  }

  // ✅ SUPER ADMIN TOKEN REFRESH
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT Access Token for Admin Panel' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  async refreshAdmin(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Public()
  @Post('refresh-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias for admin refresh token' })
  async refreshAdminAlias(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }
}
