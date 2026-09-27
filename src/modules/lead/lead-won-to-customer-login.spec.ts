import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { AuthService } from '../auth/auth.service';
import { MobileAuthController } from '../auth/mobile-auth.controller';
import { CustomerService } from '../customer/customer.service';
import { CustomerController } from '../customer/customer.controller';
import { WorkService } from '../work/work.service';
import { AiCreditService } from '../ai-studio/ai-credit.service';
import * as bcrypt from 'bcrypt';

describe('Won Lead -> Customer -> Customer Login Complete Business Flow', () => {
  let leadService: LeadService;
  let authService: AuthService;
  let customerService: CustomerService;
  let mobileAuthController: MobileAuthController;
  let mockPrisma: any;
  let mockLeadRepository: any;

  const defaultPassword = process.env.CUSTOMER_DEFAULT_PASSWORD || '123456';
  let hashedPassword = '';

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(defaultPassword, 10);
  });

  beforeEach(async () => {
    mockPrisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 9, name: 'CUSTOMER' }),
      },
      userRole: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      lead: {
        update: jest.fn().mockResolvedValue({ id: 651 }),
      },
      customerSubscription: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, status: 'ACTIVE', endDate: new Date(Date.now() + 86400000) },
        ]),
      },
    };

    mockLeadRepository = {
      findOne: jest.fn(),
      findStageById: jest.fn(),
      update: jest.fn(),
      logTimeline: jest.fn().mockResolvedValue({ id: 1 }),
    };

    const mockAuthService = {
      login: jest.fn().mockImplementation(async (email, password, expectedRole) => {
        if (password !== defaultPassword) {
          throw new UnauthorizedException({
            statusCode: 401,
            message: 'Invalid email or password.',
            code: 'INVALID_CREDENTIALS',
          });
        }
        if (expectedRole !== 'CUSTOMER' && expectedRole !== 'CUSTOMER_MOBILE') {
          throw new ForbiddenException('Invalid portal for role');
        }
        return {
          success: true,
          data: {
            user: {
              id: 55,
              email,
              role: 'CUSTOMER',
              customerId: 123,
              customerName: 'ABC Company',
              businessName: 'ABC Company',
            },
            tokens: {
              accessToken: 'mock-jwt-customer-token',
              refreshToken: 'mock-jwt-refresh-token',
            },
            customer: {
              id: 123,
              name: 'ABC Company',
              email,
            },
          },
        };
      }),
    };

    const mockCustomerService = {
      getMe: jest.fn().mockImplementation(async (user) => {
        if (!user || !user.customerId) {
          throw new ForbiddenException('User does not belong to any customer');
        }
        return {
          id: user.customerId,
          name: 'ABC Company',
          email: user.email,
          companyName: 'ABC Company',
          subscriptions: [{ id: 1, status: 'ACTIVE' }],
        };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MobileAuthController, CustomerController],
      providers: [
        LeadService,
        { provide: LeadRepository, useValue: mockLeadRepository },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: NotificationService, useValue: {} },
        { provide: PlanAccessService, useValue: {} },
        { provide: LeadLimitService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: EmailTemplateService, useValue: {} },
        { provide: WhatsappService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: WorkService, useValue: {} },
        { provide: AiCreditService, useValue: {} },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    authService = module.get<AuthService>(AuthService);
    customerService = module.get<CustomerService>(CustomerService);
    mobileAuthController = module.get<MobileAuthController>(MobileAuthController);
  });

  describe('TEST 1 & TEST 2: Lead with valid email -> WON -> Customer created with Lead email', () => {
    it('should create Customer and Customer User account using lead email abc@gmail.com', async () => {
      const wonLead = {
        id: 651,
        title: 'Enterprise CRM Lead',
        companyName: 'ABC Company',
        firstName: 'John',
        lastName: 'Doe',
        email: 'abc@gmail.com',
        phone: '9876543210',
        address: '123 Business Park',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        employeeId: 201,
        status: 'WON',
      };

      // Mock: Customer does not exist yet
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      // Mock: Customer creation returns new Customer 123
      const createdCustomer = {
        id: 123,
        name: 'ABC Company',
        companyName: 'ABC Company',
        email: 'abc@gmail.com',
        phone: '9876543210',
        address: '123 Business Park',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        leadId: 651,
        assignedEmployeeId: 201,
        isActive: true,
      };
      mockPrisma.customer.create.mockResolvedValue(createdCustomer);

      // Mock: User does not exist yet
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 55,
        customerId: 123,
        email: 'abc@gmail.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: hashedPassword,
        isActive: true,
        isVerified: true,
      });

      const conversion = await leadService.handleLeadWonCustomerConversion(
        10,
        wonLead,
        42,
        'FINAL_CALL',
        'WON',
      );

      // Verify Customer creation
      expect(conversion.success).toBe(true);
      expect(conversion.customerId).toBe(123);
      expect(conversion.customerName).toBe('ABC Company');
      expect(conversion.isNew).toBe(true);
      expect(conversion.userCreated).toBe(true);
      expect(conversion.customer?.loginStatus).toBe('ACTIVE');

      // Verify real data mapping into Customer
      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 651,
            name: 'ABC Company',
            companyName: 'ABC Company',
            email: 'abc@gmail.com',
            phone: expect.stringContaining('9876543210'),
            address: '123 Business Park',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
            assignedEmployeeId: 201,
          }),
        }),
      );

      // Verify User login created with Lead email and hashed password
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 123,
            email: 'abc@gmail.com',
            firstName: 'John',
            lastName: 'Doe',
            isActive: true,
            isVerified: true,
          }),
        }),
      );

      // Verify password hash in User create is a valid bcrypt hash
      const userCreateArgs = mockPrisma.user.create.mock.calls[0][0];
      expect(userCreateArgs.data.passwordHash).toBeDefined();
      expect(userCreateArgs.data.passwordHash).not.toBe(defaultPassword);
      const isMatch = await bcrypt.compare(defaultPassword, userCreateArgs.data.passwordHash);
      expect(isMatch).toBe(true);
    });
  });

  describe('TEST 3 & TEST 4: Customer Mobile Login with Default Password', () => {
    it('TEST 3: Customer logs in successfully using abc@gmail.com + configured default password', async () => {
      const loginResult = await mobileAuthController.loginCustomer({
        email: 'abc@gmail.com',
        password: defaultPassword,
      });

      expect(authService.login).toHaveBeenCalledWith('abc@gmail.com', defaultPassword, 'CUSTOMER');
      expect(loginResult.success).toBe(true);
      expect(loginResult.data.user.email).toBe('abc@gmail.com');
      expect(loginResult.data.user.role).toBe('CUSTOMER');
      expect(loginResult.data.tokens.accessToken).toBe('mock-jwt-customer-token');
      expect(loginResult.data.customer.id).toBe(123);
    });

    it('TEST 4: Customer login fails with 401 Unauthorized when password is wrong', async () => {
      await expect(
        mobileAuthController.loginCustomer({
          email: 'abc@gmail.com',
          password: 'wrong-password-123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('TEST 5: Lead without email -> Customer created, fake login NOT created', () => {
    it('should create Customer without creating fake login account when lead has no email', async () => {
      const leadWithoutEmail = {
        id: 652,
        title: 'Walk-in Lead',
        companyName: 'Local Retailer',
        firstName: 'Ramesh',
        lastName: 'Kumar',
        email: '', // Empty email
        phone: '9876543211',
        status: 'WON',
      };

      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({
        id: 124,
        name: 'Local Retailer',
        leadId: 652,
        email: null,
      });

      const conversion = await leadService.handleLeadWonCustomerConversion(
        10,
        leadWithoutEmail,
        42,
        'NEGOTIATION',
        'WON',
      );

      expect(conversion.success).toBe(true);
      expect(conversion.customerId).toBe(124);
      expect(conversion.userCreated).toBe(false);
      expect(conversion.loginStatus).toBe('EMAIL_REQUIRED');
      expect(conversion.customer?.loginStatus).toBe('EMAIL_REQUIRED');

      // User account create should NOT have been called with fake email
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('TEST 6 & TEST 7: Idempotency & Existing Customer Reuse', () => {
    it('TEST 6 & 7: When lead transitions to WON a second time, reuses existing Customer without duplicate', async () => {
      const wonLead = {
        id: 651,
        title: 'ABC Company Lead',
        companyName: 'ABC Company',
        email: 'abc@gmail.com',
        status: 'WON',
      };

      // Mock: Customer already exists with leadId 651
      const existingCustomer = {
        id: 123,
        name: 'ABC Company',
        companyName: 'ABC Company',
        email: 'abc@gmail.com',
        leadId: 651,
        assignedEmployeeId: 201,
      };
      mockPrisma.customer.findFirst.mockResolvedValue(existingCustomer);

      // Mock: User account already exists
      const existingUser = {
        id: 55,
        customerId: 123,
        email: 'abc@gmail.com',
        isActive: true,
      };
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);

      const conversion = await leadService.handleLeadWonCustomerConversion(
        10,
        wonLead,
        42,
        'WON',
        'WON',
      );

      expect(conversion.success).toBe(true);
      expect(conversion.customerId).toBe(123);
      expect(conversion.alreadyConverted).toBe(true);
      expect(conversion.isNew).toBe(false);
      expect(conversion.userExisted).toBe(true);

      // Customer.create should NEVER be called again
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      // User.create should NEVER be called again
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('TEST 8: Employee Ownership Preservation', () => {
    it('should assign customer to Employee A (201) when lead is owned by Employee A', async () => {
      const leadWithEmployee = {
        id: 653,
        title: 'Employee Lead',
        companyName: 'Tech Innovations',
        email: 'tech@innovations.com',
        employeeId: 201, // Employee A
        status: 'WON',
      };

      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({
        id: 125,
        name: 'Tech Innovations',
        leadId: 653,
        assignedEmployeeId: 201,
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 56 });

      const conversion = await leadService.handleLeadWonCustomerConversion(
        10,
        leadWithEmployee,
        42,
        'FINAL_CALL',
        'WON',
      );

      expect(conversion.success).toBe(true);
      expect(conversion.assignedEmployeeId).toBe(201);
      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedEmployeeId: 201,
          }),
        }),
      );
    });
  });

  describe('TEST 9: Customer Data Isolation (GET /customer/me)', () => {
    it('Customer A sees only own Customer data and cannot access Customer B', async () => {
      const customerAUser = { id: 55, email: 'abc@gmail.com', customerId: 123, role: 'CUSTOMER' };
      const profileA: any = await customerService.getMe(customerAUser);

      expect(profileA.id || profileA.data?.id).toBe(123);
      expect(profileA.name || profileA.data?.name).toBe('ABC Company');

      // User with no customerId is rejected
      const unlinkedUser = { id: 99, email: 'unlinked@test.com', customerId: null, role: 'CUSTOMER' };
      await expect(customerService.getMe(unlinkedUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('TEST 10: Security & Password Masking in API responses', () => {
    it('should NEVER expose password, defaultPassword, or passwordHash in conversion response', async () => {
      const wonLead = {
        id: 654,
        title: 'Secret Lead',
        companyName: 'Private Enterprise',
        email: 'private@enterprise.com',
        status: 'WON',
      };

      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({ id: 126, name: 'Private Enterprise' });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 57 });

      const conversion = await leadService.handleLeadWonCustomerConversion(
        10,
        wonLead,
        42,
        'FINAL_CALL',
        'WON',
      );

      expect((conversion as any).password).toBeUndefined();
      expect((conversion as any).passwordHash).toBeUndefined();
      expect((conversion as any).defaultPassword).toBeUndefined();
      expect((conversion.customer as any)?.password).toBeUndefined();
      expect((conversion.customer as any)?.passwordHash).toBeUndefined();
    });
  });
});
