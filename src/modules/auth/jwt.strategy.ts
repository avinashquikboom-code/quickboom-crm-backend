import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleType } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
      throw new UnauthorizedException('User account inactive or missing');
    }

    const roles: string[] = user.userRoles.map((ur) => ur.role.type);

    // Fallback: If no explicit userRoles but user is platform super-admin
    if (roles.length === 0 && (user.customerId === null || user.email === 'admin@quikboom.com')) {
      roles.push(RoleType.SUPER_ADMIN);
    }

    const permissionsMap = new Map();

    user.userRoles.forEach((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        const key = `${rp.permission.module}:${rp.permission.action}`;
        permissionsMap.set(key, {
          module: rp.permission.module,
          action: rp.permission.action,
        });
      });
    });

    const primaryRole = roles[0] || (user.customerId ? RoleType.CUSTOMER_ADMIN : RoleType.SUPER_ADMIN);

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
