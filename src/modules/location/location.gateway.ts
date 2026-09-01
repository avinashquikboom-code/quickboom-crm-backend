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
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws/location',
})
export class LocationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LocationGateway.name);

  handleConnection(client: Socket) {
    const customerId = client.handshake.query?.customerId || client.handshake.headers?.['x-customer-id'];
    if (customerId) {
      const room = `customer-${customerId}`;
      client.join(room);
      this.logger.log(`[WS_LOCATION] Client ${client.id} connected & joined room: ${room}`);
    } else {
      this.logger.log(`[WS_LOCATION] Client ${client.id} connected without customer room.`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[WS_LOCATION] Client ${client.id} disconnected.`);
  }

  // Broadcast real-time location update to connected Admin clients
  broadcastLocationUpdate(customerId: number | string, locationData: any) {
    const custId = String(customerId);
    const room = `customer-${custId}`;

    this.logger.log(
      `[EMPLOYEE_LOCATION] employeeId: ${locationData.employeeId || locationData.id} lat: ${locationData.latitude || locationData.lat} lng: ${locationData.longitude || locationData.lng} receivedAt: ${locationData.lastSeenAt || new Date().toISOString()} broadcast: success`,
    );

    if (this.server) {
      // 1. Emit to tenant room
      this.server.to(room).emit('employee.location.updated', locationData);
      // 2. Also emit to default namespace broadcast for connected admins
      this.server.emit('employee.location.updated', locationData);
    }
  }

  // Broadcast status change (Punch In/Out, Visit Start/End)
  broadcastStatusUpdate(customerId: number | string, statusData: any) {
    const custId = String(customerId);
    const room = `customer-${custId}`;
    this.logger.log(`[EMPLOYEE_STATUS] Broadcasting status update for customer ${custId}`);
    if (this.server) {
      this.server.to(room).emit('employee.status.updated', statusData);
      this.server.emit('employee.status.updated', statusData);
    }
  }

  @SubscribeMessage('joinCustomerRoom')
  handleJoinCustomerRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId: string | number },
  ) {
    const customerId = data?.customerId ? String(data.customerId) : null;
    if (customerId) {
      const room = `customer-${customerId}`;
      client.join(room);
      this.logger.log(`[WS_LOCATION] Client ${client.id} joined location room: ${room}`);
      return { event: 'joinedRoom', room };
    }
  }
}
