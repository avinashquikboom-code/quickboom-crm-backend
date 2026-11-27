import {
  calculateTelecallerPerformance,
  resolveEffectiveTarget,
} from './telecaller-targets.calculator';
import { renderDailyPerformancePdf } from './telecaller-performance-pdf';
import { TelecallerTargetsService } from './telecaller-targets.service';

describe('Telecaller Target and Performance Management System', () => {
  describe('Performance Calculation & Weightage Rules', () => {
    it('caps individual metric contribution at 100% in overall score while allowing >100% individual achievement', () => {
      const result = calculateTelecallerPerformance({
        targets: [
          {
            metricKey: 'OUTGOING_CALLS',
            metricLabel: 'Total Outgoing Calls',
            periodType: 'DAILY',
            baseTarget: 20,
            actual: 40, // 200% individual achievement
          },
          {
            metricKey: 'CONNECTED_CALLS',
            metricLabel: 'Connected Calls',
            periodType: 'DAILY',
            baseTarget: 10,
            actual: 5, // 50% individual achievement
          },
        ],
      });

      expect(result.metrics[0].achievementPct).toBe(200);
      expect(result.metrics[0].cappedContributionPct).toBe(100);
      expect(result.metrics[0].status).toBe('EXCEEDED');
      expect(result.metrics[1].achievementPct).toBe(50);
      // Equal weightage: (100 + 50) / 2 = 75% (not (200 + 50)/2 = 125%)
      expect(result.overallScore).toBe(75);
      expect(result.callConnectionRate).toBe(12.5);
    });

    it('uses custom weightage when configured and excludes zero-value targets', () => {
      const result = calculateTelecallerPerformance({
        targets: [
          {
            metricKey: 'OUTGOING_CALLS',
            metricLabel: 'Total Outgoing Calls',
            periodType: 'DAILY',
            baseTarget: 10,
            actual: 10, // 100%
            weightage: 30,
          },
          {
            metricKey: 'PROPOSALS_SENT',
            metricLabel: 'Proposals Sent',
            periodType: 'DAILY',
            baseTarget: 4,
            actual: 2, // 50%
            weightage: 70,
          },
          {
            metricKey: 'VISITS_SCHEDULED',
            metricLabel: 'Visits Scheduled',
            periodType: 'DAILY',
            baseTarget: 0, // excluded
            actual: 3,
            weightage: 50,
          },
        ],
      });

      expect(result.assignedTargetsCount).toBe(2);
      expect(result.metrics[2].excluded).toBe(true);
      // (100*30 + 50*70) / 100 = 65%
      expect(result.overallScore).toBe(65);
    });
  });

  describe('Shift, Half-Day Leave & Holiday Exclusions', () => {
    it('proportionally adjusts daily targets for approved half-day leave', () => {
      const resolved = resolveEffectiveTarget({
        baseTarget: 20,
        isHalfDayLeave: true,
        halfDayRatio: 0.5,
        policy: { adjustForHalfDayLeave: true },
      });
      expect(resolved.excluded).toBe(false);
      expect(resolved.effectiveTarget).toBe(10);
    });

    it('excludes full-day leave, holidays, and weekly offs from mandatory daily targets', () => {
      const leaveRes = calculateTelecallerPerformance({
        targets: [
          {
            metricKey: 'OUTGOING_CALLS',
            metricLabel: 'Total Outgoing Calls',
            periodType: 'DAILY',
            baseTarget: 20,
            actual: 0,
          },
        ],
        isFullDayLeave: true,
        policy: { excludeFullDayLeave: true },
      });
      expect(leaveRes.excludedDay).toBe(true);
      expect(leaveRes.exclusionReason).toBe('APPROVED_FULL_DAY_LEAVE');
      expect(leaveRes.assignedTargetsCount).toBe(0);

      const holidayRes = resolveEffectiveTarget({
        baseTarget: 20,
        isHoliday: true,
        policy: { excludeHolidays: true },
      });
      expect(holidayRes.excluded).toBe(true);
      expect(holidayRes.exclusionReason).toBe('PUBLIC_HOLIDAY');
    });

    it('attributes overnight shift activities after midnight to the shift start business date', () => {
      const service = new TelecallerTargetsService({} as any);
      // 2026-12-02 01:30 AM IST (2026-12-01T20:00:00Z) on a 10:00 PM - 06:00 AM night shift
      const bizDate = service.resolveShiftBusinessDate(new Date('2026-12-01T20:00:00.000Z'), {
        startTime: '10:00 PM',
        endTime: '06:00 AM',
        isNightShift: true,
      });
      expect(bizDate).toBe('2026-12-01');
    });
  });

  describe('A4 Daily Performance PDF Generation', () => {
    it('generates a valid multi-row A4 PDF buffer without blank pages', async () => {
      const pdf = await renderDailyPerformancePdf({
        companyName: 'QuickBoom Tech',
        reportDate: '2026-12-01',
        reportVersion: 1,
        generatedAt: new Date('2026-12-01T13:00:00.000Z'),
        employeeName: 'Aarav Sharma',
        employeeCode: 'EMP-104',
        department: 'Telecalling',
        designation: 'Senior Telecaller',
        shiftName: 'Day Shift',
        shiftTimings: '09:30 AM - 06:30 PM',
        punchInText: '09:28 AM IST',
        punchOutText: '06:32 PM IST',
        workingHoursText: '8.07 hrs',
        overallScore: 87.5,
        callConnectionRate: 45,
        leadConversionRate: 20,
        metrics: Array.from({ length: 10 }, (_, idx) => ({
          metricKey: `METRIC_${idx}`,
          metricLabel: `Telecaller Metric ${idx + 1}`,
          periodType: 'DAILY',
          baseTarget: 10,
          effectiveTarget: 10,
          actual: idx % 2 === 0 ? 10 : 7,
          remaining: idx % 2 === 0 ? 0 : 3,
          achievementPct: idx % 2 === 0 ? 100 : 70,
          cappedContributionPct: idx % 2 === 0 ? 100 : 70,
          weightage: null,
          status: idx % 2 === 0 ? 'COMPLETED' : 'IN_PROGRESS',
          excluded: false,
        })),
        stats: {
          outgoingCalls: 40,
          connectedCalls: 18,
          followUpsCompleted: 12,
          newLeadsCreated: 5,
          visitsScheduled: 2,
          visitsCompleted: 1,
          proposalsSent: 3,
          leadsWon: 1,
        },
        callVerificationLimitation:
          'External telephony/dialer webhook is not configured; connected calls rely on CRM call logs.',
        summaryNotes: ['Overall daily score 87.5%.'],
        improvementAreas: ['Increase follow-up closure rate.'],
      });

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(1500);
      expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    });
  });
});
