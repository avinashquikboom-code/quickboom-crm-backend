export type CrmEmployeeCategory = 'SALES' | 'VISITOR' | 'NONE';

export interface CrmEmployeeSignals {
  departmentName?: string | null;
  departmentCode?: string | null;
  designationName?: string | null;
  designationCode?: string | null;
  roles?: Array<string | null | undefined>;
}

/** Explicitly configured Sales Telecaller cohort allowed CRM mobile defaults. */
export function isAuthorizedSalesTelecaller(employee: any): boolean {
  const department = employee?.department;
  const designation = employee?.designation;
  const departmentSignals = [department?.name, department?.code].map(text);
  const designationSignals = [designation?.name, designation?.code].map(text);
  return employee?.status === 'ACTIVE' &&
    employee?.mobileLoginEnabled !== false &&
    designation?.crmMobileAccess === true &&
    departmentSignals.some((value) => value.includes('SALES')) &&
    designationSignals.some((value) =>
      value.includes('TELECALL') || value.includes('TELESALES') || value.includes('TELESELL'),
    );
}

/** Active Sales department mobile employees may delete leads they own or are assigned. */
export function isSalesDepartmentEmployee(employee: any): boolean {
  const department = employee?.department;
  const designation = employee?.designation;
  const departmentSignals = [department?.name, department?.code].map(text);
  const designationSignals = [designation?.name, designation?.code].map(text);
  const isVisitor = designationSignals.some((value) =>
    value.includes('VISITOR') || value === 'VISIT' || value.includes('FIELD VISIT') || value.includes('FIELD_VISIT') || value.includes('FIELD OFFICER'),
  );
  return employee?.status === 'ACTIVE' &&
    employee?.mobileLoginEnabled !== false &&
    !isVisitor &&
    departmentSignals.some((value) => value.includes('SALES'));
}

function text(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

function isBpo(value?: string | null): boolean {
  return text(value).includes('BPO');
}

function isVisitor(value?: string | null): boolean {
  const valueText = text(value);
  return (
    valueText.includes('VISITOR') ||
    valueText === 'VISIT' ||
    valueText.includes('FIELD VISIT') ||
    valueText.includes('FIELD_VISIT') ||
    valueText.includes('FIELD OFFICER')
  );
}

function isTelesales(value?: string | null): boolean {
  const valueText = text(value).replace(/[\s-]+/g, '_');
  return (
    valueText.includes('TELESALES') ||
    valueText.includes('TELE_SALES') ||
    valueText.includes('TELECALL') ||
    valueText.includes('TELE_CALL') ||
    valueText.includes('TELESELL')
  );
}

function isSales(value?: string | null): boolean {
  return text(value).includes('SALES') && !isTelesales(value);
}

/**
 * CRM category comes from the employee department, designation, team, and role
 * already stored for the account. Legacy BPO department/designation names map
 * to Sales during the compatibility window. Telesales remains a calling team.
 */
export function classifyCrmEmployee(signals: CrmEmployeeSignals): CrmEmployeeCategory {
  const values = [
    signals.departmentName,
    signals.departmentCode,
    signals.designationName,
    signals.designationCode,
    ...(signals.roles || []),
  ];
  const departmentBpo = isBpo(signals.departmentName) || isBpo(signals.departmentCode);
  const designationBpo = isBpo(signals.designationName) || isBpo(signals.designationCode);
  const designationVisitor = isVisitor(signals.designationName) || isVisitor(signals.designationCode);
  const roleBpo = (signals.roles || []).some((role) => isBpo(role));
  const roleVisitor = (signals.roles || []).some((role) => isVisitor(role));
  const telesales = values.some((value) => isTelesales(value));
  const sales = values.some((value) => isSales(value));

  if ((designationVisitor || roleVisitor) && !designationBpo && !telesales) {
    return 'VISITOR';
  }
  if (departmentBpo || designationBpo || roleBpo || telesales) {
    return 'SALES';
  }
  if (sales) {
    return 'SALES';
  }
  if (designationVisitor || roleVisitor) {
    return 'VISITOR';
  }
  return 'NONE';
}
