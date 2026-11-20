import { Controller, Get, HttpStatus, Logger, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

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

  @Get()
  @ApiOperation({ summary: 'API root welcome endpoint' })
  @ApiResponse({ status: 200, description: 'API is running successfully' })
  getRoot() {
    return {
      success: true,
      message: 'API is running successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Get(['favicon.ico', 'favicon.png'])
  @ApiOperation({ summary: 'Favicon handler' })
  @ApiResponse({ status: 200, description: 'Favicon asset if available' })
  @ApiResponse({ status: 204, description: 'No favicon asset available' })
  getFavicon(@Req() req: Request, @Res() res: Response) {
    const filename = req.path?.endsWith('.png') ? 'favicon.png' : 'favicon.ico';
    const possiblePaths = [
      join(process.cwd(), 'public', filename),
      join(process.cwd(), 'assets', filename),
      join(process.cwd(), 'uploads', filename),
      join(process.cwd(), filename),
      join(__dirname, '..', 'public', filename),
      join(__dirname, '..', 'assets', filename),
    ];

    for (const filePath of possiblePaths) {
      if (existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }

    return res.status(HttpStatus.NO_CONTENT).end();
  }
}
