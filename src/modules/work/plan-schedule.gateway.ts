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
import { Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface PlanScheduleEventPayload {
  customerId?: string;
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
  path: '/ws/plan-schedule',
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

  constructor(
    @Optional() private prisma?: PrismaService,
    @Optional() private jwtService?: JwtService,
    @Optional() private configService?: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
const token = client.handshake.auth?.token || String(client.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !this.jwtService || !this.prisma) { client.disconnect(true); return; }
    try {
      const payload = this.jwtService.verify(token, { secret: this.configService?.get<string>('JWT_SECRET') || process.env.JWT_SECRET });
      const userId = Number(payload.sub ?? payload.userId);
      if (!Number.isInteger(userId) || userId <= 0) { client.disconnect(true); return; }
      const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { employee: true } });
      if (!user || !user.isActive || user.deletedAt || (user.employee && user.employee.status !== 'ACTIVE')) { client.disconnect(true); return; }
      client.data.userId = user.id;
      await client.join('organization');
      await client.join(`user-${user.id}`);
      if (user.employee) {
        await client.join(`employee-${user.employee.id}`);
        if (user.employee.designationId) await client.join(`designation-${user.employee.designationId}`);
      }
    } catch { client.disconnect(true); }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[REALTIME] Disconnected | Socket: ${client.id}`);
  }

  @SubscribeMessage('joinCustomerRoom')
  async handleJoinCustomerRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId?: string | number },
  ) {
if (!client.data.userId) { client.disconnect(true); return { success: false }; }
    await client.join('organization');
    return { success: true, room: 'organization' };
  }

  @SubscribeMessage('subscribePlanSchedule')
  handleSubscribePlanSchedule(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId?: string | number },
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
const finalPayload = { ...payload };
    delete finalPayload.customerId;
    this.server?.to('organization').emit('plan.schedule.event', finalPayload);
    this.server?.to('organization').emit(finalPayload.event, finalPayload);
  }

  private normalizeCustomerId(id: string): string {
    const clean = id.trim();
    if (clean.startsWith('CUST-')) return clean;
    return `CUST-${clean}`;
  }

  private extractNumericPk(id: string | number): number | undefined {
    if (id == null) return undefined;
    if (typeof id === 'number') return id;
    const str = String(id).trim();
    const match = str.match(/0*([0-9]+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num)) return num;
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RBAC Real-time Permission Refresh Notifications
  // ─────────────────────────────────────────────────────────────────────────────

  notifyEmployeePermissionsUpdated(employeeId: number, designationId?: number | null) {
    const payload = {
      event: 'employee_permissions_updated',
      employeeId,
      designationId: designationId || undefined,
      timestamp: new Date().toISOString(),
    };
    if (this.server) {
      this.server.to(`employee-${employeeId}`).emit('employee_permissions_updated', payload);
      this.server.emit('employee_permissions_updated', payload);
      if (designationId) {
        this.server.to(`designation-${designationId}`).emit('employee_permissions_updated', payload);
      }
    }
    this.logger.log(`[RBAC_REALTIME] Emitted employee_permissions_updated to employee-${employeeId}`);
  }

  notifyDesignationPermissionsUpdated(designationId: number, affectedEmployeeIds: number[] = []) {
    const payload = {
      event: 'employee_permissions_updated',
      designationId,
      timestamp: new Date().toISOString(),
    };
    if (this.server) {
      this.server.to(`designation-${designationId}`).emit('employee_permissions_updated', payload);
      this.server.emit('employee_permissions_updated', payload);
      for (const empId of affectedEmployeeIds) {
        this.server.to(`employee-${empId}`).emit('employee_permissions_updated', { ...payload, employeeId: empId });
      }
    }
    this.logger.log(
      `[RBAC_REALTIME] Emitted employee_permissions_updated for designation-${designationId} (${affectedEmployeeIds.length} employees)`,
    );
  }

  notifyLeadLimitUpdated(
    customerId: number,
    data?: { roleName?: string; employeeId?: number; designationId?: number | null },
  ) {
    const payload = {
      event: 'lead_limit_updated',

      ...data,
      timestamp: new Date().toISOString(),
    };
    if (this.server) {
      if (data?.employeeId) {
        this.server.to(`employee-${data.employeeId}`).emit('lead_limit_updated', payload);
      }
      if (data?.designationId) {
        this.server.to(`designation-${data.designationId}`).emit('lead_limit_updated', payload);
      }
      this.server.to(`customer-${customerId}`).emit('lead_limit_updated', payload);
      this.server.emit('lead_limit_updated', payload);
    }
    this.logger.log(
      `[LEAD_LIMIT_REALTIME] Emitted lead_limit_updated for customer-${customerId} ${data?.employeeId ? `employee-${data.employeeId}` : ''} ${data?.roleName ? `role-${data.roleName}` : ''}`,
    );
  }

  notifyCustomerPermissionsUpdated(customerId: number) {
    const payload = {
      event: 'customer_permissions_updated',

      timestamp: new Date().toISOString(),
    };
    if (this.server) {
      const normalized = this.normalizeCustomerId(String(customerId));
      this.server.to(`customer-${normalized}`).emit('customer_permissions_updated', payload);
      this.server.to(`customer-${customerId}`).emit('customer_permissions_updated', payload);
      this.server.to(`customer-${normalized}`).emit('designation_permissions_updated', payload);
      this.server.to(`customer-${customerId}`).emit('designation_permissions_updated', payload);
      this.server.emit('customer_permissions_updated', payload);
      this.server.emit('designation_permissions_updated', payload);
    }
    this.logger.log(`[RBAC_REALTIME] Emitted customer_permissions_updated for customer-${customerId}`);
  }
}
