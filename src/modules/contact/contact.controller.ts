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
import { CreateContactDto, UpdateContactDto, CheckDuplicateContactDto } from './dto/contact.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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

  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if contact already exists by email or phone' })
  async checkDuplicate(@CurrentCustomer() customerId: string, @Body() dto: CheckDuplicateContactDto) {
    return this.contactService.checkDuplicate(customerId, dto);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics for contacts' })
  async getMetrics(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    return this.contactService.getMetrics(customerId, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of contacts' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'companyId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    return this.contactService.findAll(
      customerId,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
        search,
        type,
        companyId,
        status,
        assignedToId,
      },
      user,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact details by ID with deals and communications' })
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
