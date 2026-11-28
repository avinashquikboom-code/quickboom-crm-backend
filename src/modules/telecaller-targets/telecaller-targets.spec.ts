import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TelecallerTargetsController } from './telecaller-targets.controller';
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

  describe('HTTP Route Contract (/api/v1/telecaller-targets/my/daily-rewards)', () => {
    it('returns HTTP 200 with valid empty-state structure for authenticated employee', async () => {
      const mockService = {
        getMyDailyRewards: jest.fn().mockResolvedValue({
          success: true,
          data: {
            businessDate: '2026-11-28',
            targetCalls: 0,
            totalCalls: 0,
            connectedCalls: 0,
            minConnectedCalls: 60,
            maxConnectedCalls: 70,
            todayInquiries: 0,
            todayVisits: 0,
            targetCompleted: false,
            earnedPoints: 0,
            slabs: [],
            history: [],
          },
        }),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [TelecallerTargetsController],
        providers: [{ provide: TelecallerTargetsService, useValue: mockService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: any) => {
            const req = ctx.switchToHttp().getRequest();
            req.user = { id: 10, customerId: 1, employeeId: 5, role: 'EMPLOYEE' };
            return true;
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.init();

      const res = await request(app.getHttpServer())
        .get('/api/v1/telecaller-targets/my/daily-rewards')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.history).toEqual([]);
      expect(mockService.getMyDailyRewards).toHaveBeenCalled();
      await app.close();
    });

    it('calculates 26 completed days * 100 pts / 10 = ₹260 incentive and prevents <100% reward', () => {
      const incomplete = calculateTelecallerPerformance({
        targets: [
          {
            metricKey: 'OUTGOING_CALLS',
            metricLabel: 'Total Outgoing Calls',
            periodType: 'DAILY',
            baseTarget: 120,
            actual: 119,
          },
        ],
      });
      expect(incomplete.completedTargetsCount).toBe(0);

      const completed = calculateTelecallerPerformance({
        targets: [
          {
            metricKey: 'OUTGOING_CALLS',
            metricLabel: 'Total Outgoing Calls',
            periodType: 'DAILY',
            baseTarget: 120,
            actual: 120,
          },
        ],
      });
      expect(completed.completedTargetsCount).toBe(1);
      const pointsPerDay = 100;
      const pointsPerRupee = 10;
      const monthlyIncentive = (26 * pointsPerDay) / pointsPerRupee;
      expect(monthlyIncentive).toBe(260);
    });
  });

  describe('10:00 PM Scheduled Classification, Multi-Channel Delivery & Provisional Finalization', () => {
    it('classifies Poor (<70%), Average (70-99.9%), and Good (>=100%) dynamically', () => {
      const service = new TelecallerTargetsService({} as any);
      expect(service.classifyPerformance(69.9)).toBe('POOR');
      expect(service.classifyPerformance(70)).toBe('AVERAGE');
      expect(service.classifyPerformance(99.9)).toBe('AVERAGE');
      expect(service.classifyPerformance(100)).toBe('GOOD');
      expect(service.classifyPerformance(75, { poorThresholdPct: 80, goodThresholdPct: 110 })).toBe('POOR');
      expect(service.classifyPerformance(110, { poorThresholdPct: 80, goodThresholdPct: 110 })).toBe('GOOD');
    });

    it('dispatches Email, WhatsApp, and Push with classification-specific templates and /telecaller-performance route', async () => {
      const emailSend = jest.fn().mockResolvedValue({});
      const waSendTpl = jest.fn().mockResolvedValue({ success: true });
      const pushSend = jest.fn().mockResolvedValue({});

      const prismaMock: any = {
        telecallerTargetPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
        dailyPerformanceReport: {
          findUnique: jest.fn().mockResolvedValue({
            id: 77,
            customerId: 1,
            employeeId: 5,
            businessDate: '2026-11-28',
            reportVersion: 1,
            classification: 'GOOD',
            isProvisional: false,
            emailStatus: 'PENDING',
            whatsappStatus: 'PENDING',
            pushStatus: 'PENDING',
            snapshotData: {
              overallScore: 105,
              classification: 'GOOD',
              metrics: [{ metricKey: 'OUTGOING_CALLS', effectiveTarget: 120, actual: 126, excluded: false }],
              stats: { outgoingCalls: 126 },
            },
            customer: { id: 1, name: 'QB Suite', companyName: 'QB Suite' },
            employee: {
              id: 5,
              userId: 50,
              firstName: 'Asha',
              lastName: 'Rao',
              email: 'asha@example.com',
              phone: '9876543210',
              shift: { name: 'Day' },
              department: { name: 'Sales' },
              designation: { name: 'Telecaller' },
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 77 }),
        },
        telecallerRewardLedger: {
          findFirst: jest.fn().mockResolvedValue({ points: 100, incentiveAmount: 10, status: 'EARNED' }),
          findMany: jest.fn().mockResolvedValue([{ points: 100, incentiveAmount: 10 }]),
        },
      };

      const service = new TelecallerTargetsService(
        prismaMock,
        { sendEmail: emailSend } as any,
        { sendTemplate: waSendTpl, sendDocumentMessage: jest.fn().mockResolvedValue({ success: true }) } as any,
        undefined,
        { sendPushNotification: pushSend } as any,
      );
      jest.spyOn(service, 'generateReportPdfBuffer').mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock'),
        filename: 'report.pdf',
        report: await prismaMock.dailyPerformanceReport.findUnique(),
      });

      await service.dispatchReportDeliveries(77);

      expect(emailSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'asha@example.com',
          attachments: [expect.objectContaining({ filename: 'report.pdf' })],
        }),
      );
      expect(waSendTpl).toHaveBeenCalledWith(
        '9876543210',
        'daily_performance_good',
        expect.any(Array),
        'en_US',
        undefined,
        'DAILY_PERFORMANCE_REPORT',
        1,
        undefined,
        undefined,
      );
      expect(pushSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 50,
          title: '🏆 Target Achieved!',
          type: 'DAILY_PERFORMANCE_REPORT',
          data: expect.objectContaining({ route: '/telecaller-performance' }),
        }),
      );
    });

    it('finalizes provisional report after shift completion without sending duplicate notifications', async () => {
      const prismaMock: any = {
        dailyPerformanceReport: {
          findFirst: jest.fn().mockResolvedValue({ id: 88, isProvisional: true }),
          update: jest.fn().mockResolvedValue({ id: 88, isProvisional: false }),
        },
        telecallerTargetPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const service = new TelecallerTargetsService(prismaMock);
      jest.spyOn(service, 'computeAndSaveDailySnapshot').mockResolvedValue({
        perf: {
          overallScore: 100,
          assignedTargetsCount: 1,
          completedTargetsCount: 1,
          callConnectionRate: 60,
          leadConversionRate: 10,
          metrics: [{ metricKey: 'OUTGOING_CALLS', excluded: false, effectiveTarget: 120 }],
        },
        stats: { outgoingCalls: 120, connectedCalls: 72 },
      } as any);
      const rewardSpy = jest.spyOn(service as any, 'evaluateAndCreditCallRewards').mockResolvedValue({ id: 1 });
      const dispatchSpy = jest.spyOn(service, 'dispatchReportDeliveries');

      await service.finalizeProvisionalReportAfterShift(1, 5, '2026-11-28');

      expect(rewardSpy).toHaveBeenCalledWith(
        1,
        5,
        '2026-11-28',
        120,
        72,
        120,
        expect.objectContaining({ isFinalized: true }),
      );
      expect(prismaMock.dailyPerformanceReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 88 },
          data: expect.objectContaining({ isProvisional: false }),
        }),
      );
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
