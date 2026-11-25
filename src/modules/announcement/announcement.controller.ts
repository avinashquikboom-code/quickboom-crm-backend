import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { S3Service } from '../s3/s3.service';
import { AnnouncementService } from './announcement.service';
import { AnnouncementBodyDto, AnnouncementQueryDto, ScheduleAnnouncementDto } from './dto/announcement.dto';

@ApiTags('HRM Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('admin/hrm/announcements')
export class AnnouncementController {
  constructor(
    private readonly announcements: AnnouncementService,
    @Optional() private readonly s3Service?: S3Service,
  ) {}

  @Post('upload-image')
  @ApiOperation({ summary: 'Upload an image for a company announcement' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required for upload');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are supported');
    }
    if (!this.s3Service) {
      throw new BadRequestException('Image upload service is unavailable');
    }
    const result = await this.s3Service.uploadFile(file, 'announcements');
    const previewUrl = await this.s3Service.getPresignedUrl(result.imageKey, 604800).catch(() => null);
    return {
      success: true,
      message: 'Announcement image uploaded successfully',
      data: {
        imageUrl: result.imageUrl,
        imageKey: result.imageKey,
        previewUrl: previewUrl || result.imageUrl,
      },
    };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Announcement counts by status' })
  summary(@CurrentCustomer() customerId: number | string | undefined, @Query() query: AnnouncementQueryDto) {
    return this.announcements.summary(customerId, query);
  }

  @Get()
  @ApiOperation({ summary: 'List company announcements' })
  findAll(@CurrentCustomer() customerId: number | string | undefined, @Query() query: AnnouncementQueryDto) {
    return this.announcements.findAll(customerId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft announcement' })
  create(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Body() dto: AnnouncementBodyDto) {
    return this.announcements.create(user, customerId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Announcement details' })
  findOne(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.findOne(customerId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an announcement' })
  update(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number, @Body() dto: AnnouncementBodyDto) {
    return this.announcements.update(customerId, id, dto);
  }

  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish an announcement' })
  publish(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.publish(customerId, id);
  }

  @Patch(':id/schedule')
  @ApiOperation({ summary: 'Schedule an announcement' })
  schedule(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number, @Body() dto: ScheduleAnnouncementDto) {
    return this.announcements.schedule(customerId, id, dto);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive an announcement' })
  archive(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.archive(customerId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a draft or archived announcement' })
  remove(@CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.remove(customerId, id);
  }
}
