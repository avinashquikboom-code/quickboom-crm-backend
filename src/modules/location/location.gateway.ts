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
  broadcastLocationUpdate(customerId: string, locationData: any) {
    this.logger.log(`Broadcasting location update for customer ${customerId}`);
    this.server.to(`customer-${customerId}`).emit('employee.location.updated', locationData);
  }

  // Broadcast status change (Punch In/Out, Visit Start/End)
  broadcastStatusUpdate(customerId: string, statusData: any) {
    this.logger.log(`Broadcasting status update for customer ${customerId}`);
    this.server.to(`customer-${customerId}`).emit('employee.status.updated', statusData);
  }

  @SubscribeMessage('joinCustomerRoom')
  handleJoinCustomerRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId: string },
  ) {
    if (data?.customerId) {
      client.join(`customer-${data.customerId}`);
      this.logger.log(`Client ${client.id} joined location room: customer-${data.customerId}`);
      return { event: 'joinedRoom', room: `customer-${data.customerId}` };
    }
  }
}
