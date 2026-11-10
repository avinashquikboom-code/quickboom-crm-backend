export type CrmEmployeeCategory = 'BPO' | 'VISITOR' | 'SALES' | 'NONE';

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
 * already stored for the account. A department, designation, or team of BPO is BPO.
 * Telesales belongs to that calling team. Sales stays Sales. Visitor designations
 * stay Visitor unless that same record is also BPO or telesales.
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

  if (designationVisitor && !departmentBpo && !designationBpo && !telesales) {
    return 'VISITOR';
  }
  if (departmentBpo || designationBpo || roleBpo || telesales) {
    return 'BPO';
  }
  if (sales) {
    return 'SALES';
  }
  if (designationVisitor || roleVisitor) {
    return 'VISITOR';
  }
  return 'NONE';
}
