import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';

export interface PlanScheduleEventPayload {
  customerId: string;
  planId?: string | number;
  scheduleId?: string | number;
  event:
    | 'PLAN_SCHEDULE_CREATED'
    | 'PLAN_SCHEDULE_UPDATED'
    | 'PLAN_SCHEDULE_DELETED'
    | 'ACTIVE_PLAN_UPDATED'
    | 'SCHEDULE_STATUS_CHANGED'
    | string;
  action?: string;
  date?: string;
  data?: any;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/ws/plan-schedule',
})
export class PlanScheduleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PlanScheduleGateway.name);

  handleConnection(client: Socket) {
    const rawCustomerId = client.handshake.query.customerId as string;
    if (rawCustomerId) {
      const normalized = this.normalizeCustomerId(rawCustomerId);
      client.join(`customer-${normalized}`);
      client.join(`customer-${this.extractNumericId(rawCustomerId)}`);
      this.logger.log(`[REALTIME] Connected | Customer: ${normalized} | Socket: ${client.id}`);
    } else {
      this.logger.log(`[REALTIME] Connected | Socket: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[REALTIME] Disconnected | Socket: ${client.id}`);
  }

  @SubscribeMessage('joinCustomerRoom')
  handleJoinCustomerRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId: string | number },
  ) {
    if (data?.customerId) {
      const normalized = this.normalizeCustomerId(String(data.customerId));
      const numeric = this.extractNumericId(String(data.customerId));
      client.join(`customer-${normalized}`);
      client.join(`customer-${numeric}`);
      this.logger.log(`[REALTIME] Customer joined room: customer-${normalized} (Socket: ${client.id})`);
      return { success: true, room: `customer-${normalized}` };
    }
    return { success: false, message: 'Invalid customerId' };
  }

  @SubscribeMessage('subscribePlanSchedule')
  handleSubscribePlanSchedule(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId: string | number },
  ) {
    return this.handleJoinCustomerRoom(client, data);
  }

  /**
   * Emit real-time event strictly isolated to the specific customer
   */
  emitPlanScheduleEvent(
    customerId: number | string,
    payload: Omit<PlanScheduleEventPayload, 'customerId'> & { customerId?: string },
  ) {
    const normalizedCustId = this.normalizeCustomerId(String(customerId));
    const numericCustId = this.extractNumericId(String(customerId));

    const finalPayload: PlanScheduleEventPayload = {
      customerId: normalizedCustId,
      ...payload,
    };

    this.logger.log(
      `[REALTIME_EVENT]\n${finalPayload.event}\nscheduleId: ${finalPayload.scheduleId ?? 'N/A'}\ncustomerId: ${normalizedCustId}`,
    );

    if (this.server) {
      // Emit to both prefixed and numeric room names for robust client matching
      this.server.to(`customer-${normalizedCustId}`).emit('plan.schedule.event', finalPayload);
      this.server.to(`customer-${numericCustId}`).emit('plan.schedule.event', finalPayload);
      this.server.to(`customer-${normalizedCustId}`).emit(finalPayload.event, finalPayload);
      this.server.to(`customer-${numericCustId}`).emit(finalPayload.event, finalPayload);
    }
  }

  private normalizeCustomerId(id: string): string {
    const clean = id.trim();
    if (clean.startsWith('CUST-')) return clean;
    return `CUST-${clean}`;
  }

  private extractNumericId(id: string): string {
    const clean = id.trim().replace(/^CUST-/i, '');
    return clean;
  }
}
