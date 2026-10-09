import { resolveCustomerAppPermissionItems } from './customer-app-permissions.util';
import { ROLE_PERMISSION_DEFAULTS } from '../constants/rbac.constants';

describe('Customer App Permissions Resolution', () => {
  it('should include CUSTOMER_MARKETING by default when no customerId or db role found', async () => {
    const items = await resolveCustomerAppPermissionItems(null, null);
    const hasMarketing = items.some(
      (i) => i.module === 'CUSTOMER_MARKETING' && i.action === 'VIEW',
    );
    expect(hasMarketing).toBe(true);
  });

  it('should respect saved designation role permissions and not force unassigned defaults', async () => {
    const mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          mobileRoleId: null,
          moduleOverrides: [],
        }),
      },
      designation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          code: 'CUSTOMER',
          role: {
            rolePermissions: [
              { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
              { permission: { module: 'CUSTOMER_PLANS', action: 'VIEW' } },
            ],
          },
        }),
      },
    };

    const items = await resolveCustomerAppPermissionItems(mockPrisma, 10);
    const hasHome = items.some(
      (i) => i.module === 'CUSTOMER_HOME' && i.action === 'VIEW',
    );
    const hasPlans = items.some(
      (i) => i.module === 'CUSTOMER_PLANS' && i.action === 'VIEW',
    );
    const hasMarketing = items.some(
      (i) => i.module === 'CUSTOMER_MARKETING' && i.action === 'VIEW',
    );
    expect(hasHome).toBe(true);
    expect(hasPlans).toBe(true);
    expect(hasMarketing).toBe(false);
  });

  it('should respect DENY override for CUSTOMER_MARKETING', async () => {
    const mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          mobileRoleId: null,
          moduleOverrides: [
            {
              moduleKey: 'CUSTOMER_MARKETING',
              override: 'DENY',
            },
          ],
        }),
      },
      designation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          code: 'CUSTOMER',
          role: {
            rolePermissions: [
              { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
            ],
          },
        }),
      },
    };

    const items = await resolveCustomerAppPermissionItems(mockPrisma, 10);
    const hasMarketing = items.some(
      (i) => i.module === 'CUSTOMER_MARKETING' && i.action === 'VIEW',
    );
    expect(hasMarketing).toBe(false);
  });

  it('should respect ALLOW override even when omitted in base designation role', async () => {
    const mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          mobileRoleId: null,
          moduleOverrides: [
            {
              moduleKey: 'CUSTOMER_MARKETING',
              override: 'ALLOW',
            },
          ],
        }),
      },
      designation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          code: 'CUSTOMER',
          role: {
            rolePermissions: [
              { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
            ],
          },
        }),
      },
    };

    const items = await resolveCustomerAppPermissionItems(mockPrisma, 10);
    const hasMarketing = items.some(
      (i) => i.module === 'CUSTOMER_MARKETING' && i.action === 'VIEW',
    );
    expect(hasMarketing).toBe(true);
  });

  it('uses the company Customer role and does not grant Influencer Hub from an older client role', async () => {
    const mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 42,
          mobileRoleId: null,
          moduleOverrides: [],
        }),
      },
      designation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            customer: { _count: { employees: 0 } },
            role: {
              permissionsUpdatedAt: new Date('2020-01-01'),
              rolePermissions: [
                { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
                { permission: { module: 'CUSTOMER_INFLUENCERS', action: 'VIEW' } },
              ],
            },
          },
          {
            id: 8,
            customer: { _count: { employees: 4 } },
            role: {
              permissionsUpdatedAt: new Date('2026-10-01'),
              rolePermissions: [
                { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
                { permission: { module: 'CUSTOMER_PLANS', action: 'VIEW' } },
              ],
            },
          },
        ]),
      },
    };

    const items = await resolveCustomerAppPermissionItems(mockPrisma, 42);
    expect(items.some((i) => i.module === 'CUSTOMER_HOME' && i.action === 'VIEW')).toBe(true);
    expect(items.some((i) => i.module === 'CUSTOMER_INFLUENCERS')).toBe(false);
  });
});

