import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('contacts')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new CRM contact' })
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateContactDto) {
    return this.contactService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of contacts' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.contactService.findAll(tenantId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      search,
      type,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact details by ID' })
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.contactService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contact details' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete contact' })
  async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.contactService.delete(tenantId, id);
  }
}
