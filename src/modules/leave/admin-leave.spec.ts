import { AttendanceStatus, RequestStatus } from '@prisma/client';
import { LeaveService } from './leave.service';

describe('Admin-Applied Leave & Cancellation', () => {
  const buildService = () => {
    const balanceRow = {
      id: 10,
      customerId: 1,
      employeeId: 5,
      leaveTypeId: 2,
      year: 2026,
      allocatedDays: 12,
      usedDays: 1,
      remainingDays: 11,
    };

    const createdLeave = {
      id: 77,
      customerId: 1,
      employeeId: 5,
      leaveTypeId: 2,
      fromDate: new Date('2026-12-05T00:00:00.000Z'),
      toDate: new Date('2026-12-05T23:59:59.999Z'),
      days: 0.5,
      durationType: 'HALF_DAY',
      halfDaySession: 'FIRST_HALF',
      appliedBySource: 'ADMIN',
      appliedById: 99,
      appliedByName: 'HR Admin',
      status: RequestStatus.PENDING,
      employee: {
        id: 5,
        firstName: 'Aarav',
        lastName: 'Sharma',
        officeId: 1,
        shift: {
          id: 1,
          name: 'Day Shift',
          startTime: '09:30 AM',
          endTime: '06:30 PM',
          breakDurationMinutes: 60,
        },
      },
      leaveType: { id: 2, name: 'Casual Leave', code: 'CL', daysAllowedPerYear: 12 },
    };

    const auditLogs: any[] = [];
    const attendanceUpdates: any[] = [];
    const balanceUpdates: any[] = [];

    const prisma: any = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      employee: {
        findFirst: jest.fn().mockResolvedValue(createdLeave.employee),
      },
      leaveType: {
        findFirst: jest.fn().mockResolvedValue(createdLeave.leaveType),
      },
      attendancePolicy: {
        findFirst: jest.fn().mockResolvedValue({ workingDaysPerWeek: 5 }),
      },
      leavePolicy: {
        findFirst: jest.fn().mockResolvedValue({ allowHalfDay: true, minNoticePeriodDays: 0 }),
      },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 501,
            employeeId: 5,
            punchIn: new Date('2026-12-05T04:15:00.000Z'), // 09:45 AM IST
            punchOut: null,
            status: AttendanceStatus.PRESENT,
            isLate: false,
            lateMinutes: 0,
            lateDeduction: 0,
          },
        ]),
        update: jest.fn().mockImplementation(async (args: any) => {
          attendanceUpdates.push(args.data);
          return { id: args.where.id, ...args.data };
        }),
      },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(createdLeave),
        findFirst: jest.fn().mockResolvedValue({ ...createdLeave, status: RequestStatus.APPROVED }),
        update: jest.fn().mockImplementation(async (args: any) => ({
          ...createdLeave,
          ...args.data,
        })),
      },
      employeeLeaveBalance: {
        findFirst: jest.fn().mockResolvedValue({ ...balanceRow }),
        update: jest.fn().mockImplementation(async (args: any) => {
          balanceUpdates.push(args.data);
          return { ...balanceRow, ...args.data };
        }),
      },
      auditLog: {
        create: jest.fn().mockImplementation(async (args: any) => {
          auditLogs.push(args.data);
          return args.data;
        }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };

    const notificationService: any = {
      sendLeaveApprovalNotification: jest.fn().mockResolvedValue(true),
      notifyAdmins: jest.fn().mockResolvedValue(true),
    };

    const service = new LeaveService(prisma, notificationService);
    return { service, prisma, notificationService, auditLogs, balanceUpdates, attendanceUpdates, createdLeave };
  };

  it('auto-approves half-day leave applied by admin, deducts 0.5 day, logs audit, and notifies employee', async () => {
    const { service, prisma, notificationService, auditLogs, balanceUpdates } = buildService();
    // Make approveLeave see PENDING inside $transaction
    prisma.leaveRequest.findFirst.mockResolvedValueOnce({
      ...(await prisma.leaveRequest.create()),
      status: RequestStatus.PENDING,
    });

    const res: any = await service.createLeave(
      { id: 99, role: 'CUSTOMER_ADMIN', firstName: 'HR', lastName: 'Admin' },
      1,
      {
        employeeId: 5,
        leaveTypeId: 2,
        fromDate: '2026-12-05',
        toDate: '2026-12-05',
        durationType: 'HALF_DAY',
        halfDaySession: 'FIRST_HALF',
        reason: 'Medical appointment',
      },
    );

    expect(res.success).toBe(true);
    expect(res.data.status).toBe(RequestStatus.APPROVED);
    expect(balanceUpdates[0].usedDays).toBe(1.5);
    expect(balanceUpdates[0].remainingDays).toBe(10.5);
    expect(auditLogs.some((l) => l.action === 'CREATE')).toBe(true);
    expect(notificationService.sendLeaveApprovalNotification).toHaveBeenCalled();
  });

  it('restores leave balance, recalculates attendance, and logs audit on leave cancellation', async () => {
    const { service, balanceUpdates, attendanceUpdates, auditLogs } = buildService();

    const res: any = await service.cancelLeave(
      { id: 99, role: 'CUSTOMER_ADMIN', firstName: 'HR', lastName: 'Admin' },
      1,
      77,
    );

    expect(res.success).toBe(true);
    expect(res.data.status).toBe(RequestStatus.CANCELLED);
    expect(balanceUpdates[0].usedDays).toBe(0.5);
    expect(balanceUpdates[0].remainingDays).toBe(11.5);
    expect(attendanceUpdates[0].isHalfDayLeave).toBe(false);
    expect(attendanceUpdates[0].leaveRequestId).toBeNull();
    expect(auditLogs.some((l) => l.action === 'CANCEL')).toBe(true);
  });
});
