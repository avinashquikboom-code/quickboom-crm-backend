import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUserSuperAdmin, isUserAdminOrStaff } from '../utils/role.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerGuard implements CanActivate {
  private readonly logger = new Logger(CustomerGuard.name);

  constructor(
    private prisma?: PrismaService,
    @Optional() private reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector) {
      const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) {
        return true;
      }
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (user.role === 'EMPLOYEE') {
      const portalType = request.headers?.['x-portal-type'] || request.headers?.['X-Portal-Type'];
      const clientType = request.headers?.['x-client-type'] || request.headers?.['X-Client-Type'];
      const isEmployeeWeb = portalType === 'employee-web' || (clientType === 'admin' && user.role === 'EMPLOYEE');
      if (isEmployeeWeb && !user.isBpo) {
        throw new ForbiddenException('Employee Workspace is available only for BPO employees.');
      }
    }

    const headerCustomerId = request.headers['x-customer-id'] || request.headers['x-target-customer-id'];
    const queryCustomerId = request.query?.customerId || request.query?.clientId;
    const requestedIdentifier = queryCustomerId || headerCustomerId;

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdminOrStaff = isUserAdminOrStaff(user);

    // ── 1. SUPER_ADMIN & GLOBAL ADMIN / STAFF ACCESS ─────────────────────────
    if (isSuperAdmin || (isAdminOrStaff && (user.customerId == null || user.customerId === 0))) {
      request.isSuperAdmin = isSuperAdmin;
      request.isAdminOrStaff = isAdminOrStaff;

      if (requestedIdentifier) {
        const resolvedId = await this.resolveCustomerPk(requestedIdentifier);

        this.logger.log(`[CUSTOMER_GUARD_DEBUG]
userId: ${user.id}
user.email: ${user.email}
user.role: ${user.role || (Array.isArray(user.roles) ? user.roles.join(',') : 'ADMIN')}
user.customerId: ${user.customerId}
user.customerCode: ${user.customerCode || 'NONE'}
headerCustomerId: ${headerCustomerId || 'NONE'}
queryCustomerId: ${queryCustomerId || 'NONE'}
resolvedRequestedCustomerId: ${resolvedId ?? 'NOT_FOUND'}
resolvedAuthenticatedCustomerId: ${user.customerId ?? 'ADMIN'}
requestedCustomerIdentifierType: ${typeof requestedIdentifier}
authenticatedCustomerIdentifierType: ${typeof user.customerId}
authorization: ALLOWED (ADMIN)`);

        if (resolvedId === undefined) {
          if (this.prisma) {
            throw new NotFoundException(`Customer record not found for requested customer identifier: ${requestedIdentifier}`);
          } else {
            // Unit test fallback
            request.customerId = typeof requestedIdentifier === 'number' ? requestedIdentifier : parseInt(requestedIdentifier, 10) || requestedIdentifier;
            request.customerExternalId = String(requestedIdentifier);
            return true;
          }
        }

        request.customerId = resolvedId;
        request.customerExternalId = String(requestedIdentifier);
      } else {
        request.customerId = user.customerId ? Number(user.customerId) : undefined;
      }
      return true;
    }

    // ── 2. NORMAL CUSTOMER TENANT ACCESS ─────────────────────────────────────
    this.logger.log(
      `[CUSTOMER_GUARD_DEBUG]\nuserId: ${user?.id ?? 'NONE'}\nuserCustomerId: ${user?.customerId ?? 'NONE'}\nuserCustomerCode: ${user?.customerCode ?? 'NONE'}\nqueryCustomerId: ${queryCustomerId ?? 'NONE'}\nheaderCustomerId: ${headerCustomerId ?? 'NONE'}\nrole: ${user?.role ?? 'CUSTOMER'}`,
    );

    let authCustomerPk: number | undefined;
    if (user?.customerId != null && Number(user.customerId) > 0) {
      authCustomerPk = Number(user.customerId);
    }

    let customer: any = null;
    let customerExists = false;
    let customerActive = false;
    let customerDeleted = false;

    if (this.prisma) {
      if (authCustomerPk) {
        const rawCustomer = await this.prisma.customer.findFirst({
          where: { id: authCustomerPk },
          select: { id: true, name: true, domain: true, email: true, companyName: true, isActive: true, deletedAt: true },
        });
        if (rawCustomer) {
          customerExists = true;
          customerActive = rawCustomer.isActive !== false;
          customerDeleted = Boolean(rawCustomer.deletedAt);
          if (!rawCustomer.deletedAt) {
            customer = rawCustomer;
          }
        }
      }

      // Fallback: lookup customer by user ID or user email via relationship
      if (!customer && user.id) {
        const rawCustomer = await this.prisma.customer.findFirst({
          where: {
            OR: [
              { users: { some: { id: user.id } } },
              { employees: { some: { userId: user.id } } },
              ...(user.email ? [{ email: user.email }, { users: { some: { email: user.email } } }, { employees: { some: { email: user.email } } }] : []),
              ...(user.phone ? [{ phone: user.phone }, { employees: { some: { phone: user.phone } } }] : []),
            ],
          },
          select: { id: true, name: true, domain: true, email: true, companyName: true, isActive: true, deletedAt: true },
        });
        if (rawCustomer) {
          customerExists = true;
          customerActive = rawCustomer.isActive !== false;
          customerDeleted = Boolean(rawCustomer.deletedAt);
          if (!rawCustomer.deletedAt) {
            customer = rawCustomer;
            authCustomerPk = rawCustomer.id;
          }
        }
      }

      if (!customerExists && !authCustomerPk) {
        throw new ForbiddenException('User does not belong to any customer');
      }

      if (!customerExists || customerDeleted || !customerActive) {
        throw new ForbiddenException('Customer record not found or deactivated');
      }
    } else {
      // Fallback for isolated unit tests without Prisma
      customerExists = authCustomerPk != null && authCustomerPk > 0;
      customerActive = customerExists;
      customerDeleted = false;
      if (!customerExists) {
        throw new ForbiddenException('User does not belong to any customer');
      }
    }

    if (authCustomerPk == null || authCustomerPk <= 0) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    const authCustomerCode = `QB-CUST-${String(authCustomerPk).padStart(3, '0')}`;

    // Resolve and validate header x-customer-id
    let resolvedHeaderPk: number | undefined;
    if (headerCustomerId) {
      const headerStr = String(headerCustomerId).trim();
      resolvedHeaderPk = await this.resolveCustomerPk(headerStr);
      if (resolvedHeaderPk === undefined && this.isDirectAlias(headerStr, authCustomerPk, customer)) {
        resolvedHeaderPk = authCustomerPk;
      }
      if (resolvedHeaderPk === undefined || resolvedHeaderPk !== authCustomerPk) {
        const path = (request.originalUrl || request.url || '').toLowerCase();
        if (
          path.includes('/employees/me') ||
          path.includes('/employees/permissions/me') ||
          path.includes('/permissions/me') ||
          path.includes('/lead-generation-limits/me')
        ) {
          this.logger.warn(
            `[CustomerGuard] Ignoring mismatched header customerId (${headerStr}) for self employee route: ${path}`,
          );
          resolvedHeaderPk = authCustomerPk;
        } else {
          throw new ForbiddenException('Cross-customer access forbidden');
        }
      }
    }

    // Resolve and validate query customerId
    let resolvedQueryPk: number | undefined;
    if (queryCustomerId) {
      const queryStr = String(queryCustomerId).trim();
      resolvedQueryPk = await this.resolveCustomerPk(queryStr);
      if (resolvedQueryPk === undefined && this.isDirectAlias(queryStr, authCustomerPk, customer)) {
        resolvedQueryPk = authCustomerPk;
      }
      if (resolvedQueryPk === undefined || resolvedQueryPk !== authCustomerPk) {
        const path = (request.originalUrl || request.url || '').toLowerCase();
        if (
          path.includes('/employees/me') ||
          path.includes('/employees/permissions/me') ||
          path.includes('/permissions/me') ||
          path.includes('/lead-generation-limits/me')
        ) {
          this.logger.warn(
            `[CustomerGuard] Ignoring mismatched query customerId (${queryStr}) for self employee route: ${path}`,
          );
          resolvedQueryPk = authCustomerPk;
        } else {
          throw new ForbiddenException('Cross-customer access forbidden');
        }
      }
    }

    const resolvedRequestedCustomerId = resolvedQueryPk ?? resolvedHeaderPk ?? authCustomerPk;
    const requestedId = queryCustomerId ?? headerCustomerId ?? (authCustomerPk ? String(authCustomerPk) : 'NONE');

    this.logger.log(
      `[CUSTOMER_LOOKUP]\nrequestedId: ${requestedId}\nresolvedCustomerId: ${resolvedRequestedCustomerId}\ncustomerCode: ${authCustomerCode}\nisActive: ${customerActive}\nstatus: ${customerActive ? 'ACTIVE' : 'INACTIVE'}\ndeletedAt: ${customerDeleted ? 'DELETED' : 'null'}`,
    );

    this.logger.log(
      `[CustomerGuard DEBUG]\nuser.id: ${user?.id ?? 'NONE'}\nuser.customerId: ${user?.customerId ?? 'NONE'}\nuser.customerCode: ${user?.customerCode ?? authCustomerCode}\nuser.role: ${user?.role ?? 'CUSTOMER'}\n\nquery.customerId: ${queryCustomerId ?? 'NONE'}\nheader.x-customer-id: ${headerCustomerId ?? 'NONE'}\n\nresolvedAuthenticatedCustomerId: ${authCustomerPk}\nresolvedRequestedCustomerId: ${resolvedRequestedCustomerId}\n\ncustomerExists: ${customerExists}\ncustomerActive: ${customerActive}\ncustomerDeleted: ${customerDeleted}`,
    );

    request.customerId = authCustomerPk;
    request.customerExternalId = authCustomerCode;
    return true;
  }

  private async resolveCustomerPk(rawId: any): Promise<number | undefined> {
    if (rawId == null) return undefined;
    const str = String(rawId).trim();
    if (!str || str === 'null' || str === 'undefined') return undefined;

    // 1. Direct integer check
    const directNum = parseInt(str, 10);
    if (!isNaN(directNum) && String(directNum) === str && directNum > 0) {
      if (this.prisma) {
        const exists = await this.prisma.customer.findFirst({
          where: { id: directNum, deletedAt: null },
          select: { id: true, isActive: true },
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
            select: { id: true, isActive: true },
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
        select: { id: true, isActive: true },
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
