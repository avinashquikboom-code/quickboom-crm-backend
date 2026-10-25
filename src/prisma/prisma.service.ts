import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
    await this.ensureSuperAdminUser();
  }

  private async ensureSuperAdminUser() {
    try {
      // If admin@quikboom.com exists in DB, ensure name is 'Super Admin'
      const adminUser = await this.user.findUnique({
        where: { email: 'admin@quikboom.com' },
      });

      if (adminUser) {
        if (adminUser.firstName !== 'Super' || adminUser.lastName !== 'Admin') {
          await this.user.update({
            where: { id: adminUser.id },
            data: { firstName: 'Super', lastName: 'Admin' },
          });
          this.logger.log(`Updated user name for ${adminUser.email} to Super Admin`);
        }
      }
    } catch (err) {
      this.logger.warn(`ensureSuperAdminUser caught non-fatal warning: ${err?.message || err}`);
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
