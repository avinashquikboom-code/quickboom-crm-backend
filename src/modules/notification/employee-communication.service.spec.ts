import { EmployeeCommunicationService } from './employee-communication.service';

describe('EmployeeCommunicationService', () => {
  const employee = {
    id: 11,
    customerId: 4,
    userId: 20,
    email: 'sumit@example.com',
    phone: '9876543210',
    firstName: 'Sumit',
    lastName: 'Parmar',
    employeeCode: 'EMP-011',
    status: 'ACTIVE',
  };

  function build() {
    const logs: any[] = [];
    const prisma: any = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee) },
      emailLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(async ({ data }) => {
          const row = { id: logs.length + 1, ...data, createdAt: new Date(), sentAt: new Date() };
          logs.push(row);
          return row;
        }),
      },
      salarySlip: { findUnique: jest.fn() },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const emailService = { sendEmail: jest.fn().mockResolvedValue({ success: true }) };
    const whatsappService = {
      sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.1' }),
      sendDocumentMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.doc' }),
    };
    const service = new EmployeeCommunicationService(prisma, emailService as any, whatsappService as any);
    return { service, prisma, emailService, whatsappService, logs };
  }

  it('sends task email and WhatsApp independently and records both', async () => {
    const { service, emailService, whatsappService, logs } = build();
    const result = await service.notifyTaskAssigned({
      employeeId: 11,
      taskId: 5,
      title: 'Shoot',
      customerName: 'Keli',
      priority: 'HIGH',
      dueDate: '2026-10-11',
      assignedBy: 'Admin',
    });
    expect(emailService.sendEmail).toHaveBeenCalled();
    expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
      '9876543210',
      'employee_task_assigned',
      expect.any(Array),
      'en_US',
      expect.stringContaining('Shoot'),
      'TASK_ASSIGNED',
      4,
      20,
    );
    expect((result as any).email.status).toBe('SENT');
    expect((result as any).whatsapp.status).toBe('SENT');
    expect(logs.map((row) => row.channel).sort()).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('still sends WhatsApp when email fails', async () => {
    const { service, emailService, whatsappService } = build();
    emailService.sendEmail.mockRejectedValue(new Error('smtp down'));
    const result = await service.notifyTaskAssigned({ employeeId: 11, taskId: 6, title: 'Edit' });
    expect((result as any).email.status).toBe('FAILED');
    expect((result as any).whatsapp.status).toBe('SENT');
    expect(whatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('still sends email when WhatsApp fails', async () => {
    const { service, emailService, whatsappService } = build();
    whatsappService.sendTemplate.mockResolvedValue({ success: false, reason: 'template missing' });
    const result = await service.notifyTaskAssigned({ employeeId: 11, taskId: 7, title: 'Edit' });
    expect((result as any).email.status).toBe('SENT');
    expect((result as any).whatsapp.status).toBe('FAILED');
    expect(emailService.sendEmail).toHaveBeenCalled();
  });

  it('does not send a duplicate when the same event was already sent', async () => {
    const { service, prisma, emailService } = build();
    prisma.emailLog.findFirst.mockResolvedValue({ id: 1 });
    const result = await service.notifyTaskAssigned({ employeeId: 11, taskId: 5, title: 'Shoot' });
    expect((result as any).email.skipped).toBe(true);
    expect((result as any).whatsapp.skipped).toBe(true);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send another company salary slip', async () => {
    const { service, prisma, emailService } = build();
    prisma.salarySlip.findUnique.mockResolvedValue({
      id: 3,
      customerId: 9,
      payPeriod: 'September 2026',
      grossSalary: 100,
      totalDeductions: 10,
      netSalary: 90,
      slipNumber: 'SLIP-1',
      employee,
    });
    const result = await service.notifySalarySlip({ slipId: 3, customerId: 4 });
    expect(result).toEqual({ skipped: true, reason: 'FORBIDDEN' });
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('records a failed WhatsApp attempt when the employee has no mobile number', async () => {
    const { service, prisma, whatsappService, logs } = build();
    prisma.employee.findUnique.mockResolvedValue({ ...employee, phone: null });
    const result = await service.notifyTaskAssigned({ employeeId: 11, taskId: 8, title: 'Shoot' });
    expect((result as any).whatsapp.status).toBe('FAILED');
    expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    expect(logs.find((row) => row.channel === 'WHATSAPP')?.errorMessage).toContain('missing');
  });
});
