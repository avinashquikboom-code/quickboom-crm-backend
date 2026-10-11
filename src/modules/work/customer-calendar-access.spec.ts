import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { WorkController } from './work.controller';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { ForbiddenException } from '@nestjs/common';
import { WorkStatus, SubscriptionStatus } from '@prisma/client';
import { WorkPermissionService } from './work-permission.service';

describe('Customer Calendar Access & Cross-Customer Authorization Verification', () => {
  let controller: WorkController;
  let service: WorkService;
  let guard: CustomerGuard;
  let prisma: any;
  let planAccessService: any;
  let workPermissionService: any;

  const dummyHandler = () => {};
  const dummyClass = class Dummy {};

  const createMockContext = (req: any): any => ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => dummyHandler,
    getClass: () => dummyClass,
  });

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
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
      },
      customerSubscription: {
        findFirst: jest.fn(),
      },
      attendancePolicy: {
        findFirst: jest.fn(),
      },
      subscriptionInstallment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb))),
    };

    planAccessService = {
      getEffectivePlan: jest.fn(),
    };

    workPermissionService = {
      hasPermission: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkController],
      providers: [
        WorkService,
        CustomerGuard,
        { provide: WorkPermissionService, useValue: workPermissionService },
        { provide: PrismaService, useValue: prisma },
        { provide: PlanAccessService, useValue: planAccessService },
      ],
    }).compile();

    controller = module.get<WorkController>(WorkController);
    service = module.get<WorkService>(WorkService);
    guard = module.get<CustomerGuard>(CustomerGuard);
  });

  describe('1. Customer A can retrieve Customer A calendar', () => {
    it('Customer A (ID: 1) accesses own calendar with explicit customerId=1', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true }) // auth customer
        .mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true }); // query customer

      const req: any = {
        user: { id: 10, email: 'custA@test.com', customerId: 1, role: 'CUSTOMER' },
        query: { customerId: '1', date: '2026-10-11', dateFrom: '2026-10-11', dateTo: '2026-10-11' },
        headers: {},
      };
      const context = createMockContext(req);

      const canActivate = await guard.canActivate(context);
      expect(canActivate).toBe(true);
      expect(req.customerId).toBe(1);

      prisma.work.count.mockResolvedValue(1);
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Growth Plan' },
      });
      prisma.work.findMany.mockResolvedValue([
        {
          id: 501,
          customerId: 1,
          title: 'Customer A Shoot',
          scheduledDate: new Date('2026-10-11T10:00:00.000Z'),
          status: WorkStatus.SCHEDULED,
          customer: { id: 1, name: 'Customer A Org' },
        },
      ]);

      const calendar = await controller.getCalendar(
        String(req.customerId),
        req,
        undefined,
        '2026-10-11',
        undefined,
        undefined,
        '2026-10-11',
        '2026-10-11',
      );

      expect(calendar).toHaveLength(1);
      expect(calendar[0].customerId).toBe('1');
      expect(calendar[0].title).toBe('Customer A Shoot');
    });
  });

  describe('2. Customer A cannot retrieve Customer B calendar', () => {
    it('Customer A (ID: 1) querying customerId=2 is rejected with 403 Forbidden', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true }) // auth customer
        .mockResolvedValueOnce({ id: 2, name: 'Customer B Org', isActive: true }); // requested customer 2

      const req: any = {
        user: { id: 10, email: 'custA@test.com', customerId: 1, role: 'CUSTOMER' },
        query: { customerId: '2', date: '2026-10-11', dateFrom: '2026-10-11', dateTo: '2026-10-11' },
        headers: {},
      };
      const context = createMockContext(req);

      let caughtError: any;
      try {
        await guard.canActivate(context);
      } catch (err: any) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(ForbiddenException);
      expect(caughtError?.message).toBe('Cross-customer access forbidden');
      expect(caughtError?.getStatus()).toBe(403);
    });
  });

  describe('3. Authenticated request without customerId resolves from session', () => {
    it('Customer A without customerId query parameter retrieves own calendar', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true });

      const req: any = {
        user: { id: 10, email: 'custA@test.com', customerId: 1, role: 'CUSTOMER' },
        query: { date: '2026-10-11', dateFrom: '2026-10-11', dateTo: '2026-10-11' },
        headers: {},
      };
      const context = createMockContext(req);

      const canActivate = await guard.canActivate(context);
      expect(canActivate).toBe(true);
      expect(req.customerId).toBe(1);

      prisma.work.count.mockResolvedValue(1);
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Growth Plan' },
      });
      prisma.work.findMany.mockResolvedValue([
        {
          id: 501,
          customerId: 1,
          title: 'Customer A Session Shoot',
          scheduledDate: new Date('2026-10-11T10:00:00.000Z'),
          status: WorkStatus.SCHEDULED,
          customer: { id: 1, name: 'Customer A Org' },
        },
      ]);

      const calendar = await controller.getCalendar(
        String(req.customerId),
        req,
        undefined,
        '2026-10-11',
        undefined,
        undefined,
        '2026-10-11',
        '2026-10-11',
      );

      expect(calendar).toHaveLength(1);
      expect(calendar[0].customerId).toBe('1');
      expect(calendar[0].title).toBe('Customer A Session Shoot');
    });
  });

  describe('4. Admin calendar access follows existing permissions', () => {
    it('Super Admin can query Customer A calendar via customerId=1', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true });

      const req: any = {
        user: { id: 1, email: 'admin@quickboom.com', role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] },
        query: { customerId: '1', date: '2026-10-11' },
        headers: {},
      };
      const context = createMockContext(req);

      const canActivate = await guard.canActivate(context);
      expect(canActivate).toBe(true);
      expect(req.customerId).toBe(1);

      prisma.work.count.mockResolvedValue(1);
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Growth Plan' },
      });
      prisma.work.findMany.mockResolvedValue([
        {
          id: 501,
          customerId: 1,
          title: 'Admin viewed Customer A Work',
          scheduledDate: new Date('2026-10-11T10:00:00.000Z'),
          status: WorkStatus.SCHEDULED,
          customer: { id: 1, name: 'Customer A Org' },
        },
      ]);

      const calendar = await controller.getCalendar(
        String(req.customerId),
        req,
        undefined,
        '2026-10-11',
      );

      expect(calendar).toHaveLength(1);
      expect(calendar[0].title).toBe('Admin viewed Customer A Work');
    });
  });

  describe('5. Valid date filters return the correct calendar records', () => {
    it('filters records accurately for 2026-10-11 while ignoring other dates', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 1, name: 'Customer A Org', isActive: true });

      const req: any = {
        user: { id: 10, email: 'custA@test.com', customerId: 1, role: 'CUSTOMER' },
        query: { date: '2026-10-11' },
        headers: {},
      };

      prisma.work.count.mockResolvedValue(2);
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Growth Plan' },
      });
      // Work service date filter matches target day
      prisma.work.findMany.mockResolvedValue([
        {
          id: 701,
          customerId: 1,
          title: 'Oct 11 Schedule',
          scheduledDate: new Date('2026-10-11T11:00:00.000Z'),
          status: WorkStatus.SCHEDULED,
          customer: { id: 1, name: 'Customer A Org' },
        },
        {
          id: 702,
          customerId: 1,
          title: 'Oct 12 Schedule',
          scheduledDate: new Date('2026-10-12T11:00:00.000Z'),
          status: WorkStatus.SCHEDULED,
          customer: { id: 1, name: 'Customer A Org' },
        },
      ]);

      const calendar = await controller.getCalendar(
        '1',
        req,
        undefined,
        '2026-10-11',
      );

      expect(calendar).toHaveLength(1);
      expect(calendar[0].id).toBe('701');
      expect(calendar[0].title).toBe('Oct 11 Schedule');
    });
  });

  describe('6. Missing or invalid customer identity handled safely', () => {
    it('rejects unauthenticated or customer-less user with ForbiddenException', async () => {
      const req: any = {
        user: { id: 99, email: 'orphan@test.com', role: 'CUSTOMER' },
        query: {},
        headers: {},
      };
      const context = createMockContext(req);

      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('rejects request with non-existent customerId with 403 Forbidden', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Cust A', isActive: true })
        .mockResolvedValueOnce(null); // non-existent customer 99999

      const req: any = {
        user: { id: 10, email: 'custA@test.com', customerId: 1, role: 'CUSTOMER' },
        query: { customerId: '99999' },
        headers: {},
      };
      const context = createMockContext(req);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
