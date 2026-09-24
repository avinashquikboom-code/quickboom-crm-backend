import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DataCaptureService } from '../data-capture/data-capture.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { UpdateLeadDto, CreateLeadDto } from './dto/lead.dto';

describe('Lead Update Pincode Contract & Validation Tests', () => {
  let leadService: LeadService;
  let leadRepository: LeadRepository;

  const mockPrisma: any = {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    leadNote: {
      create: jest.fn().mockResolvedValue({}),
    },
    leadActivityTimeline: {
      create: jest.fn().mockResolvedValue({}),
    },
    employee: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        LeadRepository,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
        { provide: DataCaptureService, useValue: {} },
        { provide: IntegrationSettingsService, useValue: {} },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    leadRepository = module.get<LeadRepository>(LeadRepository);
  });

  it('1. ValidationPipe accepts pincode in UpdateLeadDto without "property pincode should not exist" error', async () => {
    const payload = {
      address: '123 Business Park, Alkapuri',
      city: 'Vadodara',
      state: 'Gujarat',
      pincode: '390007',
      workNotes: 'Updated business notes',
    };

    const transformed = await validationPipe.transform(payload, {
      type: 'body',
      metatype: UpdateLeadDto,
    });

    expect(transformed.pincode).toBe('390007');
    expect(transformed.city).toBe('Vadodara');
    expect(transformed.state).toBe('Gujarat');
    expect(transformed.address).toBe('123 Business Park, Alkapuri');
  });

  it('2. ValidationPipe accepts postalCode alias and leadService maps to pincode', async () => {
    const customerId = 1;
    const leadId = 83;

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      customerId,
      title: 'Vadodara Retailers',
      companyName: 'Vadodara Retailers',
      status: 'NEW',
    });
    mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });

    const payload = {
      address: 'Indiranagar 100ft Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560038',
    };

    const transformed = await validationPipe.transform(payload, {
      type: 'body',
      metatype: UpdateLeadDto,
    });

    expect(transformed.postalCode).toBe('560038');

    await leadService.updateLead(customerId, leadId, transformed);

    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: leadId, customerId, deletedAt: null },
      data: expect.objectContaining({
        pincode: '560038',
      }),
    });
  });

  it('3. ValidationPipe accepts zipCode alias and leadService maps to pincode', async () => {
    const customerId = 1;
    const leadId = 83;

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      customerId,
      title: 'Mumbai Mart',
      status: 'NEW',
    });
    mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });

    const payload = {
      city: 'Mumbai',
      state: 'Maharashtra',
      zipCode: '400001',
    };

    const transformed = await validationPipe.transform(payload, {
      type: 'body',
      metatype: UpdateLeadDto,
    });

    expect(transformed.zipCode).toBe('400001');

    await leadService.updateLead(customerId, leadId, transformed);

    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: leadId, customerId, deletedAt: null },
      data: expect.objectContaining({
        pincode: '400001',
      }),
    });
  });

  it('4. updateLead saves pincode, address, city, state into database via updateMany', async () => {
    const customerId = 1;
    const leadId = 83;

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      customerId,
      title: 'Vadodara Retailers',
      companyName: 'Vadodara Retailers',
      address: 'Old Address',
      city: 'Old City',
      state: 'Old State',
      pincode: '000000',
      status: 'NEW',
      stage: { id: 1, name: 'New' },
      stageId: 1,
    });

    mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });

    const dto: UpdateLeadDto = {
      address: '77 Alkapuri Plaza',
      city: 'Vadodara',
      state: 'Gujarat',
      pincode: '390007',
      workNotes: 'New notes',
    };

    await leadService.updateLead(customerId, leadId, dto);

    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: leadId, customerId, deletedAt: null },
      data: expect.objectContaining({
        address: '77 Alkapuri Plaza',
        city: 'Vadodara',
        state: 'Gujarat',
        pincode: '390007',
        workNotes: 'New notes',
      }),
    });
  });

  it('5. updateLead allows clearing optional pincode with empty string or null', async () => {
    const customerId = 1;
    const leadId = 83;

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      customerId,
      title: 'Test Store',
      status: 'NEW',
      pincode: '390007',
    });

    mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });

    const dto: UpdateLeadDto = {
      pincode: '',
    };

    await leadService.updateLead(customerId, leadId, dto);

    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: leadId, customerId, deletedAt: null },
      data: expect.objectContaining({
        pincode: null,
      }),
    });
  });

  it('6. CreateLeadDto and UpdateLeadDto have consistent pincode contracts', async () => {
    const createPayload = {
      title: 'New Store Bangalore',
      address: 'Koramangala 5th Block',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560095',
    };

    const transformedCreate = await validationPipe.transform(createPayload, {
      type: 'body',
      metatype: CreateLeadDto,
    });

    expect(transformedCreate.pincode).toBe('560095');

    const updatePayload = {
      pincode: '560095',
    };

    const transformedUpdate = await validationPipe.transform(updatePayload, {
      type: 'body',
      metatype: UpdateLeadDto,
    });

    expect(transformedUpdate.pincode).toBe('560095');
  });
});
