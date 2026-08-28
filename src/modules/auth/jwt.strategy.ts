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
    const isSuperAdmin = user.userRoles?.some(
      (ur) =>
        ur.role?.type === RoleType.SUPER_ADMIN ||
        ur.roleId === 2 ||
        ur.role?.name?.toUpperCase() === 'SUPER ADMINISTRATOR' ||
        ur.role?.name?.toUpperCase() === 'SUPER_ADMIN' ||
        ur.role?.name?.toUpperCase() === 'SUPER ADMIN',
    );

    if (isSuperAdmin && !roles.includes(RoleType.SUPER_ADMIN) && !roles.includes('SUPER_ADMIN')) {
      roles.push(RoleType.SUPER_ADMIN);
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

    let primaryRole: string;
    if (isSuperAdmin) {
      primaryRole = 'SUPER_ADMIN';
    } else if (
      user.userRoles?.some(
        (ur) =>
          ur.role?.type === RoleType.CUSTOMER_ADMIN ||
          ur.roleId === 5 ||
          ur.role?.type === RoleType.TENANT_ADMIN ||
          ur.role?.name?.toUpperCase().includes('COMPANY_ADMIN') ||
          ur.role?.name?.toUpperCase().includes('CUSTOMER ADMINISTRATOR') ||
          ur.role?.name?.toUpperCase().includes('ADMIN'),
      )
    ) {
      primaryRole = 'COMPANY_ADMIN';
    } else if (
      user.userRoles?.some(
        (ur) =>
          ur.roleId === 4 ||
          ur.role?.name?.toUpperCase().includes('EMPLOYEE') ||
          ur.role?.type === RoleType.SALES_EXECUTIVE ||
          ur.role?.type === RoleType.SALES_MANAGER,
      )
    ) {
      primaryRole = 'EMPLOYEE';
    } else {
      primaryRole = user.customerId ? 'CUSTOMER' : 'CUSTOMER';
    }

    return {
      id: user.id,
      email: user.email,
      customerId: user.customerId,
      firstName: user.firstName,
      lastName: user.lastName,
      role: primaryRole,
      roles: roles.length > 0 ? roles : [primaryRole],
      permissions: Array.from(permissionsMap.values()),
    };
  }
}

