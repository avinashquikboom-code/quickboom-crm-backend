import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

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
    const user = await this.prisma.user.findUnique({
      where: { id: Number(payload.sub) },
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

    const roles = user.userRoles.map((ur) => ur.role.type);
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

    return {
      id: user.id,
      email: user.email,
      customerId: user.customerId,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions: Array.from(permissionsMap.values()),
    };
  }
}
