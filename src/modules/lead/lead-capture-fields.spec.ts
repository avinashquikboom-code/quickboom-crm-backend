import { Test, TestingModule } from '@nestjs/testing';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DataCaptureService } from '../data-capture/data-capture.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { CreateLeadDto } from './dto/lead.dto';
import { CreateDataCaptureDto } from '../data-capture/dto/data-capture.dto';

describe('Lead Capture Field Mapping Tests (End-to-End)', () => {
  let leadService: LeadService;
  let leadRepository: LeadRepository;
  let prisma: PrismaService;
  let dataCaptureService: DataCaptureService;

  const mockPrisma: any = {
    $transaction: jest.fn(async (cb) => cb(mockPrisma)),
    lead: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    contact: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    emailTemplate: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    whatsappTemplate: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    emailLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    leadNote: {
      create: jest.fn().mockResolvedValue({}),
    },
    leadActivityTimeline: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    leadStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    leadStage: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    dataCapturePlace: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        LeadRepository,
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: { sendMail: jest.fn().mockResolvedValue({ success: true }), sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: IntegrationSettingsService,
          useValue: {
            getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false }),
          },
        },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    leadRepository = module.get<LeadRepository>(LeadRepository);
    prisma = module.get<PrismaService>(PrismaService);
    dataCaptureService = module.get<DataCaptureService>(DataCaptureService);
  });

  describe('1. Create Lead with firstName, lastName, mobile, email', () => {
    it('should correctly map standard fields into Lead model and database', async () => {
      mockPrisma.lead.create.mockResolvedValue({
        id: 101,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        status: 'NEW',
      });
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 101,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const dto: CreateLeadDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: '  john@example.com  ',
        mobile: '+91 9876543210',
      } as any;

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, dto);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            phone: '+91 9876543210',
            email: 'john@example.com',
          }),
        }),
      );
      expect(result.id).toBe(101);
    });
  });

  describe('2. Create Lead with first_name, last_name, phoneNumber, emailAddress', () => {
    it('should resolve snake_case and alternate field names to canonical Lead fields', async () => {
      mockPrisma.lead.create.mockResolvedValue({
        id: 102,
        title: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+14155552671',
        email: 'jane@example.com',
      });
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 102,
        title: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+14155552671',
        email: 'jane@example.com',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const dto = {
        first_name: 'Jane',
        last_name: 'Smith',
        phoneNumber: '+1 415 555 2671',
        emailAddress: 'jane@example.com',
      } as any;

      await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, dto);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'Jane',
            lastName: 'Smith',
            phone: '+1 415 555 2671',
            email: 'jane@example.com',
          }),
        }),
      );
    });
  });

  describe('3. Create Lead with single name field ("John Doe")', () => {
    it('should split name into firstName and lastName when discrete fields are missing', async () => {
      mockPrisma.lead.create.mockResolvedValue({
        id: 103,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919999999999',
        email: 'johndoe@test.com',
      });
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 103,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919999999999',
        email: 'johndoe@test.com',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const dto = {
        name: 'John Doe',
        contactNumber: '+919999999999',
        email: 'johndoe@test.com',
      } as any;

      await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, dto);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            phone: '+919999999999',
            email: 'johndoe@test.com',
          }),
        }),
      );
    });
  });

  describe('4. Data Capture Flow: createPlace -> createLeadFromPlace', () => {
    it('should persist contact person details in rawData and map to Lead on conversion', async () => {
      mockPrisma.dataCapturePlace.create.mockResolvedValue({
        id: 50,
        businessName: 'Apex Innovations',
        phone: '+919876543210',
        email: 'contact@apex.com',
        rawData: {
          firstName: 'Rahul',
          lastName: 'Sharma',
          mobile: '+919876543210',
          email: 'contact@apex.com',
        },
      });

      const captureDto: CreateDataCaptureDto = {
        businessName: 'Apex Innovations',
        firstName: 'Rahul',
        lastName: 'Sharma',
        mobile: '+919876543210',
        email: 'contact@apex.com',
      } as any;

      await dataCaptureService.createPlace(1, 1, captureDto);

      expect(mockPrisma.dataCapturePlace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessName: 'Apex Innovations',
            phone: '+919876543210',
            email: 'contact@apex.com',
            rawData: expect.objectContaining({
              firstName: 'Rahul',
              lastName: 'Sharma',
              mobile: '+919876543210',
              email: 'contact@apex.com',
            }),
          }),
        }),
      );

      // Now convert place to lead
      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue({
        id: 50,
        customerId: 1,
        businessName: 'Apex Innovations',
        phone: '+919876543210',
        email: 'contact@apex.com',
        rawData: {
          firstName: 'Rahul',
          lastName: 'Sharma',
          mobile: '+919876543210',
          email: 'contact@apex.com',
        },
      });
      mockPrisma.lead.create.mockResolvedValue({
        id: 201,
        firstName: 'Rahul',
        lastName: 'Sharma',
        phone: '+919876543210',
        email: 'contact@apex.com',
      });
      mockPrisma.dataCapturePlace.update.mockResolvedValue({
        id: 50,
        status: 'LEAD_CREATED',
        isImported: true,
      });

      const conversionResult = await dataCaptureService.createLeadFromPlace(1, 1, 50);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'Rahul',
            lastName: 'Sharma',
            phone: '+919876543210',
            email: 'contact@apex.com',
            companyName: 'Apex Innovations',
          }),
        }),
      );
      expect(conversionResult.lead.id).toBe(201);
    });
  });

  describe('5. Update Lead should not overwrite non-empty fields with blank/null', () => {
    it('should ignore empty strings and nulls during partial update', async () => {
      mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });

      await leadRepository.update(1, 101, {
        firstName: '',
        lastName: undefined,
        phone: '',
        email: 'updated@example.com',
      } as any);

      const updateCallArg = mockPrisma.lead.updateMany.mock.calls[0][0];
      // firstName and phone were empty strings, so they should be omitted, preserving existing values
      expect(updateCallArg.data.firstName).toBeUndefined();
      expect(updateCallArg.data.phone).toBeUndefined();
      expect(updateCallArg.data.email).toBe('updated@example.com');
    });
  });

  describe('6. Google Discovery Lead Ads webhook mapping (user_column_data array)', () => {
    it('should map user_column_data fields to firstName, lastName, phone, and email', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null); // No existing lead
      mockPrisma.lead.create.mockResolvedValue({
        id: 301,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
      });
      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 301,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const googlePayload = {
        source: 'Google Discovery',
        user_column_data: [
          { column_id: 'FIRST_NAME', string_value: 'John' },
          { column_id: 'LAST_NAME', string_value: 'Doe' },
          { column_id: 'EMAIL', string_value: 'john@example.com' },
          { column_id: 'PHONE_NUMBER', string_value: '+919876543210' },
          { column_id: 'COMPANY_NAME', string_value: 'Acme Corp' },
        ],
      };

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, googlePayload as any);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            phone: '+919876543210',
            companyName: 'Acme Corp',
            source: 'Google Discovery',
          }),
        }),
      );
      expect(result.id).toBe(301);
    });
  });

  describe('7. Google Discovery Lead with direct snake_case properties', () => {
    it('should extract first_name, last_name, phone_number, user_email', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null); // No existing lead
      mockPrisma.lead.create.mockResolvedValue({
        id: 302,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
      });
      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 302,
        title: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const googlePayload = {
        source: 'Google Discovery',
        first_name: 'John',
        last_name: 'Doe',
        user_email: 'john@example.com',
        phone_number: '+919876543210',
      };

      await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, googlePayload as any);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            phone: '+919876543210',
            source: 'Google Discovery',
          }),
        }),
      );
    });
  });

  describe('8. Google Discovery Create vs Update logic', () => {
    it('should update existing lead without clearing existing values when Google sends empty/missing fields', async () => {
      const existingLead = {
        id: 303,
        customerId: 1,
        title: 'Existing Lead',
        firstName: 'John',
        lastName: 'Doe',
        email: 'customer@example.com',
        phone: '+919876543210',
        status: 'NEW',
        source: 'Google Discovery',
      };

      // Mock finding the existing lead by phone
      mockPrisma.lead.findFirst.mockResolvedValue(existingLead);

      const updatePayload = {
        source: 'Google Discovery',
        phone: '+919876543210',
        // Note: email is missing in this update!
      };

      await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, updatePayload as any);

      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 303, customerId: 1 }),
        }),
      );
      // Existing email should not be cleared to null or empty string
      const updateData = mockPrisma.lead.updateMany.mock.calls[0][0].data;
      expect(updateData.email).toBeUndefined();
    });
  });

  describe('9. Google Discovery Lead with missing Email', () => {
    it('should create lead successfully without email and safely skip automatic email', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null); // No existing lead
      mockPrisma.lead.create.mockResolvedValue({
        id: 304,
        title: 'Phone Only',
        firstName: 'Phone',
        lastName: 'Only',
        phone: '+919876543210',
        email: null,
        source: 'Google Discovery',
        status: 'NEW',
      });
      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 304,
        title: 'Phone Only',
        firstName: 'Phone',
        lastName: 'Only',
        phone: '+919876543210',
        email: null,
        source: 'Google Discovery',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const payload = {
        source: 'Google Discovery',
        first_name: 'Phone',
        last_name: 'Only',
        phone: '+919876543210',
      };

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, payload as any);

      const lastCreateCall = mockPrisma.lead.create.mock.calls[mockPrisma.lead.create.mock.calls.length - 1][0];
      expect(lastCreateCall.data.firstName).toBe('Phone');
      expect(lastCreateCall.data.lastName).toBe('Only');
      expect(lastCreateCall.data.phone).toBe('+919876543210');
      expect(lastCreateCall.data.email).toBeUndefined();
      expect(result.id).toBe(304);
    });
  });

  describe('10. Google Discovery Lead with missing Mobile', () => {
    it('should create lead successfully without mobile and safely skip WhatsApp', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null); // No existing lead
      mockPrisma.lead.create.mockResolvedValue({
        id: 305,
        title: 'Email Only',
        firstName: 'Email',
        lastName: 'Only',
        phone: null,
        email: 'emailonly@example.com',
        source: 'Google Discovery',
        status: 'NEW',
      });
      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 305,
        title: 'Email Only',
        firstName: 'Email',
        lastName: 'Only',
        phone: null,
        email: 'emailonly@example.com',
        source: 'Google Discovery',
        status: 'NEW',
        stage: { name: 'New' },
      });

      const payload = {
        source: 'Google Discovery',
        first_name: 'Email',
        last_name: 'Only',
        email: 'emailonly@example.com',
      };

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, payload as any);

      const lastCreateCall = mockPrisma.lead.create.mock.calls[mockPrisma.lead.create.mock.calls.length - 1][0];
      expect(lastCreateCall.data.firstName).toBe('Email');
      expect(lastCreateCall.data.lastName).toBe('Only');
      expect(lastCreateCall.data.email).toBe('emailonly@example.com');
      expect(lastCreateCall.data.phone).toBeUndefined();
      expect(result.id).toBe(305);
    });
  });

  describe('11. Force stage NEW for new Google Discovery Leads even with payload lead_stage', () => {
    it('should force stage New and status NEW for brand-new Google lead regardless of payload lead_stage', async () => {
      // Mock duplicate check returning null (brand-new lead)
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null);

      // Mock finding the customer's active NEW stage (e.g. id 16)
      mockPrisma.leadStage.findFirst.mockResolvedValueOnce({
        id: 16,
        customerId: 1,
        key: 'NEW',
        name: 'New',
        isActive: true,
      });

      mockPrisma.lead.create.mockResolvedValue({
        id: 306,
        title: 'New Google Lead',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
        stageId: 16,
      });

      mockPrisma.lead.findFirst.mockResolvedValueOnce({
        id: 306,
        title: 'New Google Lead',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        source: 'Google Discovery',
        status: 'NEW',
        stageId: 16,
        stage: { id: 16, name: 'New' },
      });

      const payload = {
        source: 'Google Discovery',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        lead_stage: 'Follow-up', // External lead_stage MUST BE IGNORED
        status: 'FOLLOW_UP',      // Must be overridden to NEW
      };

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, payload as any);

      const lastCreateCall = mockPrisma.lead.create.mock.calls[mockPrisma.lead.create.mock.calls.length - 1][0];
      expect(lastCreateCall.data.status).toBe('NEW');
      expect(lastCreateCall.data.stageId).toBe(16);
      expect(result.id).toBe(306);
    });
  });

  describe('12. Existing Google Discovery Lead retains current stage', () => {
    it('should preserve stage Negotiation when duplicate Google update arrives', async () => {
      const existingLead = {
        id: 307,
        customerId: 1,
        title: 'Existing Negotiation Lead',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        phone: '+919988776655',
        status: 'NEGOTIATION',
        stageId: 24,
        stage: { id: 24, name: 'Negotiation' },
        source: 'Google Discovery',
      };

      // Mock finding duplicate
      mockPrisma.lead.findFirst.mockResolvedValueOnce(existingLead);
      // Mock getLeadById returning updated lead with Negotiation stage intact
      mockPrisma.lead.findFirst.mockResolvedValueOnce(existingLead);

      const updatePayload = {
        source: 'Google Discovery',
        email: 'jane@example.com',
        phone: '+919988776655',
        company_name: 'Updated Company Name',
        lead_stage: 'Follow-up',
      };

      const result = await leadService.createLead(1, { id: 1, role: 'SUPER_ADMIN' }, updatePayload as any);

      // Verify update did NOT touch status or stageId
      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 307, customerId: 1 }),
        }),
      );
      const updateData = mockPrisma.lead.updateMany.mock.calls[mockPrisma.lead.updateMany.mock.calls.length - 1][0].data;
      expect(updateData.status).toBeUndefined();
      expect(updateData.stageId).toBeUndefined();
      expect(updateData.companyName).toBe('Updated Company Name');
      expect(result.status).toBe('NEGOTIATION');
      expect(result.stage?.name).toBe('Negotiation');
    });
  });
});

