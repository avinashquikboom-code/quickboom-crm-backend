import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/ws/location',
})
export class LocationGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LocationGateway.name);

  // Broadcast real-time location update to connected Admin clients
  broadcastLocationUpdate(tenantId: string, locationData: any) {
    this.logger.log(`Broadcasting location update for tenant ${tenantId}`);
    this.server.to(`tenant-${tenantId}`).emit('employee.location.updated', locationData);
  }

  // Broadcast status change (Punch In/Out, Visit Start/End)
  broadcastStatusUpdate(tenantId: string, statusData: any) {
    this.logger.log(`Broadcasting status update for tenant ${tenantId}`);
    this.server.to(`tenant-${tenantId}`).emit('employee.status.updated', statusData);
  }

  @SubscribeMessage('joinTenantRoom')
  handleJoinTenantRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tenantId: string },
  ) {
    if (data?.tenantId) {
      client.join(`tenant-${data.tenantId}`);
      this.logger.log(`Client ${client.id} joined location room: tenant-${data.tenantId}`);
      return { event: 'joinedRoom', room: `tenant-${data.tenantId}` };
    }
  }
}
