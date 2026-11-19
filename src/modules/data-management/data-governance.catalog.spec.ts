import { FORBIDDEN_MODELS, RESET_MODULES, moduleById, tablesForModules, whereFor } from './data-governance.catalog';

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

  it('scopes team memberships through their actual Team relation', () => {
    expect(whereFor('teamMember', 12)).toEqual({ team: { customerId: 12 } });
    expect(whereFor('teamMember', 99)).toEqual({ team: { customerId: 99 } });
    expect(whereFor('teamMember', null)).toEqual({});
    const membership = RESET_MODULES.flatMap((item) => item.tables).find((table) => table.model === 'teamMember');
    expect(membership?.where).toBe('teamMember');
  });

  it('offers commissions as an explicitly selectable employee dependency module', () => {
    const module = moduleById('commissions');
    expect(module?.tables.map((table) => table.model)).toEqual(['commission', 'commissionWithdrawal']);
    expect(module?.tables.find((table) => table.model === 'commissionWithdrawal')?.where).toBe('commissionWithdrawal');
    expect(whereFor('commissionWithdrawal', 12)).toEqual({
      OR: [
        { customerId: 12 },
        { employee: { customerId: 12 } },
      ],
    });
    expect(tablesForModules(['commissions']).map((table) => table.model)).toEqual(['commissionWithdrawal', 'commission']);
  });

  it('includes commission slabs before tenant commission configurations and employees', () => {
    const rows = tablesForModules(['commission-configurations', 'employees']);
    const index = (model: string) => rows.findIndex((table) => table.model === model);
    expect(index('commissionSlab')).toBeLessThan(index('commissionConfig'));
    expect(index('commissionConfig')).toBeLessThan(index('employee'));
    expect(moduleById('commission-configurations')?.tables.map((table) => table.model)).toEqual(['commissionSlab', 'commissionConfig']);
  });

  it('includes overtime notification events before deleting overtime requests', () => {
    const tables = tablesForModules(['hrm']);
    const eventIndex = tables.findIndex((table) => table.model === 'overtimeNotificationEvent');
    const requestIndex = tables.findIndex((table) => table.model === 'overtimeRequest');
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    expect(eventIndex).toBeLessThan(requestIndex);
  });

  it('deletes TaskHistory, TaskProof, and TaskReview before Tasks to avoid cascade count mismatches', () => {
    const tables = tablesForModules(['visits-tasks']);
    const index = (model: string) => tables.findIndex((table) => table.model === model);
    for (const child of ['taskHistory', 'taskProof', 'taskReview']) {
      expect(index(child)).toBeGreaterThanOrEqual(0);
      expect(index(child)).toBeLessThan(index('task'));
    }
  });

  it('includes eligible employee dependency records in tenant reset modules', () => {
    const employeeOwned = new Set([
      'employeeLocation', 'locationTrackingSetting', 'remoteRequest', 'overtimeRequest',
      'overtimeApproval', 'overtimeNotificationEvent', 'employeeDeduction', 'teamMember',
      'employeeModuleOverride', 'employeeLeadLimit', 'salaryTargetPolicy', 'salaryTargetReview',
      'dataCaptureSearch', 'hrmEmployeeMonthlyReport', 'hrmLeaveMonthlySnapshot',
      'hrmNotificationDelivery', 'hrmCommissionMonthlySnapshot', 'hrmMonthlyReportRun',
      'hrmMonthlyCycle', 'hrmNotificationOutbox',
    ]);
    const catalogModels = new Set(RESET_MODULES.flatMap((item) => item.tables.map((table) => table.model)));
    employeeOwned.forEach((model) => expect(catalogModels).toContain(model));
  });

  it('deletes visit photos before visits so the visit cascade cannot consume the expected photo rows', () => {
    const order = tablesForModules(['visits-tasks']).map((table) => table.model);
    expect(order.indexOf('visitPhoto')).toBeLessThan(order.indexOf('visit'));
    expect(order.indexOf('teamMember')).toBeLessThan(order.indexOf('team'));
    expect(order.indexOf('workTask')).toBeLessThan(order.indexOf('work'));
    expect(order.indexOf('ticketComment')).toBeLessThan(order.indexOf('supportTicket'));
    expect(order.indexOf('team')).toBeLessThan(order.indexOf('task'));
  });

  it('deletes salary slips and payroll items before payroll runs to prevent cascade count mismatches', () => {
    const order = tablesForModules(['payroll']).map((table) => table.model);
    expect(order.indexOf('salarySlip')).toBeLessThan(order.indexOf('payrollItem'));
    expect(order.indexOf('payrollItem')).toBeLessThan(order.indexOf('payroll'));
    expect(order.indexOf('employeeDeduction')).toBeLessThan(order.indexOf('payroll'));
  });

  it('deletes employee and department children before parent rows', () => {
    const tables = tablesForModules(['hrm', 'payroll', 'expenses', 'visits-tasks', 'employees', 'designations', 'departments']);
    const index = (model: string) => tables.findIndex((table) => table.model === model);
    for (const child of ['employeeModuleOverride', 'salaryTargetReview', 'employeeDeduction', 'overtimeNotificationEvent', 'teamMember']) {
      expect(index(child)).toBeGreaterThanOrEqual(0);
      expect(index(child)).toBeLessThan(index('employee'));
    }
    expect(index('designation')).toBeLessThan(index('department'));
    expect(index('announcement')).toBeLessThan(index('department'));
  });
});
