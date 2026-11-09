import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnnouncementService } from './announcement.service';
import { AnnouncementBodyDto, AnnouncementQueryDto, ScheduleAnnouncementDto } from './dto/announcement.dto';

@ApiTags('HRM Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('admin/hrm/announcements')
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

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
