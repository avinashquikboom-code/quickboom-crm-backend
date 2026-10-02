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

  it('should include CUSTOMER_MARKETING for a customer even if designation role lacked it in legacy DB rows', async () => {
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
            // Simulated legacy DB role permissions that only had CUSTOMER_HOME and CUSTOMER_PLANS
            rolePermissions: [
              { permission: { module: 'CUSTOMER_HOME', action: 'VIEW' } },
              { permission: { module: 'CUSTOMER_PLANS', action: 'VIEW' } },
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
});
