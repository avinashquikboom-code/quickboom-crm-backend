import { BadRequestException } from '@nestjs/common';

export async function settleCommissionShares(tx: any, payrollItemId: number) {
  const shares = await tx.commissionShare.findMany({ where: { payrollItemId }, include: { commission: true } });
  if (shares.some(s => s.status === 'CANCELLED' || s.commission.reviewReason)) {
    throw new BadRequestException('Commission reversal/review requires payroll recalculation or an authorized adjustment');
  }
  if (!shares.some(s => s.status === 'APPROVED')) return;
  await tx.commissionShare.updateMany({ where: { payrollItemId, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } });
  for (const commissionId of new Set(shares.map(s => s.commissionId))) {
    if (!(await tx.commissionShare.count({ where: { commissionId, status: { not: 'PAID' } } }))) {
      await tx.commission.update({ where: { id: commissionId }, data: { status: 'PAID', paidAt: new Date() } });
    }
  }
}

export async function commissionForPayroll(tx: any, tenantId: number, employeeId: number, start: Date, end: Date, payrollId: number, existingCommission: number) {
  const shares = await tx.commissionShare.findMany({
    where: { employeeId, status: 'APPROVED', commission: { tenantId, reviewReason: null, qualifyingAt: { gte: start, lte: end } }, OR: [{ payrollItemId: null }, { payrollItem: { payrollId } }] },
  });
  const amount = Math.round(shares.reduce((sum, share) => sum + share.amount, 0) * 100) / 100;
  if (shares.length && existingCommission !== 0) throw new BadRequestException('Commission compensation overlap requires review before payroll calculation');
  return { shares, amount };
}
