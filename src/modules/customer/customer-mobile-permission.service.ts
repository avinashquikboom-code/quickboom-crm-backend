import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessOverrideType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CUSTOMER_APP_PERMISSIONS, ROLE_PERMISSION_DEFAULTS } from '../../common/constants/rbac.constants';

const CUSTOMER_MODULE_LABELS: Record<string, string> = {
  CUSTOMER_HOME: 'Home',
  CUSTOMER_PLANS: 'Plans',
  CUSTOMER_TRENDING: 'Trending',
  CUSTOMER_ORDERS: 'Orders',
  CUSTOMER_INVOICES: 'Invoices',
  CUSTOMER_PROFILE: 'Profile',
  CUSTOMER_CALENDAR: 'Calendar',
  CUSTOMER_SSM: 'SSM',
  CUSTOMER_INFLUENCERS: 'Influencer Hub',
  CUSTOMER_INFLUENCER_BOOKINGS: 'Bookings',
  CUSTOMER_NOTIFICATIONS: 'Notifications',
  CUSTOMER_SUPPORT: 'Support',
  CUSTOMER_MARKETING: 'Marketing & Offers',
};

@Injectable()
export class CustomerMobilePermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissions(customerId: number) {
    let customer: any;
    try {
      customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        include: {
          mobileRole: {
            include: {
              role: { include: { rolePermissions: { include: { permission: true } } } },
            },
          },
          moduleOverrides: true,
        },
      });
    } catch {
      customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
      });
    }
    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found`);
    }

    const rolePermissions = new Set<string>();
    const collect = (rows: Array<{ permission?: { module: string; action: string } | null }>) => {
      for (const rp of rows) {
        if (rp.permission && String(rp.permission.module).toUpperCase().startsWith('CUSTOMER_')) {
          rolePermissions.add(`${rp.permission.module.toUpperCase()}:${rp.permission.action.toUpperCase()}`);
        }
      }
    };
    if (customer.mobileRoleId) {
      collect(customer.mobileRole?.role?.rolePermissions || []);
    } else {
      let ownRole = await this.prisma.designation.findFirst({
        where: { customerId, code: 'CUSTOMER', audience: 'CUSTOMER' },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      });
      if (!ownRole) {
        ownRole = await this.prisma.designation.findFirst({
          where: { code: 'CUSTOMER', audience: 'CUSTOMER' },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
          orderBy: { id: 'asc' },
        });
      }
      if (!ownRole) {
        ownRole = await this.prisma.designation.findFirst({
          where: { audience: 'CUSTOMER' },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
          orderBy: { id: 'asc' },
        });
      }
      if (ownRole?.role?.rolePermissions?.length) {
        collect(ownRole.role.rolePermissions);
      } else {
        for (const item of ROLE_PERMISSION_DEFAULTS.CUSTOMER || []) {
          rolePermissions.add(`${item.module}:${item.action}`);
        }
      }
    }

    const overrideMap = new Map<string, string>();
    for (const ov of customer.moduleOverrides || []) {
      overrideMap.set(String(ov.moduleKey).toLowerCase(), String(ov.override).toUpperCase());
    }

    const granularPermissions = CUSTOMER_APP_PERMISSIONS.map((perm) => {
      const permKey = `${perm.module}:${perm.action}`;
      const roleDefault = rolePermissions.has(permKey);
      const raw =
        overrideMap.get(perm.key.toLowerCase()) ||
        overrideMap.get(permKey.toLowerCase()) ||
        overrideMap.get(perm.module.toLowerCase()) ||
        'INHERIT';
      const override = raw === 'ALLOW' || raw === 'DENY' ? raw : 'INHERIT';
      let effective = roleDefault;
      if (override === 'ALLOW') effective = true;
      if (override === 'DENY') effective = false;
      return {
        key: perm.key,
        module: perm.module,
        action: perm.action,
        label: perm.label,
        description: perm.description,
        category: 'CUSTOMER',
        roleDefault,
        override,
        effective,
      };
    });

    const modules = Array.from(new Set(CUSTOMER_APP_PERMISSIONS.map((p) => p.module))).map((moduleKey) => {
      const rows = granularPermissions.filter((p) => p.module === moduleKey);
      const roleDefault = rows.some((p) => p.roleDefault);
      const explicit = rows.find((p) => p.override !== 'INHERIT');
      const override = explicit?.override || 'INHERIT';
      const effective = rows.some((p) => p.effective);
      const meta = CUSTOMER_APP_PERMISSIONS.find((p) => p.module === moduleKey);
      return {
        moduleKey,
        label: CUSTOMER_MODULE_LABELS[moduleKey] || meta?.label || moduleKey,
        category: 'CUSTOMER',
        description: meta?.description || '',
        roleDefault,
        override,
        effective,
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.companyName || customer.name,
      roleName: customer.mobileRole?.name || 'Customer',
      designationName: customer.mobileRole?.name || 'Customer',
      mobileRoleId: customer.mobileRoleId,
      customPermissionsEnabled: (customer.moduleOverrides || []).some(
        (ov) => ov.override === 'ALLOW' || ov.override === 'DENY',
      ),
      effectivePermissionsCount: granularPermissions.filter((p) => p.effective).length,
      modules,
      granularPermissions,
    };
  }

  async updatePermissions(
    customerId: number,
    overrides: Array<{ moduleKey: string; override: string }>,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException(`Customer #${customerId} not found`);

    for (const item of overrides || []) {
      const modKey = String(item.moduleKey || '').trim();
      if (!modKey) continue;
      const ovType = String(item.override || '').toUpperCase();
      if (ovType === 'INHERIT' || ovType === 'DEFAULT') {
        await this.prisma.customerModuleOverride.deleteMany({
          where: { subjectCustomerId: customerId, moduleKey: modKey },
        });
        continue;
      }
      if (ovType !== 'ALLOW' && ovType !== 'DENY') continue;
      const matches = CUSTOMER_APP_PERMISSIONS.filter(
        (p) =>
          p.key.toLowerCase() === modKey.toLowerCase() ||
          `${p.module}:${p.action}` === modKey.toUpperCase() ||
          p.module.toUpperCase() === modKey.toUpperCase(),
      );
      const targets = matches.length ? matches : [{ key: modKey, module: modKey, action: 'VIEW' }];
      for (const perm of targets) {
        const record = await this.prisma.permission.findUnique({
          where: { module_action: { module: perm.module, action: perm.action } },
        });
        const storedKey = matches.length ? perm.key : modKey;
        await this.prisma.customerModuleOverride.upsert({
          where: {
            subjectCustomerId_moduleKey: { subjectCustomerId: customerId, moduleKey: storedKey },
          },
          create: {
            subjectCustomerId: customerId,
            moduleKey: storedKey,
            override: ovType === 'ALLOW' ? AccessOverrideType.ALLOW : AccessOverrideType.DENY,
            permissionId: record?.id,
          },
          update: {
            override: ovType === 'ALLOW' ? AccessOverrideType.ALLOW : AccessOverrideType.DENY,
            permissionId: record?.id,
          },
        });
      }
    }

    return this.getPermissions(customerId);
  }

  async assignRole(customerId: number, mobileRoleId: number | null) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException(`Customer #${customerId} not found`);

    if (mobileRoleId) {
      const role = await this.prisma.designation.findFirst({
        where: {
          id: mobileRoleId,
          OR: [{ audience: 'CUSTOMER' }, { code: 'CUSTOMER' }],
        },
      });
      if (!role) throw new NotFoundException('Customer role not found');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { mobileRoleId },
    });
    return this.getPermissions(customerId);
  }

  async resetPermissions(customerId: number) {
    await this.prisma.customerModuleOverride.deleteMany({
      where: { subjectCustomerId: customerId },
    });
    return this.getPermissions(customerId);
  }

  async restrictAll(customerId: number) {
    const overrides = CUSTOMER_APP_PERMISSIONS.map((p) => ({
      moduleKey: p.key,
      override: 'DENY',
    }));
    return this.updatePermissions(customerId, overrides);
  }
}
