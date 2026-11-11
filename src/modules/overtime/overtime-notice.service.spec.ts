import { OvertimeNoticeService } from './overtime-notice.service';

describe('OvertimeNoticeService', () => {
  const request = {
    id: 9,
    employeeId: 4,
    totalMinutes: 120,
    approvedMinutes: 60,
    overtimeDate: new Date('2026-11-01T00:00:00.000Z'),
    startTime: '18:00',
    endTime: '20:00',
    reason: 'Release',
    rejectionReason: null,
    approvedByName: 'HR',
    rejectedByName: null,
    employee: { id: 4, firstName: 'Asha', lastName: 'Patil', email: 'asha@example.com', phone: '9000000000', userId: 11, managerId: 7, whatsappReportsOptIn: false },
  };
  const created: any[] = [];
  const prisma: any = {
    overtimeRequest: { findFirst: jest.fn(async () => request) },
    user: { findFirst: jest.fn(async () => ({ id: 11 })) },
    employee: { findMany: jest.fn(async () => [{ id: 7, firstName: 'Ravi', lastName: 'Lead', email: 'ravi@example.com', phone: null, userId: 22, whatsappReportsOptIn: false }]), findFirst: jest.fn() },
    overtimeNotificationEvent: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => { const row = { id: created.length + 1, ...data }; created.push(row); return row; }),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    notification: { create: jest.fn(async () => ({ id: 1 })) },
  };
  const email = { sendEmail: jest.fn(async () => ({ success: true })) };

  it('records in-app and email separately and skips WhatsApp without opt-in', async () => {
    const service = new OvertimeNoticeService(prisma, email as any, undefined);
    await service.publish(1, 9, 'SUBMITTED');
    const channels = created.map((row) => `${row.eventType}:${row.channel}`);
    expect(channels).toEqual(expect.arrayContaining(['SUBMITTED:IN_APP', 'SUBMITTED:EMAIL', 'SUBMITTED:WHATSAPP', 'RECEIVED:IN_APP', 'RECEIVED:EMAIL']));
    expect(email.sendEmail).toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalled();
    const skipped = prisma.overtimeNotificationEvent.update.mock.calls.map((call) => call[0].data).filter((data) => data.status === 'SKIPPED');
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('does not send a second copy when the same channel was already sent', async () => {
    prisma.overtimeNotificationEvent.findUnique.mockResolvedValue({ id: 1, status: 'SENT' });
    created.length = 0;
    email.sendEmail.mockClear();
    const service = new OvertimeNoticeService(prisma, email as any, undefined);
    await service.publish(1, 9, 'REJECTED');
    expect(created).toHaveLength(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
