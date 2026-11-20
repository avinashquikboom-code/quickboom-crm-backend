import { classifyCrmEmployee, isAuthorizedSalesTelecaller } from './crm-employee-category';

describe('classifyCrmEmployee', () => {
  it('maps a legacy BPO department to Sales even when the designation is telesales', () => {
    expect(classifyCrmEmployee({
      departmentName: 'BPO',
      designationName: 'Telesales Representative',
      roles: ['EMPLOYEE'],
    })).toBe('SALES');
  });

  it('classifies Visitor employees from designation', () => {
    expect(classifyCrmEmployee({
      departmentName: 'Field',
      designationName: 'Visitor Executive',
      roles: ['EMPLOYEE'],
    })).toBe('VISITOR');
  });

  it('keeps a Lead Visitor in a BPO Call Center department as Visitor', () => {
    expect(classifyCrmEmployee({
      departmentName: 'BPO Call Center',
      departmentCode: 'BPO',
      designationName: 'Lead Visitor',
      designationCode: 'LEAD_VISITOR',
      roles: ['EMPLOYEE'],
    })).toBe('VISITOR');
  });

  it('classifies a visitor team even when the department name is different', () => {
    expect(classifyCrmEmployee({
      departmentName: 'Operations',
      designationName: 'Executive',
      roles: ['Visitor Team'],
    })).toBe('VISITOR');
  });

  it('does not classify other departments as CRM staff', () => {
    expect(classifyCrmEmployee({
      departmentName: 'Creative',
      designationName: 'Graphic Designer',
      roles: ['EMPLOYEE'],
    })).toBe('NONE');
  });

  it('keeps telecaller accounts in the Sales CRM category for legacy compatibility', () => {
    expect(classifyCrmEmployee({
      departmentName: 'Telesales',
      designationName: 'Telecaller',
      roles: ['TELECALLER'],
  })).toBe('SALES');
  });

  it('enables the Telecaller baseline only for an active, opted-in Sales department designation', () => {
    expect(isAuthorizedSalesTelecaller({
      status: 'ACTIVE',
      department: { name: 'Sales Department', code: 'SALES' },
      designation: { name: 'Telecaller', code: 'TELECALLER', crmMobileAccess: true },
    })).toBe(true);
    expect(isAuthorizedSalesTelecaller({
      status: 'ACTIVE',
      department: { name: 'Sales Department', code: 'SALES' },
      designation: { name: 'Sales Executive', code: 'SALES_EXEC', crmMobileAccess: true },
    })).toBe(false);
    expect(isAuthorizedSalesTelecaller({
      status: 'ACTIVE',
      department: { name: 'Operations', code: 'OPS' },
      designation: { name: 'Telecaller', code: 'TELECALLER', crmMobileAccess: true },
    })).toBe(false);
    expect(isAuthorizedSalesTelecaller({
      status: 'ACTIVE',
      department: { name: 'Sales Department', code: 'SALES' },
      designation: { name: 'Telecaller', code: 'TELECALLER', crmMobileAccess: false },
    })).toBe(false);
  });
});
