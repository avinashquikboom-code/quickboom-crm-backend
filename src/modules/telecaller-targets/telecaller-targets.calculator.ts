export const TELECALLER_METRIC_CATALOG = [
  { key: 'OUTGOING_CALLS', label: 'Total Outgoing Calls' },
  { key: 'CONNECTED_CALLS', label: 'Connected Calls' },
  { key: 'FOLLOW_UPS_COMPLETED', label: 'Follow-ups Completed' },
  { key: 'NEW_LEADS_CREATED', label: 'New Leads Created' },
  { key: 'VISITS_SCHEDULED', label: 'Visits Scheduled' },
  { key: 'VISITS_COMPLETED', label: 'Visits Completed' },
  { key: 'PROPOSALS_SENT', label: 'Proposals Sent' },
  { key: 'LEADS_WON', label: 'Leads Converted / Won' },
] as const;

export type TelecallerMetricKey =
  | (typeof TELECALLER_METRIC_CATALOG)[number]['key']
  | (string & {});

export interface TargetPolicyConfig {
  adjustForHalfDayLeave: boolean;
  excludeFullDayLeave: boolean;
  excludeHolidays: boolean;
  excludeWeeklyOff: boolean;
}

export interface TargetMetricInput {
  assignmentId?: number;
  metricKey: string;
  metricLabel: string;
  periodType: string;
  baseTarget: number;
  actual: number;
  weightage?: number | null;
}

export interface CalculatedMetricPerformance {
  assignmentId?: number;
  metricKey: string;
  metricLabel: string;
  periodType: string;
  baseTarget: number;
  effectiveTarget: number;
  actual: number;
  remaining: number;
  achievementPct: number;
  cappedContributionPct: number;
  weightage: number | null;
  status: 'EXCEEDED' | 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED' | 'EXCLUDED';
  excluded: boolean;
}

export interface TelecallerPerformanceResult {
  overallScore: number;
  excludedDay: boolean;
  exclusionReason: string | null;
  completedTargetsCount: number;
  missedTargetsCount: number;
  assignedTargetsCount: number;
  callConnectionRate: number;
  leadConversionRate: number;
  metrics: CalculatedMetricPerformance[];
}

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function resolveEffectiveTarget(input: {
  baseTarget: number;
  isFullDayLeave?: boolean;
  isHalfDayLeave?: boolean;
  halfDayRatio?: number;
  isHoliday?: boolean;
  isWeeklyOff?: boolean;
  policy?: Partial<TargetPolicyConfig> | null;
}): { effectiveTarget: number; excluded: boolean; exclusionReason: string | null } {
  const policy: TargetPolicyConfig = {
    adjustForHalfDayLeave: input.policy?.adjustForHalfDayLeave ?? true,
    excludeFullDayLeave: input.policy?.excludeFullDayLeave ?? true,
    excludeHolidays: input.policy?.excludeHolidays ?? true,
    excludeWeeklyOff: input.policy?.excludeWeeklyOff ?? true,
  };

  if (input.isFullDayLeave && policy.excludeFullDayLeave) {
    return { effectiveTarget: 0, excluded: true, exclusionReason: 'APPROVED_FULL_DAY_LEAVE' };
  }
  if (input.isHoliday && policy.excludeHolidays) {
    return { effectiveTarget: 0, excluded: true, exclusionReason: 'PUBLIC_HOLIDAY' };
  }
  if (input.isWeeklyOff && policy.excludeWeeklyOff) {
    return { effectiveTarget: 0, excluded: true, exclusionReason: 'WEEKLY_OFF' };
  }

  const base = Math.max(0, Number(input.baseTarget) || 0);
  if (base <= 0) {
    return { effectiveTarget: 0, excluded: true, exclusionReason: 'ZERO_TARGET' };
  }

  if (input.isHalfDayLeave && policy.adjustForHalfDayLeave) {
    const ratio = Math.max(0.1, Math.min(1, Number(input.halfDayRatio ?? 0.5)));
    const adjusted = base >= 2 ? Math.max(1, Math.round(base * ratio)) : round2(base * ratio);
    return { effectiveTarget: adjusted, excluded: false, exclusionReason: null };
  }

  return { effectiveTarget: base, excluded: false, exclusionReason: null };
}

