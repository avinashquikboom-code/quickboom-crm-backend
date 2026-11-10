import { FORBIDDEN_MODELS, RESET_MODULES, tablesForModules, whereFor } from './data-governance.catalog';

describe('data governance catalog', () => {
  it('does not include accounts, tenants, secrets, audit logs, or migration tables', () => {
    const models = RESET_MODULES.flatMap((item) => item.tables.map((table) => table.model));
    expect(models.some((model) => FORBIDDEN_MODELS.includes(model))).toBe(false);
    expect(models).not.toContain('auditLog');
    expect(models).not.toContain('integrationSetting');
    expect(models).not.toContain('customer');
    expect(models).not.toContain('user');
  });

  it('marks reports as unavailable because reports are not stored', () => {
    const reports = RESET_MODULES.find((item) => item.id === 'reports');
    expect(reports?.available).toBe(false);
    expect(reports?.tables).toHaveLength(0);
  });

  it('counts a shared table once when modules overlap', () => {
    const tables = tablesForModules(['sales-crm', 'leads-deals', 'customers']);
    expect(tables.filter((table) => table.model === 'lead')).toHaveLength(1);
    expect(tables.filter((table) => table.model === 'company')).toHaveLength(1);
  });

  it('keeps a tenant filter on customer-owned tables', () => {
    expect(whereFor('customer', 12)).toEqual({ customerId: 12 });
    expect(whereFor('template', 12)).toEqual({ customerId: 12, isSystem: false });
    expect(whereFor('lead', 12)).toEqual({ lead: { customerId: 12 } });
  });
});
