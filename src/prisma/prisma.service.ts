import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, RoleType } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.ensureSuperAdminRole();
  }

  private async ensureSuperAdminRole() {
    try {
      // 1. Ensure SUPER_ADMIN role exists in database
      let superAdminRole = await this.role.findFirst({
        where: { type: RoleType.SUPER_ADMIN },
      });

      if (!superAdminRole) {
        superAdminRole = await this.role.create({
          data: {
            name: 'Super Administrator',
            type: RoleType.SUPER_ADMIN,
            description: 'Platform Super Administrator with full system control',
          },
        });
        this.logger.log('Created SUPER_ADMIN role record');
      }

      // 2. If admin@quikboom.com exists in DB, ensure its role link is SUPER_ADMIN
      const adminUser = await this.user.findUnique({
        where: { email: 'admin@quikboom.com' },
        include: { userRoles: { include: { role: true } } },
      });

      if (adminUser) {
        const hasSuperAdminRole = adminUser.userRoles.some(
          (ur) => ur.role?.type === RoleType.SUPER_ADMIN
        );

        if (!hasSuperAdminRole && superAdminRole) {
          // Remove old role links and assign SUPER_ADMIN
          await this.userRole.deleteMany({
            where: { userId: adminUser.id },
          });

          await this.userRole.create({
            data: {
              userId: adminUser.id,
              roleId: superAdminRole.id,
            },
          });

          // Also update role table records named 'Customer Administrator' if they were the primary role
          await this.role.updateMany({
            where: { name: 'Customer Administrator' },
            data: { type: RoleType.SUPER_ADMIN },
          });

          this.logger.log(`Synced role for ${adminUser.email} to SUPER_ADMIN`);
        }
      }
    } catch (err) {
      this.logger.warn(`ensureSuperAdminRole caught non-fatal warning: ${err?.message || err}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Soft delete helper query middleware / extension
  async softDelete(model: string, id: string) {
    return (this as any)[model].update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
