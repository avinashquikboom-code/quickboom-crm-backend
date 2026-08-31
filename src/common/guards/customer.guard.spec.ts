import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerGuard } from './customer.guard';

describe('CustomerGuard - Customer ID Resolution & Cross-Customer Protection', () => {
  const mockDbCustomers = [
    { id: 16, name: 'Target Customer', domain: 'target.com', email: 'cust16@target.com', companyName: 'Target Corp', isActive: true, deletedAt: null },
    { id: 17, name: 'Other Customer', domain: 'other.com', email: 'cust17@other.com', companyName: 'Other Corp', isActive: true, deletedAt: null },
    { id: 303, name: 'Inactive Customer', domain: 'inactive.com', email: 'cust303@inactive.com', companyName: 'Inactive Corp', isActive: false, deletedAt: null },
  ];

  const mockPrisma = {
    customer: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        let found = mockDbCustomers.find((c) => {
          if (where.deletedAt === null && c.deletedAt !== null) return false;
          if (where.id !== undefined && c.id !== where.id) return false;
          if (where.isActive === true && !c.isActive) return false;
          if (where.domain && c.domain !== where.domain) return false;
          if (where.email && c.email !== where.email) return false;
          if (where.OR && Array.isArray(where.OR)) {
            const matchOr = where.OR.some((clause: any) => {
              if (clause.domain && c.domain === clause.domain) return true;
              if (clause.email && c.email === clause.email) return true;
              if (clause.name && clause.name.equals && c.name.toLowerCase() === clause.name.equals.toLowerCase()) return true;
              if (clause.companyName && clause.companyName.equals && c.companyName.toLowerCase() === clause.companyName.equals.toLowerCase()) return true;
              return false;
            });
            if (!matchOr) return false;
          }
          return true;
        });
        return Promise.resolve(found || null);
      }),
    },
  };

  let guard: CustomerGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new CustomerGuard(mockPrisma as any);
  });

  it('allows authenticated customer (id: 16) when query contains numeric customerId=16', async () => {
    const req: any = {
      user: { id: 15, email: 'user15@target.com', customerId: 16, role: 'CUSTOMER' },
      query: { customerId: '16', date: '2026-08-31' },
      headers: {},
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
    expect(req.customerId).toBe(16);
    expect(req.customerExternalId).toBe('QB-CUST-016');
  });

  it('allows authenticated customer (id: 16) when header contains code x-customer-id=QB-CUST-016', async () => {
    const req: any = {
      user: { id: 15, email: 'user15@target.com', customerId: 16, role: 'CUSTOMER' },
      query: {},
      headers: { 'x-customer-id': 'QB-CUST-016' },
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
    expect(req.customerId).toBe(16);
  });

  it('allows authenticated customer (id: 16) when BOTH query customerId=16 AND header x-customer-id=QB-CUST-016 are present', async () => {
    const req: any = {
      user: { id: 15, email: 'user15@target.com', customerId: 16, role: 'CUSTOMER' },
      query: { customerId: '16' },
      headers: { 'x-customer-id': 'QB-CUST-016' },
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
    expect(req.customerId).toBe(16);
  });

  it('strictly rejects when customer 16 attempts to access customer 17 via query param customerId=17', async () => {
    const req: any = {
      user: { id: 15, email: 'user15@target.com', customerId: 16, role: 'CUSTOMER' },
      query: { customerId: '17' },
      headers: {},
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(context);
    } catch (e: any) {
      expect(e.message).toBe('Cross-customer access forbidden');
      expect(e.getStatus()).toBe(403);
    }
  });

  it('strictly rejects when customer 16 attempts to access customer 17 via header x-customer-id=QB-CUST-017', async () => {
    const req: any = {
      user: { id: 15, email: 'user15@target.com', customerId: 16, role: 'CUSTOMER' },
      query: {},
      headers: { 'x-customer-id': 'QB-CUST-017' },
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(context);
    } catch (e: any) {
      expect(e.message).toBe('Cross-customer access forbidden');
      expect(e.getStatus()).toBe(403);
    }
  });

  it('rejects when authenticated customer is deactivated (isActive = false)', async () => {
    const req: any = {
      user: { id: 35, email: 'user35@inactive.com', customerId: 303, role: 'CUSTOMER' },
      query: {},
      headers: {},
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(context);
    } catch (e: any) {
      expect(e.message).toBe('Customer record not found or deactivated');
    }
  });

  it('rejects when user has no customer context', async () => {
    const req: any = {
      user: { id: 99, email: 'orphan@test.com', customerId: null, role: 'CUSTOMER' },
      query: {},
      headers: {},
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(context);
    } catch (e: any) {
      expect(e.message).toBe('User does not belong to any customer');
    }
  });
});
