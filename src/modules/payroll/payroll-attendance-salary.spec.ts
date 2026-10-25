import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import {
  businessDayKey,
  businessRangeEndKey,
  classifyPayrollDays,
  isBpoPayrollEmployee,
  prorateFixedDivisor,
} from './payroll-attendance';

// All employees, records and amounts below are test fixtures.
const TENANT = 3;
const istMidnight = (key: string) => new Date(`${key}T00:00:00.000+05:30`);
const istTime = (key: string, hhmm: string) => new Date(`${key}T${hhmm}:00.000+05:30`);

function monthKeys(year: number, month: number): string[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1)).toISOString().slice(0, 10));
}
const isWeekday = (key: string) => {
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
};
const present = (key: string, status = 'PRESENT') => ({
  id: Number(key.replace(/-/g, '')),
  date: istMidnight(key),
  punchIn: istTime(key, '09:30'),
  punchOut: istTime(key, '18:30'),
  workingMinutes: 480,
  status,
  workMode: 'OFFICE',
});

function buildPrisma(options: {
  employees: any[];
  attendanceByEmployee?: Record<number, any[]>;
  leavesByEmployee?: Record<number, any[]>;
  holidays?: any[];
  existingPayroll?: any;
  payrollPolicy?: any;
  salaryPolicy?: any;
  attendancePolicy?: any;
}) {
  const created: any[] = [];
  const prisma: any = {
    commissionShare: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: TENANT }) },
    employee: { findMany: jest.fn().mockResolvedValue(options.employees) },
    attendance: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.punchOut === null) return [];
        return options.attendanceByEmployee?.[where.employeeId] || [];
      }),
      update: jest.fn(),
    },
    attendanceBreak: { update: jest.fn() },
    leaveRequest: { findMany: jest.fn(async ({ where }: any) => options.leavesByEmployee?.[where.employeeId] || []) },
    publicHoliday: { findMany: jest.fn().mockResolvedValue(options.holidays || []) },
    payrollPolicy: { findUnique: jest.fn().mockResolvedValue(options.payrollPolicy ?? null) },
    salaryPolicy: { findFirst: jest.fn().mockResolvedValue(options.salaryPolicy ?? null) },
    attendancePolicy: { findFirst: jest.fn().mockResolvedValue(options.attendancePolicy ?? null) },
    payroll: {
      findFirst: jest.fn().mockResolvedValue(options.existingPayroll ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 501, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 501, ...data, items: created })),
    },
    payrollItem: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn(async ({ data }: any) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
    employeeClaim: { findMany: jest.fn().mockResolvedValue([]) },
    employeeLoan: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return { prisma, created };
}

const employee = (id: number, overrides: Record<string, any> = {}) => ({
  id,
  customerId: TENANT,
  status: 'ACTIVE',
  officeId: null,
  joiningDate: new Date('2025-01-01T00:00:00.000Z'),
  shift: null,
  department: { name: 'Production' },
  designation: { name: 'Video Editor' },
  salaryStructures: [{ basicSalary: 30000, hra: 0, allowances: 0, specialAllowance: 0, bonus: 0, commission: 0, overtime: 0, otherEarnings: 0, pf: 0, esi: 0, professionalTax: 0, tds: 0, otherDeductions: 0 }],
  ...overrides,
});

async function runPayroll(options: Parameters<typeof buildPrisma>[0], year = 2026, month = 10) {
  const { prisma, created } = buildPrisma(options);
  const service = new PayrollService(prisma);
  await service.calculatePayroll(TENANT, month, year);
  return { prisma, created, byEmployee: (id: number) => created.find((item) => item.employeeId === id) };
}

const fullMonth = (year: number, month: number) => monthKeys(year, month).filter(isWeekday).map((key) => present(key));

