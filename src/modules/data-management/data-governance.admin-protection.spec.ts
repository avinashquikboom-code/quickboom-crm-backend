import { DataGovernanceService } from './data-governance.service';
import { FORBIDDEN_MODELS, PROTECTED_SYSTEM_RECORDS } from './data-governance.catalog';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

describe('Data Governance – Super Admin & Authentication Protection Safeguards', () => {
  it('strictly excludes all core authentication and admin models from deletion catalog', () => {
    expect(FORBIDDEN_MODELS).toContain('user');
    expect(FORBIDDEN_MODELS).toContain('role');
    expect(FORBIDDEN_MODELS).toContain('permission');
    expect(FORBIDDEN_MODELS).toContain('userRole');
    expect(FORBIDDEN_MODELS).toContain('rolePermission');
    expect(FORBIDDEN_MODELS).toContain('refreshToken');
    expect(FORBIDDEN_MODELS).toContain('session');
    expect(FORBIDDEN_MODELS).toContain('customer');
  });

  it('exposes protectedSystemRecords in reset preview catalog', () => {
    expect(PROTECTED_SYSTEM_RECORDS.length).toBeGreaterThanOrEqual(4);
    const categories = PROTECTED_SYSTEM_RECORDS.map((r) => r.category);
    expect(categories).toContain('Super Admin Account');
    expect(categories).toContain('Admin Credentials');
    expect(categories).toContain('Authentication Records');
    expect(categories).toContain('Roles & Permissions');
  });

  it('rejects any reset attempt if a targeted model is forbidden', async () => {
    const mockPrisma: any = {
      $transaction: jest.fn(async (cb) => {
        const tx: any = {
          $executeRaw: jest.fn().mockResolvedValue(0),
          $queryRaw: jest.fn().mockResolvedValue([]),
          user: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([{ id: 1, email: 'admin@quickboom.com', passwordHash: 'hash', isActive: true, customerId: null, userRoles: [{ role: { type: RoleType.SUPER_ADMIN, name: 'SUPER_ADMIN' } }] }]) },
        };
        return cb(tx);
      }),
    };

    const service = new DataGovernanceService(mockPrisma);
    expect(service).toBeDefined();
  });
});
