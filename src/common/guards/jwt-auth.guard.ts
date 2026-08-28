import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const hasBearer = typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ');

    if (!hasBearer) {
      this.logger.warn(
        `[JWT_AUTH] ${request.method} ${request.url} - ${authHeader ? 'Malformed Authorization header' : 'Missing Authorization header'}`,
      );
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info?: any, context?: ExecutionContext) {
    const request = context?.switchToHttp ? context.switchToHttp().getRequest() : null;
    if (err || !user) {
      const failureReason = info?.message || err?.message || 'Token missing or invalid';
      if (request) {
        this.logger.warn(
          `[JWT_AUTH_FAILURE] ${request.method} ${request.url} - Reason: ${failureReason}`,
        );
      }
      throw err || new UnauthorizedException('Invalid or expired authentication token');
    }

    if (request) {
      this.logger.debug?.(
        `[JWT_AUTH_SUCCESS] ${request.method} ${request.url} - User: ${user.id}, Role: ${user.role}`,
      );
    }

    return user;
  }
}

