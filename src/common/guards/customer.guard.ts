import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { isUserSuperAdmin } from '../utils/role.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerGuard implements CanActivate {
  private readonly logger = new Logger(CustomerGuard.name);

  constructor(private prisma?: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const isSuperAdmin = isUserSuperAdmin(user);

    if (isSuperAdmin) {
      request.isSuperAdmin = true;
      const explicitCustomerId = request.query?.customerId || request.query?.clientId || request.headers['x-target-customer-id'];
      if (explicitCustomerId) {
        const resolvedId = await this.resolveCustomerPk(explicitCustomerId);
        request.customerId = resolvedId !== undefined ? resolvedId : (typeof explicitCustomerId === 'number' ? explicitCustomerId : parseInt(explicitCustomerId, 10) || explicitCustomerId);
      } else {
        request.customerId = undefined;
      }
      return true;
    }

    // Normal customer user - determine identity from authenticated user
    const userCustomerId = user?.customerId;
    if (userCustomerId == null || Number(userCustomerId) <= 0) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    const authCustomerPk = Number(userCustomerId);

    // Verify authenticated customer exists in DB if Prisma is available
    if (this.prisma) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: authCustomerPk, deletedAt: null },
        select: { id: true, name: true, domain: true, email: true },
      });

      if (!customer) {
        throw new ForbiddenException('Customer record not found or deactivated');
      }

      // Check header x-customer-id
      const headerCustomerId = request.headers['x-customer-id'];
      if (headerCustomerId) {
        const headerStr = String(headerCustomerId).trim();
        const resolvedHeaderPk = await this.resolveCustomerPk(headerStr);
        if (resolvedHeaderPk !== undefined && resolvedHeaderPk !== authCustomerPk) {
          throw new ForbiddenException('Cross-customer access forbidden');
        } else if (resolvedHeaderPk === undefined) {
          if (!this.isDirectAlias(headerStr, authCustomerPk, customer)) {
            throw new ForbiddenException('Cross-customer access forbidden');
          }
        }
      }

      // Check query customerId (normal customers cannot switch tenant via query param)
      const queryCustomerId = request.query?.customerId;
      if (queryCustomerId) {
        const queryStr = String(queryCustomerId).trim();
        const resolvedQueryPk = await this.resolveCustomerPk(queryStr);
        if (resolvedQueryPk !== undefined && resolvedQueryPk !== authCustomerPk) {
          throw new ForbiddenException('Cross-customer access forbidden');
        } else if (resolvedQueryPk === undefined) {
          if (!this.isDirectAlias(queryStr, authCustomerPk, customer)) {
            throw new ForbiddenException('Cross-customer access forbidden');
          }
        }
      }
    } else {
      // Fallback for isolated unit tests without Prisma
      const headerCustomerId = request.headers['x-customer-id'];
      if (headerCustomerId) {
        const headerStr = String(headerCustomerId).trim();
        if (!this.isDirectAlias(headerStr, authCustomerPk)) {
          throw new ForbiddenException('Cross-customer access forbidden');
        }
      }
      const queryCustomerId = request.query?.customerId;
      if (queryCustomerId) {
        const queryStr = String(queryCustomerId).trim();
        if (!this.isDirectAlias(queryStr, authCustomerPk)) {
          throw new ForbiddenException('Cross-customer access forbidden');
        }
      }
    }

    // Set request.customerId strictly to the REAL database customer primary key integer
    request.customerId = authCustomerPk;
    return true;
  }

  private async resolveCustomerPk(rawId: any): Promise<number | undefined> {
    if (rawId == null) return undefined;
    const str = String(rawId).trim();
    if (!str) return undefined;

    // 1. Direct integer check
    const directNum = parseInt(str, 10);
    if (!isNaN(directNum) && String(directNum) === str && directNum > 0) {
      if (this.prisma) {
        const exists = await this.prisma.customer.findFirst({
          where: { id: directNum, deletedAt: null },
          select: { id: true },
        });
        if (exists) return exists.id;
      } else {
        return directNum;
      }
    }

    // 2. Formatted code patterns (e.g., QB-CUST-011, QB-CADMIN-011, CUST-011, T001, etc.)
    const qbMatch = str.match(/^(?:QB-)?(?:CUST|CADMIN|USER|EMP|ADMIN|CUSTOMER|CLIENT|TENANT)?[_-]?0*([0-9]+)$/i) ||
                    str.match(/^T0*([0-9]+)$/i);
    if (qbMatch && qbMatch[1]) {
      const extractedNum = parseInt(qbMatch[1], 10);
      if (!isNaN(extractedNum) && extractedNum > 0) {
        if (this.prisma) {
          const exists = await this.prisma.customer.findFirst({
            where: { id: extractedNum, deletedAt: null },
            select: { id: true },
          });
          if (exists) return exists.id;
        } else {
          return extractedNum;
        }
      }
    }

    // 3. Database attribute lookup (domain, email, name, companyName, etc.)
    if (this.prisma) {
      const byAttr = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { domain: str },
            { email: str },
            { name: { equals: str, mode: 'insensitive' } },
            { companyName: { equals: str, mode: 'insensitive' } },
            { phone: str },
          ],
          deletedAt: null,
        },
        select: { id: true },
      });
      if (byAttr) return byAttr.id;
    }

    return undefined;
  }

  private isDirectAlias(str: string, authPk: number, customer?: any): boolean {
    const s = str.trim().toLowerCase();
    if (s === String(authPk)) return true;

    if (customer) {
      if (customer.domain && s === customer.domain.toLowerCase()) return true;
      if (customer.email && s === customer.email.toLowerCase()) return true;
      if (customer.name && s === customer.name.toLowerCase()) return true;
      if (customer.companyName && s === customer.companyName.toLowerCase()) return true;
    }

    const qbMatch = s.match(/^(?:qb-)?(?:cust|cadmin|user|emp|admin|customer|client|tenant)?[_-]?0*([0-9]+)$/) ||
                    s.match(/^t0*([0-9]+)$/);
    if (qbMatch && qbMatch[1]) {
      const num = parseInt(qbMatch[1], 10);
      if (num === authPk) return true;
    }

    return (
      s === `cust-${authPk}` ||
      s === `cust_${authPk}` ||
      s === `cust${authPk}` ||
      s === `cust-${String(authPk).padStart(3, '0')}` ||
      s === `cust-${String(authPk).padStart(2, '0')}` ||
      s === `qb-cust-${String(authPk).padStart(3, '0')}` ||
      s === `qb-cust-${authPk}` ||
      s === `qb-cadmin-${String(authPk).padStart(3, '0')}` ||
      s === `qb-cadmin-${authPk}`
    );
  }
}
