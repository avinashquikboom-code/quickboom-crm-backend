export type LeaveLine = {
  leaveType: string;
  opening: number;
  credited: number;
  carryForward: number;
  taken: number;
  adjustments: number;
  expired: number;
  unpaid: number;
  closing: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

export function leaveBalanceLine(input: {
  leaveType: string;
  allocated: number;
  usedBeforeMonth: number;
  credited: number;
  carryForward: number;
  carryAlreadyInOpening: boolean;
  taken: number;
  adjustments: number;
  expired: number;
  unpaid: number;
}): LeaveLine {
  const opening = round(input.allocated - input.usedBeforeMonth);
  const carryForward = input.carryAlreadyInOpening ? 0 : input.carryForward;
  const closing = round(opening + input.credited + carryForward + input.adjustments - input.taken - input.expired);
  return {
    leaveType: input.leaveType,
    opening,
    credited: round(input.credited),
    carryForward: round(carryForward),
    taken: round(input.taken),
    adjustments: round(input.adjustments),
    expired: round(input.expired),
    unpaid: round(input.unpaid),
    closing,
  };
}

export function overlapLeaveDays(request: { fromDate: Date; toDate: Date; days: number }, monthStart: Date, monthEnd: Date) {
  const from = new Date(request.fromDate.getFullYear(), request.fromDate.getMonth(), request.fromDate.getDate());
  const to = new Date(request.toDate.getFullYear(), request.toDate.getMonth(), request.toDate.getDate());
  const start = from > monthStart ? from : monthStart;
  const end = to < monthEnd ? to : monthEnd;
  if (end < start) return 0;
  if (request.days > 0 && request.days < 1) return request.days;
  const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const overlap = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (span <= overlap) return request.days || overlap;
  return round((request.days || span) * (overlap / span));
}

export function isUnpaidLeave(code?: string | null, name?: string | null) {
  const value = `${code || ''} ${name || ''}`.toLowerCase();
  return value.includes('unpaid') || code === 'UL' || code === 'LWP';
}
