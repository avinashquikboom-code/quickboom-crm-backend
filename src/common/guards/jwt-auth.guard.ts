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
    if (request.method === 'OPTIONS') {
      return true;
    }
    const rawAuth =
      request.headers?.['authorization'] ||
      request.headers?.['Authorization'] ||
      (typeof request.get === 'function' ? request.get('authorization') : null);
    const authHeader = typeof rawAuth === 'string' ? rawAuth : null;
    const hasHeader = Boolean(authHeader && authHeader.trim().length > 0);
    const hasBearer = typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ');
    const tokenVal = hasBearer
      ? authHeader.trim().substring(7).trim().replace(/^["']|["']$/g, '').trim()
      : null;
    const hasValidToken = Boolean(
      tokenVal &&
      tokenVal !== 'null' &&
      tokenVal !== 'undefined' &&
      tokenVal !== '[object Object]' &&
      tokenVal.length > 0,
    );

    const isBulkLeadEndpoint = typeof request.url === 'string' && request.url.includes('/leads/bulk');
    if (isBulkLeadEndpoint || !hasValidToken) {
      this.logger.log(
        `[AUTH DEBUG] endpoint=${request.url} method=${request.method} authHeaderPresent=${hasHeader} hasBearer=${hasBearer} tokenPresent=${hasValidToken} tokenLength=${tokenVal ? tokenVal.length : 0}`,
      );
    }

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
        const rawAuth =
          request.headers?.['authorization'] ||
          request.headers?.['Authorization'] ||
          (typeof request.get === 'function' ? request.get('authorization') : null);
        const authHeader = typeof rawAuth === 'string' ? rawAuth : null;
        const hasHeader = Boolean(authHeader && authHeader.trim().length > 0);
        const hasBearer = typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ');
        const tokenVal = hasBearer
          ? authHeader.trim().substring(7).trim().replace(/^["']|["']$/g, '').trim()
          : null;
        const hasValidToken = Boolean(
          tokenVal &&
          tokenVal !== 'null' &&
          tokenVal !== 'undefined' &&
          tokenVal !== '[object Object]' &&
          tokenVal.length > 0,
        );

        this.logger.warn(
          `[AUTH DEBUG] endpoint=${request.url} method=${request.method} authHeaderPresent=${hasHeader} tokenPresent=${hasValidToken} [JWT_AUTH_FAILURE] Reason: ${failureReason}`,
        );
      }
      throw err || new UnauthorizedException('Invalid or expired authentication token');
    }

    if (request) {
      const isBulkLeadEndpoint = typeof request.url === 'string' && request.url.includes('/leads/bulk');
      if (isBulkLeadEndpoint) {
        this.logger.log(
          `[JWT_AUTH_SUCCESS] endpoint=${request.url} method=${request.method} userId=${user.id} role=${user.role} companyId=${user.customerId || user.companyId || 'NONE'}`,
        );
      } else {
        this.logger.debug?.(
          `[JWT_AUTH_SUCCESS] ${request.method} ${request.url} - User: ${user.id}, Role: ${user.role}`,
        );
      }
    }

    return user;
  }
}

