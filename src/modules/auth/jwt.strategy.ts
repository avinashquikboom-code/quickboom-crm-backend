import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleType } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => {
          const rawHeader = req?.headers?.authorization || req?.headers?.Authorization;
          if (typeof rawHeader === 'string') {
            const match = rawHeader.match(/^Bearer\s+(.+)$/i);
            if (match) {
              return match[1].replace(/^["']|["']$/g, '').trim();
            }
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'quikboom_super_secret_jwt_access_key_2026',
    });
  }

  async validate(payload: any) {
    const rawUserId = payload.sub ?? payload.id ?? payload.userId;
    const userId = Number(rawUserId);

    if (!userId || isNaN(userId)) {
      this.logger.warn('[JWT_STRATEGY] Token rejected: Missing or invalid subject ID');
      throw new UnauthorizedException('Invalid token payload: missing subject');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: true,
        customer: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive || user.deletedAt) {
      this.logger.warn(`[JWT_STRATEGY] User ${userId} is inactive, deleted, or missing`);
      throw new UnauthorizedException('User account is inactive or no longer exists.');
    }

    const payloadRole = payload.role ? String(payload.role).toUpperCase() : '';
    const isCustomerAccount =
      payloadRole === 'CUSTOMER' ||
      payloadRole === 'CUSTOMER_ADMIN' ||
      payloadRole === 'COMPANY_ADMIN' ||
      user.customer != null;

    const tokenIsEmployee =
      !isCustomerAccount &&
      (payloadRole === 'EMPLOYEE' ||
        (payload.roleType === RoleType.CUSTOM && user.employee != null));

    if (tokenIsEmployee) {
      if (!user.employee || user.employee.status !== 'ACTIVE' || user.employee.mobileLoginEnabled === false) {
        this.logger.warn(`[JWT_STRATEGY] Employee record for user ${userId} is missing or inactive`);
        throw new UnauthorizedException('Employee account is inactive or no longer exists.');
      }
    }

    const roles: string[] = (user.userRoles || [])
      .map((ur) => ur.role?.type || ur.role?.name)
      .filter(Boolean);

    // Platform super-admin resolution
    const isSuperAdmin = user.userRoles?.some((ur) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCustomerAdmin =
      !isSuperAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('CUSTOMERADMINISTRATOR')
        );
      });

    const isCompanyAdmin =
      !isSuperAdmin &&
      !isCustomerAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('TENANTADMIN') ||
          name.includes('COMPANYADMINISTRATOR')
        );
      });

    if (isSuperAdmin && !roles.includes(RoleType.SUPER_ADMIN) && !roles.includes('SUPER_ADMIN')) {
      roles.push(RoleType.SUPER_ADMIN);
      roles.push('SUPER_ADMIN');
    }

    if (isCustomerAdmin && !roles.includes(RoleType.CUSTOMER_ADMIN) && !roles.includes('CUSTOMER_ADMIN')) {
      roles.push(RoleType.CUSTOMER_ADMIN);
      roles.push('CUSTOMER_ADMIN');
    }

    if (isCompanyAdmin && !roles.includes(RoleType.TENANT_ADMIN) && !roles.includes('COMPANY_ADMIN')) {
      roles.push(RoleType.TENANT_ADMIN);
      roles.push('COMPANY_ADMIN');
    }

    const permissionsMap = new Map();

    (user.userRoles || []).forEach((ur) => {
      if (ur.role?.rolePermissions) {
        ur.role.rolePermissions.forEach((rp) => {
          if (rp.permission) {
            const key = `${rp.permission.module}:${rp.permission.action}`;
            permissionsMap.set(key, {
              module: rp.permission.module,
              action: rp.permission.action,
            });
          }
        });
      }
    });

    const isEmployee =
      !isSuperAdmin &&
      !isCustomerAdmin &&
      !isCompanyAdmin &&
      Boolean(
        tokenIsEmployee ||
        (user.employee && user.employee.status === 'ACTIVE') ||
        user.userRoles?.some((ur) => {
          const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return (
            type === RoleType.SALES_EXECUTIVE ||
            type === RoleType.SALES_MANAGER ||
            type === RoleType.SUPPORT_AGENT ||
            name.includes('EMPLOYEE') ||
            name.includes('STAFF') ||
            name.includes('PHOTOGRAPHER') ||
            name.includes('EDITOR') ||
            name.includes('DESIGNER')
          );
        })
      );

    if (isEmployee && !roles.includes('EMPLOYEE')) {
      roles.push('EMPLOYEE');
    }

    let primaryRole: string;
    let primaryRoleType: string;
    if (isSuperAdmin) {
      primaryRole = 'SUPER_ADMIN';
      primaryRoleType = RoleType.SUPER_ADMIN;
    } else if (isCustomerAdmin) {
      primaryRole = 'CUSTOMER_ADMIN';
      primaryRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isCompanyAdmin) {
      primaryRole = 'COMPANY_ADMIN';
      primaryRoleType = RoleType.TENANT_ADMIN;
    } else if (isEmployee) {
      primaryRole = 'EMPLOYEE';
      primaryRoleType = RoleType.CUSTOM;
    } else {
      primaryRole = 'CUSTOMER';
      primaryRoleType = RoleType.CUSTOM;
    }

    const primaryRoleRecord = user.userRoles?.[0]?.role;
    const roleId = payload.roleId || primaryRoleRecord?.id || (user.userRoles?.[0]?.roleId ?? null);

    let customerId =
      user.customerId ??
      user.employee?.customerId ??
      user.customer?.id ??
      (payload.customerId ? Number(payload.customerId) : null);

    if (!customerId && !isSuperAdmin && this.prisma) {
      const cust = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { users: { some: { id: user.id } } },
            { employees: { some: { userId: user.id } } },
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.phone ? [{ phone: user.phone }] : []),
          ],
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (cust) {
        customerId = cust.id;
      }
    }

    const customerCode = customerId ? `QB-CUST-${String(customerId).padStart(3, '0')}` : 'NONE';
    this.logger.log(
      `[AUTH_DEBUG]\nuserId: ${user.id}\ncustomerId: ${customerId ?? 'NONE'}\ncustomerCode: ${customerCode}\nrole: ${primaryRole}\nemail: ${user.email}`,
    );

    return {
      id: user.id,
      email: user.email,
      customerId: customerId,
      customerCode: customerCode,
      firstName: user.firstName,
      lastName: user.lastName,
      role: primaryRole,
      roleId: roleId,
      roleType: primaryRoleType,
      roles: Array.from(new Set([primaryRole, primaryRoleType, ...roles])),
      permissions: Array.from(permissionsMap.values()),
      employee: user.employee || null,
      customer: user.customer || null,
    };
  }
}