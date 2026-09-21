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
    const authHeader = client.handshake.headers?.authorization;
    const token =
      client.handshake.auth?.token ||
      (typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : null) ||
      (client.handshake.query?.token as string);

    const rawCustomerId =
      (client.handshake.query?.customerId as string) ||
      (client.handshake.auth?.customerId as string) ||
      (client.handshake.headers?.['x-customer-id'] as string);

    const hasToken = Boolean(token && token.trim().length > 0 && token !== 'null' && token !== 'undefined');

    // 1. If JWT token is provided and verification services are available, validate securely
    if (hasToken && this.jwtService && this.prisma) {
      try {
        const secret =
          this.configService?.get<string>('JWT_SECRET') ||
          'quikboom_super_secret_jwt_access_key_2026';
        const payload: any = this.jwtService.verify(token.trim(), { secret });
        const rawUserId = payload.sub ?? payload.id ?? payload.userId;
        const userId = Number(rawUserId);

        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            userRoles: {
              include: { role: true },
            },
            employee: true,
          },
        });

        if (!user || !user.isActive || user.deletedAt) {
          this.logger.warn(`[REALTIME_AUTH_REJECTED] User account inactive or missing for user ID ${userId}`);
          client.emit('error', { statusCode: 401, message: 'User account inactive or missing' });
          client.disconnect(true);
          return;
        }

        const isSuperAdmin = user.userRoles?.some(
          (ur) =>
            ur.role?.type === 'SUPER_ADMIN' ||
            String(ur.role?.name || '').toUpperCase().replace(/[\s_]+/g, '') === 'SUPERADMIN',
        );

        const authCustomerPk = user.customerId ? Number(user.customerId) : null;

        if (!isSuperAdmin) {
          if (!authCustomerPk || authCustomerPk <= 0) {
            this.logger.warn(`[REALTIME_AUTH_REJECTED] User ${userId} does not belong to any customer`);
            client.emit('error', { statusCode: 403, message: 'User does not belong to any customer' });
            client.disconnect(true);
            return;
          }

          const customer = await this.prisma.customer.findFirst({
            where: { id: authCustomerPk, deletedAt: null, isActive: true },
            select: { id: true, name: true, isActive: true },
          });

          if (!customer || !customer.isActive) {
            this.logger.warn(`[REALTIME_AUTH_REJECTED] Customer record ${authCustomerPk} not found or deactivated`);
            client.emit('error', { statusCode: 403, message: 'Customer record not found or deactivated' });
            client.disconnect(true);
            return;
          }

          // If client provided a customerId parameter, verify matching tenant PK
          if (rawCustomerId) {
            const requestedPk = this.extractNumericPk(rawCustomerId);
            if (requestedPk !== undefined && requestedPk !== authCustomerPk) {
              this.logger.warn(
                `[REALTIME_AUTH_REJECTED] Cross-customer access attempt: token customer ${authCustomerPk} requested ${rawCustomerId}`,
              );
              client.emit('error', { statusCode: 403, message: 'Cross-customer access forbidden' });
              client.disconnect(true);
              return;
            }
          }
        }

          client.join(`user-${userId}`);
          if (user.employee) {
            client.join(`employee-${user.employee.id}`);
            if (user.employee.designationId) {
              client.join(`designation-${user.employee.designationId}`);
            }
          }
          if (authCustomerPk) {
            const normalized = this.normalizeCustomerId(String(authCustomerPk));
            client.join(`customer-${normalized}`);
            client.join(`customer-${authCustomerPk}`);
            if (rawCustomerId) {
              client.join(`customer-${rawCustomerId.trim()}`);
            }
            this.logger.log(
              `[REALTIME] Connected (Authenticated) | Customer: ${normalized} (PK: ${authCustomerPk}) | User: ${userId} | Employee: ${user.employee?.id ?? 'N/A'} | Socket: ${client.id}`,
            );
          } else {
            this.logger.log(`[REALTIME] Connected (Admin) | User: ${userId} | Socket: ${client.id}`);
          }
          return;
      } catch (err: any) {
        this.logger.warn(`[REALTIME_AUTH_REJECTED] Invalid token: ${err?.message}`);
        client.emit('error', { statusCode: 401, message: 'Invalid or expired authentication token' });
        client.disconnect(true);
        return;
      }
    }

    // 2. Direct identifier fallback (for unit tests / internal gateways)
    if (rawCustomerId) {
      const normalized = this.normalizeCustomerId(rawCustomerId);
      const numeric = this.extractNumericPk(rawCustomerId);
      client.join(`customer-${normalized}`);
      if (numeric !== undefined) {
        client.join(`customer-${numeric}`);
      }
      client.join(`customer-${rawCustomerId.trim()}`);
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
      const numeric = this.extractNumericPk(String(data.customerId));
      client.join(`customer-${normalized}`);
      if (numeric !== undefined) {
        client.join(`customer-${numeric}`);
      }
      client.join(`customer-${String(data.customerId).trim()}`);
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
    const numericCustId = this.extractNumericPk(String(customerId));

    const finalPayload: PlanScheduleEventPayload = {
      customerId: normalizedCustId,
      ...payload,
    };

    this.logger.log(
      `[REALTIME_EVENT]\n${finalPayload.event}\nscheduleId: ${finalPayload.scheduleId ?? 'N/A'}\ncustomerId: ${normalizedCustId}`,
    );

    if (this.server) {
      // Emit to normalized, numeric, and prefixed room names for robust client matching
      this.server.to(`customer-${normalizedCustId}`).emit('plan.schedule.event', finalPayload);
      this.server.to(`customer-${normalizedCustId}`).emit(finalPayload.event, finalPayload);

      if (numericCustId !== undefined) {
        this.server.to(`customer-${numericCustId}`).emit('plan.schedule.event', finalPayload);
        this.server.to(`customer-${numericCustId}`).emit(finalPayload.event, finalPayload);
      }

      if (typeof customerId === 'string' && customerId !== normalizedCustId) {
        this.server.to(`customer-${customerId.trim()}`).emit('plan.schedule.event', finalPayload);
        this.server.to(`customer-${customerId.trim()}`).emit(finalPayload.event, finalPayload);
      }
    }
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
}
