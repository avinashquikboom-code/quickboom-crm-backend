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
    const hasHeader = Boolean(authHeader);
    const hasBearer = typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ');
    const tokenVal = hasBearer ? authHeader.trim().substring(7).trim() : null;
    const hasValidToken = Boolean(
      tokenVal &&
      tokenVal !== 'null' &&
      tokenVal !== 'undefined' &&
      tokenVal !== '[object Object]' &&
      tokenVal.length > 0,
    );

    this.logger.debug?.(
      `[AUTH DEBUG]\nAuthorization header exists: ${hasHeader}\nToken exists: ${hasValidToken}`,
    );

    if (!hasBearer && hasHeader) {
      this.logger.warn(
        `[JWT_AUTH] ${request.method} ${request.url} - Malformed Authorization header`,
      );
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info?: any, context?: ExecutionContext) {
    const request = context?.switchToHttp ? context.switchToHttp().getRequest() : null;
    if (err || !user) {
      const failureReason = info?.message || err?.message || 'Token missing or invalid';
      if (request) {
        const authHeader = request.headers?.['authorization'];
        const hasHeader = Boolean(authHeader);
        const hasBearer = typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ');
        const tokenVal = hasBearer ? authHeader.trim().substring(7).trim() : null;
        const hasValidToken = Boolean(
          tokenVal &&
          tokenVal !== 'null' &&
          tokenVal !== 'undefined' &&
          tokenVal !== '[object Object]' &&
          tokenVal.length > 0,
        );

        this.logger.warn(
          `[AUTH DEBUG]\nAuthorization header exists: ${hasHeader}\nToken exists: ${hasValidToken}\n[JWT_AUTH_FAILURE] ${request.method} ${request.url} - Reason: ${failureReason}`,
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

