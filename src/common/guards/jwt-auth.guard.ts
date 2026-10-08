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

        const isMetaTemplates = typeof request.url === 'string' && (request.url.includes('/templates/meta') || request.url.includes('/meta-templates'));
        if (isMetaTemplates) {
          const isTokenExpired = Boolean(
            failureReason?.toLowerCase().includes('expired') ||
            (info as any)?.name === 'TokenExpiredError' ||
            err?.name === 'TokenExpiredError',
          );
          const isRefreshAttempted = Boolean(
            request.headers?.['x-refresh-attempted'] === 'true' ||
            request.query?.refreshAttempted === 'true',
          );
          this.logger.log(
            `[META_TEMPLATES_AUTH]\ntokenPresent=${hasValidToken}\ntokenExpired=${isTokenExpired}\nrefreshAttempted=${isRefreshAttempted}`,
          );
        }

        const isTokenExpired = Boolean(
          failureReason?.toLowerCase().includes('expired') ||
          (info as any)?.name === 'TokenExpiredError' ||
          err?.name === 'TokenExpiredError',
        );
        this.logger.warn(
          `[AUTH DEBUG] endpoint=${request.url} method=${request.method} authHeaderPresent=${hasHeader} bearer=${hasBearer} tokenPresent=${hasValidToken} tokenExpired=${isTokenExpired} [JWT_AUTH_FAILURE] Reason: ${failureReason}`,
        );
        if (!err) {
          const code = !hasValidToken ? 'TOKEN_MISSING' : isTokenExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
          throw new UnauthorizedException({
            message: 'Invalid or expired authentication token',
            error: 'Unauthorized',
            code,
          });
        }
      }
      throw err || new UnauthorizedException('Invalid or expired authentication token');
    }

    if (request) {
      const isBulkLeadEndpoint = typeof request.url === 'string' && request.url.includes('/leads/bulk');
      const isMetaTemplates = typeof request.url === 'string' && (request.url.includes('/templates/meta') || request.url.includes('/meta-templates'));

      if (isMetaTemplates) {
        this.logger.log(
          `[META_TEMPLATES_AUTH]\ntokenPresent=true\ntokenExpired=false\nrefreshAttempted=false`,
        );
      }

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

