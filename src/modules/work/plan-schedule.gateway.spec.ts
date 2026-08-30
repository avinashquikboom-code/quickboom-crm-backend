import { Test, TestingModule } from '@nestjs/testing';
import { PlanScheduleGateway } from './plan-schedule.gateway';

describe('PlanScheduleGateway Customer Isolation & Real-Time Sync Tests', () => {
  let gateway: PlanScheduleGateway;
  let mockServer: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PlanScheduleGateway],
    }).compile();

    gateway = module.get<PlanScheduleGateway>(PlanScheduleGateway);
    gateway.server = mockServer;
  });

  it('joins customer-specific isolated rooms on connection', () => {
    const mockSocket: any = {
      id: 'socket-123',
      handshake: {
        query: {
          customerId: 'CUST-11',
        },
      },
      join: jest.fn(),
    };

    gateway.handleConnection(mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('customer-CUST-11');
    expect(mockSocket.join).toHaveBeenCalledWith('customer-11');
  });

  it('TEST 1 & 2: Emits events strictly to the target customer room and NOT to other customers', () => {
    gateway.emitPlanScheduleEvent(11, {
      event: 'PLAN_SCHEDULE_CREATED',
      planId: 2,
      scheduleId: 101,
    });

    // Verify room targeting
    expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-11');
    expect(mockServer.to).toHaveBeenCalledWith('customer-11');
    expect(mockServer.to).not.toHaveBeenCalledWith('customer-CUST-99');

    // Verify event payload structure
    expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
      customerId: 'CUST-11',
      event: 'PLAN_SCHEDULE_CREATED',
      planId: 2,
      scheduleId: 101,
    });
  });

  it('TEST 3: Emits PLAN_SCHEDULE_UPDATED when date changes', () => {
    gateway.emitPlanScheduleEvent('CUST-11', {
      event: 'PLAN_SCHEDULE_UPDATED',
      scheduleId: 102,
      date: '2026-08-27',
    });

    expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-11');
    expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
      customerId: 'CUST-11',
      event: 'PLAN_SCHEDULE_UPDATED',
      scheduleId: 102,
      date: '2026-08-27',
    });
  });

  it('TEST 4: Emits PLAN_SCHEDULE_DELETED when schedule is cancelled', () => {
    gateway.emitPlanScheduleEvent('11', {
      event: 'PLAN_SCHEDULE_DELETED',
      scheduleId: 103,
    });

    expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-11');
    expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
      customerId: 'CUST-11',
      event: 'PLAN_SCHEDULE_DELETED',
      scheduleId: 103,
    });
  });

  it('TEST 6: Emits ACTIVE_PLAN_UPDATED when a plan is purchased or activated', () => {
    gateway.emitPlanScheduleEvent('CUST-11', {
      event: 'ACTIVE_PLAN_UPDATED',
      planId: 5,
    });

    expect(mockServer.to).toHaveBeenCalledWith('customer-CUST-11');
    expect(mockServer.emit).toHaveBeenCalledWith('plan.schedule.event', {
      customerId: 'CUST-11',
      event: 'ACTIVE_PLAN_UPDATED',
      planId: 5,
    });
  });
});
