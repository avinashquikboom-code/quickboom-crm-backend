import { BadRequestException, ConflictException } from '@nestjs/common';
import { HiringService } from './hiring.service';

describe('HiringService', () => {
  const makePrismaMock = () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'QB Suite', companyName: 'QB Suite' }),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([{ id: 10, name: 'Sales' }]),
        findFirst: jest.fn().mockResolvedValue({ id: 10, name: 'Sales' }),
      },
      hiringForm: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 1, ...data })),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 1 }),
      },
      candidateApplication: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 101, ...data })),
        update: jest.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      },
      candidateInterview: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 201, ...data })),
      },
      candidateStatusHistory: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 301, ...data })),
      },
      candidateNotificationLog: {
        create: jest.fn().mockResolvedValue({ id: 401 }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    return prisma;
  };

  it('creates a hiring form with an unpredictable crypto token', async () => {
    const prisma = makePrismaMock();
    const service = new HiringService(prisma);
    const res = await service.createForm({ id: 5, customerId: 1 }, 1, {
      title: 'Sales Executive Hiring',
      description: 'Apply now',
      departmentIds: [10],
    });
    expect(res.success).toBe(true);
    expect(res.data.token).toBeTruthy();
    expect(res.data.token.length).toBeGreaterThanOrEqual(24);
  });

  it('rejects inactive or expired public hiring forms', async () => {
    const prisma = makePrismaMock();
    const service = new HiringService(prisma);

    prisma.hiringForm.findUnique.mockResolvedValueOnce({
      id: 1,
      customerId: 1,
      token: 'closed-tok',
      isActive: false,
    });
    await expect(service.getPublicFormByToken('closed-tok')).rejects.toThrow(BadRequestException);

    prisma.hiringForm.findUnique.mockResolvedValueOnce({
      id: 1,
      customerId: 1,
      token: 'expired-tok',
      isActive: true,
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await expect(service.getPublicFormByToken('expired-tok')).rejects.toThrow(BadRequestException);
  });

  it('blocks honeypot spam submissions and duplicate applications within 24h', async () => {
    const prisma = makePrismaMock();
    const service = new HiringService(prisma);

    prisma.hiringForm.findUnique.mockResolvedValue({
      id: 1,
      customerId: 1,
      token: 'valid-tok',
      isActive: true,
      expiresAt: null,
      fieldConfig: null,
    });

    await expect(
      service.submitPublicApplication(
        'valid-tok',
        {
          candidateName: 'Bot User',
          countryCode: '+91',
          mobileNumber: '9876543210',
          email: 'bot@example.com',
          departmentId: 10,
          experience: '2 years',
          website: 'http://spam.example.com',
        },
        undefined,
        '127.0.0.1',
      ),
    ).rejects.toThrow(BadRequestException);

    prisma.candidateApplication.findFirst.mockResolvedValueOnce({ id: 99 });
    await expect(
      service.submitPublicApplication(
        'valid-tok',
        {
          candidateName: 'Real Candidate',
          countryCode: '+91',
          mobileNumber: '9876543210',
          email: 'real@example.com',
          departmentId: 10,
          experience: '2 years',
        },
        undefined,
        '127.0.0.1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects invalid resume file extensions and oversized files', async () => {
    const prisma = makePrismaMock();
    const service = new HiringService(prisma);

    prisma.hiringForm.findUnique.mockResolvedValue({
      id: 1,
      customerId: 1,
      token: 'valid-tok',
      isActive: true,
      expiresAt: null,
      fieldConfig: null,
    });

    await expect(
      service.submitPublicApplication(
        'valid-tok',
        {
          candidateName: 'Candidate One',
          countryCode: '+91',
          mobileNumber: '9876543211',
          email: 'c1@example.com',
          departmentId: 10,
          experience: '3 years',
        },
        {
          originalname: 'malware.exe',
          size: 1024,
          mimetype: 'application/octet-stream',
          buffer: Buffer.from('test'),
        } as any,
        '127.0.0.2',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.submitPublicApplication(
        'valid-tok',
        {
          candidateName: 'Candidate Two',
          countryCode: '+91',
          mobileNumber: '9876543212',
          email: 'c2@example.com',
          departmentId: 10,
          experience: '3 years',
        },
        {
          originalname: 'huge.pdf',
          size: 6 * 1024 * 1024,
          mimetype: 'application/pdf',
          buffer: Buffer.from('test'),
        } as any,
        '127.0.0.3',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('schedules an interview and records status history', async () => {
    const prisma = makePrismaMock();
    const service = new HiringService(prisma);

    prisma.candidateApplication.findFirst.mockResolvedValue({
      id: 101,
      customerId: 1,
      interviewStatus: 'NEW_APPLICATION',
      interviewDate: null,
    });

    const res = await service.scheduleInterview(
      { id: 7, firstName: 'HR', lastName: 'Lead', customerId: 1 },
      1,
      101,
      {
        interviewDate: '2026-12-01',
        interviewTime: '11:00',
        mode: 'ONLINE',
        meetingLink: 'https://meet.example.com/abc',
        notifyCandidate: false,
      },
    );

    expect(res.success).toBe(true);
    expect(prisma.candidateInterview.create).toHaveBeenCalled();
    expect(prisma.candidateApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101 },
        data: expect.objectContaining({
          interviewStatus: 'INTERVIEW_SCHEDULED',
          interviewDate: '2026-12-01',
          interviewTime: '11:00',
        }),
      }),
    );
    expect(prisma.candidateStatusHistory.create).toHaveBeenCalled();
  });

  it('prevents duplicate conversion of an already converted candidate', async () => {
    const prisma = makePrismaMock();
    const employeeServiceMock = { create: jest.fn() } as any;
    const service = new HiringService(prisma, undefined, undefined, undefined, employeeServiceMock);

    prisma.candidateApplication.findFirst.mockResolvedValue({
      id: 101,
      customerId: 1,
      convertedEmployeeId: 55,
      candidateName: 'Already Hired',
    });

    await expect(
      service.convertToEmployee(
        { id: 7, customerId: 1 },
        1,
        101,
        {
          joiningDate: '2026-12-01',
          departmentId: 10,
          password: 'Password123!',
        },
      ),
    ).rejects.toThrow(ConflictException);
    expect(employeeServiceMock.create).not.toHaveBeenCalled();
  });
});
