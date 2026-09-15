import { Test, TestingModule } from '@nestjs/testing';
import { InfluencerService } from './influencer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('InfluencerService - Integrity and Isolation Tests', () => {
  let service: InfluencerService;
  let prisma: any;

  const mockPrismaService = {
    influencer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    influencerPackage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    influencerAvailability: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    influencerBooking: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    influencerBookingPayment: {
      create: jest.fn(),
    },
  };

  const mockIntegrationSettings = {
    getRazorpayConfig: jest.fn().mockResolvedValue({
      keyId: 'rzp_test_mockKey',
      keySecret: 'rzp_test_mockSecret',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfluencerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettings },
      ],
    }).compile();

    service = module.get<InfluencerService>(InfluencerService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('Customer Data Isolation', () => {
    it('getMyBookings queries ONLY records matching the authenticated customerId', async () => {
      prisma.influencerBooking.findMany.mockResolvedValue([
        { id: 1, customerId: 101, bookingId: 'QBINFLU-20260914-1001', bookingStatus: 'CONFIRMED' },
      ]);

      const result = await service.getMyBookings(101);

      expect(prisma.influencerBooking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101 }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('getBookingById rejects access when customer attempts to access another customer booking', async () => {
      prisma.influencerBooking.findFirst.mockResolvedValue(null);

      await expect(service.getBookingById(102, 'QBINFLU-20260914-1001', false)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.influencerBooking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 102 }),
        }),
      );
    });
  });

  describe('Authoritative Pricing & Double Booking Validation', () => {
    it('calculates packageAmount, platform fee, GST and total amount server-side', async () => {
      prisma.influencer.findFirst.mockResolvedValue({ id: 5, isActive: true, status: 'APPROVED' });
      prisma.influencerPackage.findFirst.mockResolvedValue({
        id: 12,
        influencerId: 5,
        price: 5000,
        status: 'ACTIVE',
      });
      prisma.influencerBooking.findFirst.mockResolvedValue(null); // No conflicting booking
      prisma.influencerBooking.create.mockImplementation(({ data }: any) => ({
        id: 99,
        ...data,
      }));

      const res = await service.createBooking(101, {
        influencerId: 5,
        packageId: 12,
        campaignDate: '2026-09-20',
        brandName: 'Test Brand',
        contactPerson: 'Rahul',
        mobileNumber: '9876543210',
        email: 'rahul@test.com',
        businessName: 'Test Agency',
      });

      expect(res.success).toBe(true);
      expect(res.booking.packageAmount).toBe(5000);
      expect(res.booking.platformFee).toBe(500);
      expect(res.booking.gst).toBe(900); // 18% of 5000
      expect(res.booking.totalAmount).toBe(6400); // 5000 + 500 + 900
      expect(res.booking.bookingId).toMatch(/^QBINFLU-/);
    });

    it('prevents double-booking if influencer already has a booking on the same date', async () => {
      prisma.influencer.findFirst.mockResolvedValue({ id: 5, isActive: true });
      prisma.influencerPackage.findFirst.mockResolvedValue({
        id: 12,
        influencerId: 5,
        price: 5000,
        status: 'ACTIVE',
      });
      // Existing confirmed booking found
      prisma.influencerBooking.findFirst.mockResolvedValue({
        id: 50,
        influencerId: 5,
        bookingStatus: 'CONFIRMED',
      });

      await expect(
        service.createBooking(101, {
          influencerId: 5,
          packageId: 12,
          campaignDate: '2026-09-20',
          brandName: 'Test Brand',
          contactPerson: 'Rahul',
          mobileNumber: '9876543210',
          email: 'rahul@test.com',
          businessName: 'Test Agency',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
