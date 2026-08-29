import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { WorkStatus, WorkType } from '@prisma/client';
import { CustomerGuard } from '../../common/guards/customer.guard';

describe('Customer Schedule & Calendar Data Isolation Tests', () => {
  let service: WorkService;
  let prisma: any;
  let planAccessService: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
      },
      work: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      workTask: {
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      planEntitlement: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerSubscription: {
        findFirst: jest.fn(),
      },
      attendancePolicy: {
        findFirst: jest.fn(),
      },
      notification: {
        create: jest.fn(),
      },
      subscriptionInstallment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback) => {
        if (typeof callback === 'function') {
          return callback(prisma);
        }
        return Promise.all(callback);
      }),
    };

    planAccessService = {
      getEffectivePlan: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanAccessService, useValue: planAccessService },
      ],
    }).compile();

    service = module.get<WorkService>(WorkService);
  });

  describe('1. Customer Schedule Isolation & Scoped Queries', () => {
    it('Customer A (ID: 1) calendar query strictly filters by customerId: 1', async () => {
      prisma.work.count.mockResolvedValue(5);
      prisma.work.findMany.mockResolvedValue([
        {
          id: 101,
          customerId: 1,
          title: 'Customer A Reel Shoot',
          scheduledDate: new Date('2026-08-26T10:00:00Z'),
          scheduledTime: '10:00 AM',
          workType: WorkType.REELS_SHOOT,
          status: WorkStatus.SCHEDULED,
          customer: { name: 'Customer A Org' },
        },
      ]);
      prisma.customerSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getCalendar(1, { date: '2026-08-26' });
      expect(result).toHaveLength(1);
      expect(result[0].customerId).toBe('1');
      expect(result[0].title).toBe('Customer A Reel Shoot');
      expect(prisma.work.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 1 }),
        }),
      );
    });

    it('Customer B (ID: 2) calendar query strictly filters by customerId: 2', async () => {
      prisma.work.count.mockResolvedValue(3);
      prisma.work.findMany.mockResolvedValue([
        {
          id: 202,
          customerId: 2,
          title: 'Customer B Story Design',
          scheduledDate: new Date('2026-08-26T12:00:00Z'),
          scheduledTime: '12:00 PM',
          workType: WorkType.STORY_DESIGN,
          status: WorkStatus.SCHEDULED,
          customer: { name: 'Customer B Gym' },
        },
      ]);
      prisma.customerSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getCalendar(2, { date: '2026-08-26' });
      expect(result).toHaveLength(1);
      expect(result[0].customerId).toBe('2');
      expect(result[0].title).toBe('Customer B Story Design');
      expect(prisma.work.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 2 }),
        }),
      );
    });

    it('Correctly returns and filters schedules across distinct dates (2026-08-25, 2026-08-26, 2026-08-27)', async () => {
      const aug26Event = {
        id: 301,
        customerId: 1,
        title: 'Reel Shoot Aug 26',
        scheduledDate: new Date('2026-08-26T10:00:00.000Z'),
        scheduledTime: '10:00 AM',
        workType: WorkType.REELS_SHOOT,
        status: WorkStatus.SCHEDULED,
        customer: { name: 'Customer A' },
      };

      prisma.work.count.mockResolvedValue(1);
      prisma.work.findMany.mockResolvedValue([aug26Event]);
      prisma.customerSubscription.findFirst.mockResolvedValue(null);

      const result26 = await service.getCalendar(1, { date: '2026-08-26' });
      expect(result26).toHaveLength(1);
      expect(result26[0].title).toBe('Reel Shoot Aug 26');

      prisma.work.findMany.mockResolvedValue([]);
      const result27 = await service.getCalendar(1, { date: '2026-08-27' });
      expect(result27).toHaveLength(0);
    });
  });

  describe('2. Security / IDOR Protection', () => {
    it('Customer A (ID: 1) cannot access Customer B schedule (ID: 202) -> throws NotFoundException', async () => {
      prisma.work.findFirst.mockResolvedValue(null); // Not found for customerId: 1

      await expect(service.findOne(1, 202)).rejects.toThrow(NotFoundException);
      expect(prisma.work.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 202, customerId: 1 }),
        }),
      );
    });
  });

  describe('3. Plan Quota & Date Validation', () => {
    it('blocks schedule creation when service quota is exhausted (remaining <= 0)', async () => {
      planAccessService.getEffectivePlan.mockResolvedValue({
        isActive: true,
        isExpired: false,
        planId: 1,
        planCode: 'BASIC',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
      });

      prisma.attendancePolicy.findFirst.mockResolvedValue({ workingDaysPerWeek: 6 });
      prisma.planEntitlement.findFirst.mockResolvedValue({
        id: 10,
        customerId: 1,
        serviceName: 'Reels',
        totalQty: 4,
        usedQty: 2,
        scheduledQty: 2, // 4 - (2 + 2) = 0 remaining
      });

      await expect(
        service.create(1, {
          title: 'New Reel',
          scheduledDate: '2026-08-25',
          workType: WorkType.REELS_SHOOT,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks schedule creation when plan is expired or inactive', async () => {
      planAccessService.getEffectivePlan.mockResolvedValue({
        isActive: false,
        isExpired: true,
        planId: 1,
      });

      await expect(
        service.create(1, {
          title: 'New Reel',
          scheduledDate: '2026-08-25',
          workType: WorkType.REELS_SHOOT,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('5. CustomerGuard Parameter Protection & DB Resolution', () => {
    it('rejects cross-customer query parameter with ForbiddenException', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Cust 1' }) // auth user check
        .mockResolvedValueOnce({ id: 2, name: 'Cust 2' }); // query check
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { customerId: 1 },
            query: { customerId: '2' },
            headers: {},
          }),
        }),
      };
      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('rejects cross-customer header (x-customer-id: CUST-900829843) with ForbiddenException when pointing to another tenant', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Cust 1' }) // auth user check
        .mockResolvedValueOnce(null); // header lookup
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { customerId: 1 },
            query: {},
            headers: { 'x-customer-id': 'CUST-900829843' },
          }),
        }),
      };
      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('allows matching customer and scopes request.customerId to user.customerId DB primary key integer', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Cust 1' }) // auth customer
        .mockResolvedValueOnce({ id: 1, name: 'Cust 1' }); // header customer
      const req: any = {
        user: { customerId: 1 },
        query: { customerId: '1' },
        headers: { 'x-customer-id': 'CUST-1' },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };
      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.customerId).toBe(1);
    });

    it('allows QB-CUST-011 for authenticated customer 11 and sets request.customerId to 11', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 11, name: 'Care Fitness Gym' }) // auth customer check
        .mockResolvedValueOnce({ id: 11, name: 'Care Fitness Gym' }); // query lookup for QB-CUST-011
      const req: any = {
        user: { customerId: 11 },
        query: { customerId: 'QB-CUST-011', date: '2026-08-29' },
        headers: { 'x-customer-id': 'QB-CUST-011' },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };
      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.customerId).toBe(11);
    });

    it('rejects QB-CUST-012 for authenticated customer 11 with ForbiddenException (403)', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 11, name: 'Care Fitness Gym' }) // auth customer
        .mockResolvedValueOnce({ id: 12, name: 'Other Customer' }); // query lookup for QB-CUST-012
      const req: any = {
        user: { customerId: 11 },
        query: { customerId: 'QB-CUST-012', date: '2026-08-29' },
        headers: {},
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };
      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('automatically uses authenticated customer ID when no customerId is passed in request', async () => {
      const guard = new CustomerGuard(prisma);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 11, name: 'Care Fitness Gym' });
      const req: any = {
        user: { customerId: 11 },
        query: { date: '2026-08-29' },
        headers: {},
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };
      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.customerId).toBe(11);
    });
  });
});
