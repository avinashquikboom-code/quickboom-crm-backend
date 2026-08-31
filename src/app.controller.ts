import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health & System Status')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  @Get('health')
  @ApiOperation({ summary: 'Check if backend server and services are healthy' })
  @ApiResponse({
    status: 200,
    description: 'Backend is healthy and running',
    schema: {
      example: {
        success: true,
        status: 'ok',
        uptime: 124.5,
        timestamp: '2026-08-16T12:00:00.000Z',
        service: 'QuikBoom Backend API',
        version: '1.0.0',
        environment: 'production',
      },
    },
  })
  getHealth() {
    this.logger.log(`[HEALTH] status: ok`);
    return {
      success: true,
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: 'QuikBoom Backend API',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'production',
    };
  }

  @Get('ping')
  @ApiOperation({ summary: 'Simple ping endpoint to verify connectivity' })
  @ApiResponse({ status: 200, description: 'Pong response' })
  ping() {
    return {
      success: true,
      status: 'pong',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('')
  @ApiOperation({ summary: 'API root welcome endpoint' })
  @ApiResponse({ status: 200, description: 'Welcome message and API info' })
  getRoot() {
    return {
      success: true,
      message: 'QuikBoom Enterprise SaaS CRM Backend API is running',
      version: '1.0.0',
      status: 'online',
      docs: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }
}
