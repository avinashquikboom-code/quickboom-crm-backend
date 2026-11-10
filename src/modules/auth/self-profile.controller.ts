import { Body, Controller, Get, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SelfProfileService } from './self-profile.service';
import { UpdateSelfProfileDto, ChangeSelfPasswordDto, SelfActivityDto } from './dto/self-profile.dto';

@Controller('auth/profile')
@UseGuards(JwtAuthGuard)
export class SelfProfileController {
  constructor(private readonly service: SelfProfileService) {}
  @Put() update(@CurrentUser() user: any, @Body() dto: UpdateSelfProfileDto) { return this.service.update(user.id, dto); }
  @Post('password') password(@CurrentUser() user: any, @Body() dto: ChangeSelfPasswordDto) { return this.service.password(user.id, dto); }
  @Post('photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  photo(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) { return this.service.photo(user.id, file); }
  @Get('activity') activity(@CurrentUser() user: any, @Query() query: SelfActivityDto) { return this.service.activity(user.id, query); }
}
