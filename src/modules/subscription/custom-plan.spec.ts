import { Test, TestingModule } from '@nestjs/testing';
import { CustomPlanService } from './custom-plan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';

describe('Custom Plan Service & Calculation Tests', () => {
  let customPlanService: CustomPlanService;
  let prisma: any;
  let scheduleService: any;
  let workService: any;

  const mockDbOptions = [
    {
      id: 1,
      name: 'Social Media Reels',
      code: 'OPT_REELS',
      category: 'CONTENT',
      monthlyPrice: 1000,
      pricingType: 'PER_UNIT',
      unitName: 'Reel',
      minQuantity: 0,
      maxQuantity: 50,
      defaultQuantity: 4,
      isIncludedInStandard: true,
      isActive: true,
      deletedAt: null,
    },
    {
      id: 2,
      name: 'Creative Graphic Posts',
      code: 'OPT_CREATIVES',
      category: 'CREATIVES',
      monthlyPrice: 600,
      pricingType: 'PER_UNIT',
      unitName: 'Post',
      minQuantity: 0,
      maxQuantity: 50,
      defaultQuantity: 3,
      isIncludedInStandard: true,
      isActive: true,
      deletedAt: null,
    },
    {
      id: 3,
      name: 'Daily Story Updates',
      code: 'OPT_STORIES',
      category: 'CREATIVES',
      monthlyPrice: 150,
      pricingType: 'PER_UNIT',
      unitName: 'Story',
      minQuantity: 0,
      maxQuantity: 60,
      defaultQuantity: 5,
      isIncludedInStandard: true,
      isActive: true,
      deletedAt: null,
    },
    {
      id: 4,
      name: 'Influencer Collaborations',
      code: 'OPT_INFLUENCER',
      category: 'CONTENT',
      monthlyPrice: 2500,
      pricingType: 'PER_UNIT',
      unitName: 'Promotion',
      minQuantity: 0,
      maxQuantity: 20,
      defaultQuantity: 1,
      isIncludedInStandard: false,
      isActive: true,
      deletedAt: null,
    },
    {
      id: 5,
      name: 'Product Reels',
      code: 'OPT_PRODUCT_REELS',
      category: 'CONTENT',
      monthlyPrice: 2000,
      pricingType: 'PER_UNIT',
      unitName: 'Reel',
      minQuantity: 0,
      maxQuantity: 30,
      defaultQuantity: 2,
      isIncludedInStandard: false,
      isActive: true,
      deletedAt: null,
    },
  ];

  beforeEach(async () => {
    prisma = {
      customPlanOption: {
        findMany: jest.fn().mockResolvedValue(mockDbOptions),
        findFirst: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 1, code: 'OPT_REELS' }),
      },
      customPlanOrder: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 101, name: 'Enterprise Workspace', email: 'client@quikboom.com' }),
        update: jest.fn(),
      },
      plan: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, code: 'CUSTOM', name: 'Custom Plan' }),
      },
      customerSubscription: {
        create: jest.fn().mockResolvedValue({ id: 201, customerId: 101, status: 'ACTIVE' }),
        updateMany: jest.fn(),
      },
      paymentHistory: {
        create: jest.fn().mockResolvedValue({ id: 88, createdAt: new Date() }),
        update: jest.fn(),
      },
      contact: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      planEntitlement: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    scheduleService = {
      generateSchedulesForSubscription: jest.fn(),
    };

    workService = {
      generatePlanSchedules: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomPlanService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleService, useValue: scheduleService },
        { provide: WorkService, useValue: workService },
        {
          provide: IntegrationSettingsService,
          useValue: {
            getRazorpayConfig: jest.fn().mockResolvedValue({
              keyId: 'rzp_test_123',
              keySecret: 'secret_123',
              environment: 'TEST',
              isEnabled: true,
              source: 'DATABASE',
            }),
          },
        },
      ],
    }).compile();

    customPlanService = module.get<CustomPlanService>(CustomPlanService);
  });

  describe('1. Price Preview & Duration Calculations', () => {
    it('calculates 1-month custom plan price breakdown with 18% GST', async () => {
      const selections = [
        { optionId: 1, quantity: 4 }, // 4 * 1000 = 4000
        { optionId: 2, quantity: 3 }, // 3 * 600 = 1800
        { optionId: 3, quantity: 5 }, // 5 * 150 = 750
        { optionId: 4, quantity: 1 }, // 1 * 2500 = 2500
      ];
      // Total monthly subtotal = 4000 + 1800 + 750 + 2500 = 9050
      // 1 month -> 0% discount
      // Taxable = 9050
      // Tax (18%) = 1629
      // Total = 10679

      const quote = await customPlanService.calculateCustomPlanPrice(selections, 1);
      expect(quote.duration).toBe(1);
      expect(quote.monthlySubtotal).toBe(9050);
      expect(quote.subtotal).toBe(9050);
      expect(quote.discount).toBe(0);
      expect(quote.taxableAmount).toBe(9050);
      expect(quote.tax).toBe(1629);
      expect(quote.totalAmount).toBe(10679);
    });

    it('applies 20% discount for 12-month (Yearly) duration', async () => {
      const selections = [
        { optionId: 1, quantity: 4 }, // 4000/mo
      ];
      // 12 months subtotal = 4000 * 12 = 48000
      // Discount (20%) = 9600
      // Taxable = 38400
      // Tax (18%) = 6912
      // Total = 45312

      const quote = await customPlanService.calculateCustomPlanPrice(selections, 12);
      expect(quote.duration).toBe(12);
      expect(quote.discountPercentage).toBe(20);
      expect(quote.subtotal).toBe(48000);
      expect(quote.discount).toBe(9600);
      expect(quote.taxableAmount).toBe(38400);
      expect(quote.tax).toBe(6912);
      expect(quote.totalAmount).toBe(45312);
    });

    it('throws BadRequestException (400) when selections array is empty', async () => {
      await expect(customPlanService.calculateCustomPlanPrice([], 1)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException (400) when option ID does not exist in DB', async () => {
      await expect(
        customPlanService.calculateCustomPlanPrice([{ optionId: 999, quantity: 2 }], 1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Custom Plan Order Creation', () => {
    it('creates custom plan order with proper Razorpay config', async () => {
      prisma.customPlanOrder.create.mockResolvedValue({
        id: 501,
        orderNumber: '#QB-CP-TEST-1234',
        customerId: 101,
        totalAmount: 10679,
        subtotal: 9050,
        tax: 1629,
        status: 'PENDING_PAYMENT',
      });

      const res = await customPlanService.createCustomPlanOrder(101, {
        featureSelections: [{ optionId: 1, quantity: 4 }],
        duration: 1,
        paymentMethod: 'RAZORPAY',
      });

      expect(res.success).toBe(true);
      expect(res.order.id).toBe(501);
      expect(res.order.paymentGatewayConfig.gateway).toBe('RAZORPAY');
    });

    it('throws NotFoundException when customer record does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        customPlanService.createCustomPlanOrder(999, {
          featureSelections: [{ optionId: 1, quantity: 4 }],
          duration: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('3. Payment Verification & Schedule Generation', () => {
    it('activates subscription and provisions entitlements upon payment verification', async () => {
      prisma.customPlanOrder.findFirst.mockResolvedValue({
        id: 501,
        customerId: 101,
        duration: 1,
        subtotal: 9050,
        discount: 0,
        tax: 1629,
        totalAmount: 10679,
        status: 'PENDING_PAYMENT',
        paymentMethod: PaymentMethod.RAZORPAY,
        orderNumber: '#QB-CP-TEST-1234',
        selectedFeatures: [
          { name: 'Reels', quantity: 4, unitPrice: 1000 },
          { name: 'Creative Posts', quantity: 3, unitPrice: 600 },
        ],
      });

      prisma.customPlanOrder.update.mockResolvedValue({
        id: 501,
        status: 'ACTIVATED',
      });

      const res = await customPlanService.verifyAndActivateCustomPlan(101, 501, {
        paymentId: 'pay_test_123',
        signature: 'test_sig',
      });

      expect(res.success).toBe(true);
      expect(workService.generatePlanSchedules).toHaveBeenCalledWith(101, 201);
      expect(prisma.customPlanOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 501,
            customerId: 101,
            deletedAt: null,
          }),
        }),
      );
    });

    it('returns 400 without querying Prisma when order id is null/"null"/Razorpay id', async () => {
      prisma.customPlanOrder.findFirst.mockClear();
      await expect(
        customPlanService.verifyAndActivateCustomPlan(101, 'null', {
          paymentId: 'pay_test_123',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        customPlanService.verifyAndActivateCustomPlan(101, 'order_ABC', {
          paymentId: 'pay_test_123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customPlanOrder.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('4. Option Retrieval & Seeding Resilience (Preventing 500 Unique Constraint Error)', () => {
    it('returns existing options without re-seeding when active options exist', async () => {
      prisma.customPlanOption.findMany.mockResolvedValueOnce(mockDbOptions);

      const options = await customPlanService.getAvailableOptions();
      expect(options.length).toBe(mockDbOptions.length);
      expect(prisma.customPlanOption.upsert).not.toHaveBeenCalled();
    });

    it('uses upsert (not create) to restore options without unique constraint 500 crash when 0 active options exist', async () => {
      // First findMany returns empty array, triggering fallback seeding
      prisma.customPlanOption.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockDbOptions);

      const options = await customPlanService.getAvailableOptions();
      expect(prisma.customPlanOption.upsert).toHaveBeenCalled();
      expect(prisma.customPlanOption.create).not.toHaveBeenCalled();
      expect(options.length).toBe(mockDbOptions.length);
    });
  });
});