export function calculateTelecallerPerformance(input: {
  targets: TargetMetricInput[];
  isFullDayLeave?: boolean;
  isHalfDayLeave?: boolean;
  halfDayRatio?: number;
  isHoliday?: boolean;
  isWeeklyOff?: boolean;
  policy?: Partial<TargetPolicyConfig> | null;
  totalsByMetric?: Record<string, number>;
}): TelecallerPerformanceResult {
  const metrics: CalculatedMetricPerformance[] = [];
  let exclusionReason: string | null = null;

  for (const t of input.targets) {
    const actual = Math.max(0, Number(t.actual) || 0);
    const resolved = resolveEffectiveTarget({
      baseTarget: t.baseTarget,
      isFullDayLeave: input.isFullDayLeave,
      isHalfDayLeave: input.isHalfDayLeave,
      halfDayRatio: input.halfDayRatio,
      isHoliday: input.isHoliday,
      isWeeklyOff: input.isWeeklyOff,
      policy: input.policy,
    });

    if (resolved.excluded && !exclusionReason && resolved.exclusionReason !== 'ZERO_TARGET') {
      exclusionReason = resolved.exclusionReason;
    }

    if (resolved.excluded || resolved.effectiveTarget <= 0) {
      metrics.push({
        assignmentId: t.assignmentId,
        metricKey: t.metricKey,
        metricLabel: t.metricLabel,
        periodType: t.periodType,
        baseTarget: t.baseTarget,
        effectiveTarget: 0,
        actual,
        remaining: 0,
        achievementPct: 0,
        cappedContributionPct: 0,
        weightage: t.weightage ?? null,
        status: 'EXCLUDED',
        excluded: true,
      });
      continue;
    }

    const achievementPct = round2((actual / resolved.effectiveTarget) * 100);
    const cappedContributionPct = round2(Math.min(100, achievementPct));
    const remaining = round2(Math.max(0, resolved.effectiveTarget - actual));
    const status: CalculatedMetricPerformance['status'] =
      achievementPct > 100
        ? 'EXCEEDED'
        : achievementPct >= 100
          ? 'COMPLETED'
          : actual > 0
            ? 'IN_PROGRESS'
            : 'NOT_STARTED';

    metrics.push({
      assignmentId: t.assignmentId,
      metricKey: t.metricKey,
      metricLabel: t.metricLabel,
      periodType: t.periodType,
      baseTarget: t.baseTarget,
      effectiveTarget: resolved.effectiveTarget,
      actual,
      remaining,
      achievementPct,
      cappedContributionPct,
      weightage: t.weightage != null && Number(t.weightage) > 0 ? Number(t.weightage) : null,
      status,
      excluded: false,
    });
  }

  const active = metrics.filter((m) => !m.excluded && m.effectiveTarget > 0);
  const hasCustomWeightage = active.some((m) => m.weightage != null && m.weightage > 0);

  let overallScore = 0;
  if (active.length > 0) {
    if (hasCustomWeightage) {
      const weights = active.map((m) => (m.weightage != null && m.weightage > 0 ? m.weightage : 1));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const weightedTotal = active.reduce(
        (sum, m, idx) => sum + m.cappedContributionPct * weights[idx],
        0,
      );
      overallScore = weightSum > 0 ? round2(weightedTotal / weightSum) : 0;
    } else {
      const total = active.reduce((sum, m) => sum + m.cappedContributionPct, 0);
      overallScore = round2(total / active.length);
    }
  }

  const completedTargetsCount = active.filter((m) => m.achievementPct >= 100).length;
  const missedTargetsCount = active.filter((m) => m.achievementPct < 100).length;

  const getTotal = (key: string) => {
    if (input.totalsByMetric && key in input.totalsByMetric) {
      return Math.max(0, Number(input.totalsByMetric[key]) || 0);
    }
    return metrics.find((m) => m.metricKey === key)?.actual ?? 0;
  };

  const outgoingCalls = getTotal('OUTGOING_CALLS');
  const connectedCalls = getTotal('CONNECTED_CALLS');
  const newLeads = getTotal('NEW_LEADS_CREATED');
  const leadsWon = getTotal('LEADS_WON');

  const callConnectionRate =
    outgoingCalls > 0 ? round2(Math.min(100, (connectedCalls / outgoingCalls) * 100)) : 0;
  const leadConversionRate =
    newLeads > 0 ? round2(Math.min(100, (leadsWon / newLeads) * 100)) : 0;

  return {
    overallScore,
    excludedDay: active.length === 0 && Boolean(exclusionReason),
    exclusionReason,
    completedTargetsCount,
    missedTargetsCount,
    assignedTargetsCount: active.length,
    callConnectionRate,
    leadConversionRate,
    metrics,
  };
}
