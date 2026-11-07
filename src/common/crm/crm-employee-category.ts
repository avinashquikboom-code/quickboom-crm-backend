export type CrmEmployeeCategory = 'BPO' | 'VISITOR' | 'NONE';

export interface CrmEmployeeSignals {
  departmentName?: string | null;
  departmentCode?: string | null;
  designationName?: string | null;
  designationCode?: string | null;
  roles?: Array<string | null | undefined>;
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

/**
 * CRM category comes from the employee department, designation, and role
 * already stored for the account. A department or designation of BPO is BPO.
 * Visitor designations stay Visitor unless that same record is also BPO.
 */
export function classifyCrmEmployee(signals: CrmEmployeeSignals): CrmEmployeeCategory {
  const departmentBpo = isBpo(signals.departmentName) || isBpo(signals.departmentCode);
  const designationBpo = isBpo(signals.designationName) || isBpo(signals.designationCode);
  const designationVisitor = isVisitor(signals.designationName) || isVisitor(signals.designationCode);
  const roleBpo = (signals.roles || []).some((role) => isBpo(role));
  const roleVisitor = (signals.roles || []).some((role) => isVisitor(role));

  if (designationVisitor && !departmentBpo && !designationBpo) {
    return 'VISITOR';
  }
  if (departmentBpo || designationBpo || roleBpo) {
    return 'BPO';
  }
  if (designationVisitor || roleVisitor) {
    return 'VISITOR';
  }
  return 'NONE';
}
