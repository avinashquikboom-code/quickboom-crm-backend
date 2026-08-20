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
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('contacts')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new CRM contact' })
  async create(@CurrentCustomer() customerId: string, @Body() dto: CreateContactDto) {
    return this.contactService.create(customerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of contacts' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.contactService.findAll(customerId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      search,
      type,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact details by ID' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.contactService.findOne(customerId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contact details' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete contact' })
  async remove(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.contactService.delete(customerId, id);
  }
}
