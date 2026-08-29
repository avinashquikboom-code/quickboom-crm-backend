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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
      throw new UnauthorizedException('User account inactive or missing');
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

    const isCompanyAdmin =
      !isSuperAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('TENANTADMIN')
        );
      });

    if (isSuperAdmin && !roles.includes(RoleType.SUPER_ADMIN) && !roles.includes('SUPER_ADMIN')) {
      roles.push(RoleType.SUPER_ADMIN);
      roles.push('SUPER_ADMIN');
    }

    if (isCompanyAdmin && !roles.includes(RoleType.CUSTOMER_ADMIN) && !roles.includes('CUSTOMER_ADMIN')) {
      roles.push(RoleType.CUSTOMER_ADMIN);
      roles.push('CUSTOMER_ADMIN');
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
      !isCompanyAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.SALES_EXECUTIVE ||
          type === RoleType.SALES_MANAGER ||
          name.includes('EMPLOYEE') ||
          name.includes('STAFF')
        );
      });

    let primaryRole: string;
    let primaryRoleType: string;
    if (isSuperAdmin) {
      primaryRole = 'SUPER_ADMIN';
      primaryRoleType = RoleType.SUPER_ADMIN;
    } else if (isCompanyAdmin) {
      primaryRole = 'COMPANY_ADMIN';
      primaryRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isEmployee) {
      primaryRole = 'EMPLOYEE';
      primaryRoleType = RoleType.CUSTOM;
    } else {
      primaryRole = 'CUSTOMER';
      primaryRoleType = RoleType.CUSTOM;
    }

    const primaryRoleRecord = user.userRoles?.[0]?.role;
    const roleId = payload.roleId || primaryRoleRecord?.id || (user.userRoles?.[0]?.roleId ?? null);

    return {
      id: user.id,
      email: user.email,
      customerId: user.customerId,
      firstName: user.firstName,
      lastName: user.lastName,
      role: primaryRole,
      roleId: roleId,
      roleType: primaryRoleType,
      roles: Array.from(new Set([primaryRole, primaryRoleType, ...roles])),
      permissions: Array.from(permissionsMap.values()),
    };
  }
}

