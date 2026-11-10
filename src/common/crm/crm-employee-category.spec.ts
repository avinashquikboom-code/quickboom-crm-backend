import { classifyCrmEmployee } from './crm-employee-category';

describe('classifyCrmEmployee', () => {
  it('classifies BPO from department even when the designation is telesales', () => {
    expect(classifyCrmEmployee({
      departmentName: 'BPO',
      designationName: 'Telesales Representative',
      roles: ['EMPLOYEE'],
    })).toBe('BPO');
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

  it('does not treat a CRM mobile flag substitute such as telesales as BPO', () => {
    expect(classifyCrmEmployee({
      departmentName: 'Telesales',
      designationName: 'Telecaller',
      roles: ['TELECALLER'],
    })).toBe('NONE');
  });
});
