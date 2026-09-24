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
    await this.ensureDatabaseSchema();
    await this.ensureSuperAdminRole();
  }

  private async ensureDatabaseSchema() {
    try {
      this.logger.log('Checking and ensuring critical database schema alignment...');

      // 1. Ensure "Lead"."socialMedia" column exists
      await this.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "socialMedia" JSONB;`);

      // 2. Ensure "lead_images" table exists
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "lead_images" (
          "id" SERIAL PRIMARY KEY,
          "leadId" INTEGER NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "url" TEXT NOT NULL,
          "key" TEXT,
          "caption" TEXT,
          "isPrimary" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 3. Ensure "isPrimary" column and indexes on "lead_images"
      await this.$executeRawUnsafe(`ALTER TABLE "lead_images" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;`);
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "lead_images_leadId_idx" ON "lead_images"("leadId");`);
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "lead_images_leadId_isPrimary_idx" ON "lead_images"("leadId", "isPrimary");`);

      // 4. Ensure commission enums and tables exist safely
      await this.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionType') THEN
            CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionConfigStatus') THEN
            CREATE TYPE "CommissionConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionStatus') THEN
            CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED');
          END IF;
        END $$;
      `);

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "commission_configs" (
          "id" SERIAL PRIMARY KEY,
          "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "employeeId" INTEGER NOT NULL UNIQUE REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
          "commissionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "status" "CommissionConfigStatus" NOT NULL DEFAULT 'ACTIVE',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "commissions" (
          "id" SERIAL PRIMARY KEY,
          "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "leadId" INTEGER REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
          "planId" INTEGER REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
          "purchase_id" INTEGER UNIQUE REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
          "order_id" TEXT,
          "commissionType" "CommissionType" NOT NULL,
          "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "purchaseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "commissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
          "paidAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.logger.log('Database schema alignment verified successfully.');
    } catch (err: any) {
      this.logger.error(`ensureDatabaseSchema non-fatal warning: ${err?.message || err}`);
    }
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

        // Ensure name is 'Super Admin'
        if (adminUser.firstName !== 'Super' || adminUser.lastName !== 'Admin') {
          await this.user.update({
            where: { id: adminUser.id },
            data: { firstName: 'Super', lastName: 'Admin' },
          });
          this.logger.log(`Updated user name for ${adminUser.email} to Super Admin`);
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