describe('Payroll attendance date handling', () => {
  it('keys IST-midnight attendance stamps to the correct calendar day', () => {
    expect(businessDayKey(new Date('2026-09-30T18:30:00.000Z'))).toBe('2026-10-01');
    expect(businessDayKey(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10-01');
  });

  it('keys leave end dates correctly for both server timezones', () => {
    expect(businessRangeEndKey(new Date('2026-10-05T23:59:59.999Z'))).toBe('2026-10-05');
    expect(businessRangeEndKey(new Date('2026-10-05T18:29:59.999Z'))).toBe('2026-10-05');
    expect(businessRangeEndKey(istMidnight('2026-10-05'))).toBe('2026-10-05');
  });

  it('only treats BPO/telecalling designations or departments as commission eligible', () => {
    expect(isBpoPayrollEmployee({ designation: { name: 'Telecaller' } })).toBe(true);
    expect(isBpoPayrollEmployee({ department: { name: 'BPO' }, designation: { name: 'Sales Executive' } })).toBe(true);
    expect(isBpoPayrollEmployee({ department: { name: 'Production' }, designation: { name: 'Reel Editor' } })).toBe(false);
  });
});

describe('Fixed-divisor proration', () => {
  it('pays 100% for full attendance regardless of month length', () => {
    expect(prorateFixedDivisor({ divisor: 30, calendarDays: 31, employedDays: 31, lopDays: 0 }).factor).toBe(1);
    expect(prorateFixedDivisor({ divisor: 30, calendarDays: 28, employedDays: 28, lopDays: 0 }).factor).toBe(1);
  });

  it('charges 1/divisor per unpaid day and never goes negative', () => {
    expect(prorateFixedDivisor({ divisor: 30, calendarDays: 31, employedDays: 31, lopDays: 3 }).payableUnits).toBe(27);
    expect(prorateFixedDivisor({ divisor: 30, calendarDays: 31, employedDays: 31, lopDays: 40 }).payableUnits).toBe(0);
  });

  it('prorates a mid-month joiner by employed calendar days', () => {
    expect(prorateFixedDivisor({ divisor: 30, calendarDays: 28, employedDays: 14, lopDays: 0 }).payableUnits).toBe(14);
  });
});

describe('Day classification', () => {
  const days = monthKeys(2026, 10).map((key) => new Date(`${key}T00:00:00Z`));
  const weekend = (day: Date) => day.getUTCDay() === 0 || day.getUTCDay() === 6;

  it('does not count weekly offs or holidays without a punch as absences', () => {
    const counts = classifyPayrollDays({
      days,
      joiningKey: null,
      isWeeklyOff: weekend,
      attendances: [],
      leaves: [],
      holidayKeys: new Set(['2026-10-02']),
      halfDayDeductionPct: 50,
      absenceDeductionPct: 100,
    });
    expect(counts.weeklyOffDays).toBe(9);
    expect(counts.holidayDays).toBe(1);
    expect(counts.absentDays).toBe(21);
    expect(counts.lopDays).toBe(21);
  });

  it('pays a half day worked plus a paid-leave half in full', () => {
    const counts = classifyPayrollDays({
      days,
      joiningKey: null,
      isWeeklyOff: weekend,
      attendances: [present('2026-10-05', 'HALF_DAY')],
      leaves: [{ fromDate: istMidnight('2026-10-05'), toDate: new Date('2026-10-05T18:29:59.999Z'), leaveType: { code: 'CL', name: 'Casual Leave' } }],
      holidayKeys: new Set(),
      halfDayDeductionPct: 50,
      absenceDeductionPct: 100,
    });
    expect(counts.paidLeaveDays).toBe(0.5);
    expect(counts.halfDays).toBe(1);
    // Only the other 21 unattended weekdays are unpaid.
    expect(counts.lopDays).toBe(21);
  });
});

describe('PayrollService attendance-based salary (test data)', () => {
  it('1. full attendance pays the full monthly salary', async () => {
    const { byEmployee } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: fullMonth(2026, 10) },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    const item = byEmployee(10);
    expect(item.presentDays).toBe(22);
    expect(item.absentDays).toBe(0);
    expect(item.weeklyOffDays).toBe(9);
    expect(item.basicSalary).toBe(30000);
    expect(item.lopDeduction).toBe(0);
  });

  it('2. half days apply the configured half-day deduction', async () => {
    const attendance = fullMonth(2026, 10).map((row) =>
      ['2026-10-06', '2026-10-07'].includes(businessDayKey(row.date)) ? { ...row, status: 'HALF_DAY' } : row,
    );
    const { byEmployee } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    const item = byEmployee(10);
    expect(item.halfDays).toBe(2);
    expect(item.lopDays).toBe(1);
    expect(item.basicSalary).toBe(29000);
    expect(item.lopDeduction).toBe(1000);
  });

  it('3. an absence on a scheduled working day deducts one day', async () => {
    const attendance = fullMonth(2026, 10).filter((row) => businessDayKey(row.date) !== '2026-10-08');
    const { byEmployee } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    expect(byEmployee(10).absentDays).toBe(1);
    expect(byEmployee(10).basicSalary).toBe(29000);
  });

  it('4. Sundays, public holidays and shift weekly offs are not absences', async () => {
    const attendance = fullMonth(2026, 10).filter((row) => businessDayKey(row.date) !== '2026-10-02');
    const { byEmployee } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      holidays: [{ date: new Date('2026-10-02T00:00:00.000Z'), officeId: null, name: 'Gandhi Jayanti' }],
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    const item = byEmployee(10);
    expect(item.holidayDays).toBe(1);
    expect(item.absentDays).toBe(0);
    expect(item.basicSalary).toBe(30000);
  });

  it('4b. a Mon-Sat shift treats only Sundays as weekly off', async () => {
    const shift = { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
    const attendance = monthKeys(2026, 10)
      .filter((key) => new Date(`${key}T00:00:00Z`).getUTCDay() !== 0)
      .map((key) => present(key));
    const { byEmployee } = await runPayroll({
      employees: [employee(10, { shift })],
      attendanceByEmployee: { 10: attendance },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    expect(byEmployee(10).weeklyOffDays).toBe(4);
    expect(byEmployee(10).absentDays).toBe(0);
  });

  it('5. approved paid leave is paid and approved unpaid leave is deducted', async () => {
    const leaveKeys = ['2026-10-12', '2026-10-13', '2026-10-14'];
    const attendance = fullMonth(2026, 10).filter((row) => !leaveKeys.includes(businessDayKey(row.date)));
    const { byEmployee } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      leavesByEmployee: {
        10: [
          // UTC-server stamps: end-of-day must not spill into the next day.
          { fromDate: new Date('2026-10-12T00:00:00.000Z'), toDate: new Date('2026-10-13T23:59:59.999Z'), leaveType: { code: 'CL', name: 'Casual Leave' } },
          { fromDate: new Date('2026-10-14T00:00:00.000Z'), toDate: new Date('2026-10-14T23:59:59.999Z'), leaveType: { code: 'UL', name: 'Unpaid Leave' } },
        ],
      },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    const item = byEmployee(10);
    expect(item.paidLeaveDays).toBe(2);
    expect(item.unpaidLeaveDays).toBe(1);
    expect(item.absentDays).toBe(0);
    expect(item.basicSalary).toBe(29000);
  });

  it('6. a present status without a punch-in is not paid, until an approved leave covers it', async () => {
    const attendance = fullMonth(2026, 10).map((row) =>
      businessDayKey(row.date) === '2026-10-15' ? { ...row, punchIn: null, punchOut: null } : row,
    );
    const first = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    expect(first.byEmployee(10).calculationSnapshot.missingPunchDays).toBe(1);
    expect(first.byEmployee(10).basicSalary).toBe(29000);

    const corrected = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: attendance },
      leavesByEmployee: { 10: [{ fromDate: istMidnight('2026-10-15'), toDate: new Date('2026-10-15T18:29:59.999Z'), leaveType: { code: 'CL', name: 'Casual Leave' } }] },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    expect(corrected.byEmployee(10).absentDays).toBe(0);
    expect(corrected.byEmployee(10).basicSalary).toBe(30000);
  });

  it('7. rounds to paise and respects IST payroll-period boundaries', async () => {
    const attendance = [
      ...fullMonth(2026, 10).filter((row) => businessDayKey(row.date) !== '2026-10-20'),
      present('2026-11-02'),
    ];
    const { byEmployee } = await runPayroll({
      employees: [employee(10, { salaryStructures: [{ ...employee(10).salaryStructures[0], basicSalary: 31111 }] })],
      attendanceByEmployee: { 10: attendance },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    const item = byEmployee(10);
    expect(item.presentDays).toBe(21);
    expect(item.basicSalary).toBe(30073.97);
  });

  it('7b. February full attendance is not underpaid by a 30-day divisor', async () => {
    const { byEmployee } = await runPayroll(
      {
        employees: [employee(10)],
        attendanceByEmployee: { 10: fullMonth(2026, 2) },
        payrollPolicy: { workingDaysPerMonth: 30 },
      },
      2026,
      2,
    );
    expect(byEmployee(10).basicSalary).toBe(30000);
  });

  it('9. only BPO employees keep a salary-structure commission; the policy % is never applied', async () => {
    const structure = { ...employee(10).salaryStructures[0], commission: 2000 };
    const { byEmployee } = await runPayroll({
      employees: [
        employee(10, { salaryStructures: [structure] }),
        employee(11, { designation: { name: 'Telecaller' }, department: { name: 'BPO' }, salaryStructures: [structure] }),
        employee(12),
      ],
      attendanceByEmployee: { 10: fullMonth(2026, 10), 11: fullMonth(2026, 10), 12: fullMonth(2026, 10) },
      payrollPolicy: { workingDaysPerMonth: 30 },
      salaryPolicy: { commissionEnabled: true, commissionPercentage: 10, workingDaysPerMonth: 30 },
    });
    expect(byEmployee(10).commission).toBe(0);
    expect(byEmployee(11).commission).toBe(2000);
    expect(byEmployee(12).commission).toBe(0);
  });

  it('13. a finalized payroll cannot be recalculated and keeps its items', async () => {
    for (const status of ['APPROVED', 'GENERATED', 'PAID']) {
      const { prisma } = buildPrisma({
        employees: [employee(10)],
        existingPayroll: { id: 77, customerId: TENANT, month: 10, year: 2026, status },
      });
      const service = new PayrollService(prisma);
      await expect(service.calculatePayroll(TENANT, 10, 2026)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payrollItem.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('13b. a draft payroll recalculates from current attendance', async () => {
    const { byEmployee, prisma } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: fullMonth(2026, 10) },
      existingPayroll: { id: 77, customerId: TENANT, month: 10, year: 2026, status: 'CALCULATED' },
      payrollPolicy: { workingDaysPerMonth: 30 },
    });
    expect(prisma.payrollItem.deleteMany).toHaveBeenCalledWith({ where: { payrollId: 77, status: { not: 'PAID' } } });
    expect(byEmployee(10).basicSalary).toBe(30000);
  });

  it('14. reads attendance, leave and holidays only for the payroll tenant', async () => {
    const { prisma } = await runPayroll({
      employees: [employee(10)],
      attendanceByEmployee: { 10: fullMonth(2026, 10) },
    });
    for (const call of prisma.attendance.findMany.mock.calls) expect(call[0].where.customerId).toBe(TENANT);
    for (const call of prisma.leaveRequest.findMany.mock.calls) expect(call[0].where.customerId).toBe(TENANT);
    expect(prisma.publicHoliday.findMany.mock.calls[0][0].where.customerId).toBe(TENANT);
    expect(prisma.employee.findMany.mock.calls[0][0].where.customerId).toBe(TENANT);
  });
});


describe('Calendar count regression checks', () => {
  it('preserves actual October 2026 five/six-day calendar counts', () => {
    const service = new PayrollService({} as any);
    expect(service.calculateWorkingDays(2026, 10, 5)).toBe(22);
    expect(service.calculateWorkingDays(2026, 10, 6)).toBe(27);
    expect(service.calculateWorkingDays(2026, 2, 5)).toBe(20);
    expect(service.calculateWorkingDays(2024, 2, 7)).toBe(29);
  });
  it('selects a qualifying punched duplicate rather than an unordered absent row', () => {
    const input: any = { days: [new Date('2026-10-01T00:00:00Z')], joiningKey: null, isWeeklyOff: () => false,
      leaves: [], holidayKeys: new Set(), halfDayDeductionPct: 50, absenceDeductionPct: 100 };
    const valid = present('2026-10-01');
    const absent = { ...valid, status: 'ABSENT' };
    for (const attendances of [[absent, valid], [valid, absent]]) {
      expect(classifyPayrollDays({ ...input, attendances })).toMatchObject({ presentDays: 1, absentDays: 0, scheduledWorkingDays: 1 });
    }
  });
  it('honors a non-Sunday weekly off and office-scoped company schedule', async () => {
    const result = await runPayroll({ employees: [employee(91, { officeId: 4 })], attendancePolicy: { workingDaysPerWeek: 6 },
      attendanceByEmployee: { 91: fullMonth(2026, 10) } });
    expect(result.byEmployee(91).workingDays).toBe(27);
    expect(result.prisma.attendancePolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ officeId: 4 }) }));
    const service = new PayrollService({} as any);
    expect(service.calculateWorkingDays(2026, 10, 5, ['Sunday'])).toBe(4);
  });
});
