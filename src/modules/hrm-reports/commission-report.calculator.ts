export interface CommissionLine {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  customerName: string;
  customerRef: string;
  invoiceNumber: string;
  orderNumber: string;
  product: string;
  invoiceAmount: number;
  rateLabel: string;
  commissionAmount: number;
  employeeShare: number;
  leaderShare: number;
  status: string;
  paymentStatus: string;
  createdAt: Date;
}

export interface CommissionSummary {
  generated: number;
  employeeShare: number;
  leaderShare: number;
  approved: number;
  pending: number;
  paid: number;
  outstanding: number;
  reversed: number;
  netEarned: number;
  customers: number;
}

const money = (value: number) => Math.round(value * 100) / 100;

export function commissionInPeriod(row: { createdAt: Date; updatedAt: Date; status: string }, start: Date, end: Date) {
  const createdHere = row.createdAt >= start && row.createdAt <= end;
  const reversedHere = row.status === 'CANCELLED' && row.updatedAt >= start && row.updatedAt <= end;
  return createdHere || reversedHere;
}

export function presentCommission(row: any): CommissionLine {
  const lead = row.lead;
  const customerName = lead?.companyName || [lead?.firstName, lead?.lastName].filter(Boolean).join(' ') || row.plan?.name || 'Customer';
  const status = String(row.status || 'PENDING');
  const active = status !== 'CANCELLED';
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : '',
    employeeCode: row.employee?.employeeCode || '',
    customerName,
    customerRef: lead?.id ? `lead:${lead.id}` : `commission:${row.id}`,
    invoiceNumber: row.purchase?.paymentId || row.purchase?.orderNumber || '—',
    orderNumber: row.orderId || row.purchase?.orderNumber || '—',
    product: row.plan?.name || lead?.title || 'Service',
    invoiceAmount: Number(row.purchaseAmount) || 0,
    rateLabel: row.commissionType === 'FIXED' ? `Fixed ${Number(row.commissionRate) || 0}` : `${Number(row.commissionRate) || 0}%`,
    commissionAmount: Number(row.commissionAmount) || 0,
    employeeShare: active ? Number(row.commissionAmount) || 0 : 0,
    leaderShare: 0,
    status,
    paymentStatus: status === 'PAID' ? 'PAID' : status === 'CANCELLED' ? 'REVERSED' : status === 'APPROVED' ? 'OUTSTANDING' : 'PENDING',
    createdAt: row.createdAt,
  };
}

export function summarizeCommissions(lines: CommissionLine[]): CommissionSummary {
  const sum = (rows: CommissionLine[], pick: (line: CommissionLine) => number) => money(rows.reduce((total, line) => total + pick(line), 0));
  const pending = lines.filter((line) => line.status === 'PENDING');
  const approved = lines.filter((line) => line.status === 'APPROVED');
  const paid = lines.filter((line) => line.status === 'PAID');
  const reversed = lines.filter((line) => line.status === 'CANCELLED');
  const active = lines.filter((line) => line.status !== 'CANCELLED');
  return {
    generated: sum(active, (line) => line.commissionAmount),
    employeeShare: sum(active, (line) => line.employeeShare),
    leaderShare: sum(active, (line) => line.leaderShare),
    approved: sum([...approved, ...paid], (line) => line.commissionAmount),
    pending: sum(pending, (line) => line.commissionAmount),
    paid: sum(paid, (line) => line.commissionAmount),
    outstanding: sum(approved, (line) => line.commissionAmount),
    reversed: sum(reversed, (line) => line.commissionAmount),
    netEarned: sum([...approved, ...paid], (line) => line.commissionAmount),
    customers: new Set(active.map((line) => line.customerRef)).size,
  };
}
