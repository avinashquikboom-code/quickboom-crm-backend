import { Test, TestingModule } from '@nestjs/testing';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('PlanScheduleGateway Customer Isolation & Real-Time Sync Tests', () => {
  let gateway: PlanScheduleGateway;
  let mockServer: any;
  let mockPrisma: any;
  let mockJwtService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockPrisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 15) {
            return Promise.resolve({
              id: 15,
              email: 'cust16@example.com',
              isActive: true,
              deletedAt: null,
              customerId: 16,
              userRoles: [{ role: { type: 'CUSTOMER' } }],
            });
          }
          if (where.id === 99) {
            // Deactivated user
            return Promise.resolve({
              id: 99,
              email: 'inactive@example.com',
              isActive: false,
              deletedAt: null,
              customerId: 16,
              userRoles: [{ role: { type: 'CUSTOMER' } }],
            });
          }
          return Promise.resolve(null);
        }),
      },
      customer: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 16 && where.isActive === true) {
            return Promise.resolve({
              id: 16,
              name: 'Customer 16',
              isActive: true,
              deletedAt: null,
            });
          }
          if (where.id === 999) {
            return Promise.resolve(null);
          }
          return Promise.resolve(null);
        }),
      },
    };

    mockJwtService = {
      verify: jest.fn().mockImplementation((token: string) => {
        if (token === 'valid-token-user-15') {
          return { sub: 15, customerId: 16 };
        }
        if (token === 'inactive-user-token') {
          return { sub: 99, customerId: 16 };
        }
        throw new Error('jwt expired');
      }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('quikboom_super_secret_jwt_access_key_2026'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanScheduleGateway,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    gateway = module.get<PlanScheduleGateway>(PlanScheduleGateway);
    gateway.server = mockServer;
  });

  describe('1. JWT Authentication & Customer Verification on Connection', () => {
    it('authenticates valid active customer and joins customer rooms', async () => {
      const mockSocket: any = {
        id: 'socket-valid-1',
        handshake: {
          headers: {},
          auth: { token: 'valid-token-user-15' },
          query: { customerId: 'CUST-QB-CUST-016' },
        },
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('customer-CUST-16');
      expect(mockSocket.join).toHaveBeenCalledWith('customer-16');
      expect(mockSocket.join).toHaveBeenCalledWith('customer-CUST-QB-CUST-016');
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('rejects connection with invalid or expired JWT token', async () => {
      const mockSocket: any = {
        id: 'socket-invalid-token',
        handshake: {
          headers: {},
          auth: { token: 'expired-or-garbage-token' },
          query: { customerId: 'CUST-16' },
        },
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ statusCode: 401 }));
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('rejects connection with inactive user account', async () => {
      const mockSocket: any = {
        id: 'socket-inactive-user',
        handshake: {
          headers: {},
          auth: { token: 'inactive-user-token' },
          query: { customerId: 'CUST-16' },
        },
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ statusCode: 401 }));
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects cross-customer tenant tampering', async () => {
      const mockSocket: any = {
        id: 'socket-cross-customer',
        handshake: {
          headers: {},
          auth: { token: 'valid-token-user-15' },
          query: { customerId: 'CUST-999' }, // User 15 belongs to customer 16, but requested 999
        },
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ statusCode: 403 }));
      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('2. Real-Time Event Emission & Customer Isolation', () => {
    it('emits events strictly to the target customer room', () => {
      gateway.emitPlanScheduleEvent(16, {
        event: 'PLAN_SCHEDULE_CREATED',
        planId: 2,
        scheduleId: 101,
      });

      expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-16');
      expect(mockServer.to).toHaveBeenCalledWith('customer-16');
      expect(mockServer.to).not.toHaveBeenCalledWith('customer-CUST-99');

      expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
        customerId: 'CUST-16',
        event: 'PLAN_SCHEDULE_CREATED',
        planId: 2,
        scheduleId: 101,
      });
    });

    it('emits PLAN_SCHEDULE_UPDATED when schedule date changes', () => {
      gateway.emitPlanScheduleEvent('CUST-16', {
        event: 'PLAN_SCHEDULE_UPDATED',
        scheduleId: 102,
        date: '2026-08-31',
      });

      expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-16');
      expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
        customerId: 'CUST-16',
        event: 'PLAN_SCHEDULE_UPDATED',
        scheduleId: 102,
        date: '2026-08-31',
      });
    });

    it('emits PLAN_SCHEDULE_DELETED when schedule is removed', () => {
      gateway.emitPlanScheduleEvent('16', {
        event: 'PLAN_SCHEDULE_DELETED',
        scheduleId: 103,
      });

      expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-16');
      expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
        customerId: 'CUST-16',
        event: 'PLAN_SCHEDULE_DELETED',
        scheduleId: 103,
      });
    });

    it('emits ACTIVE_PLAN_UPDATED when plan is activated', () => {
      gateway.emitPlanScheduleEvent('CUST-16', {
        event: 'ACTIVE_PLAN_UPDATED',
        planId: 5,
      });

      expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-16');
      expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
        customerId: 'CUST-16',
        event: 'ACTIVE_PLAN_UPDATED',
        planId: 5,
      });
    });
  });
});
