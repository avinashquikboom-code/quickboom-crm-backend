import { Test, TestingModule } from '@nestjs/testing';
import { RemoteWorkService } from './remote-work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RequestStatus } from '@prisma/client';

describe('RemoteWorkService End-to-End Scoping & Approval Tests', () => {
  let service: RemoteWorkService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      customer: {
        findFirst: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
      },
      remoteRequest: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemoteWorkService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: { sendRemoteWorkNotification: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<RemoteWorkService>(RemoteWorkService);
  });

  describe('1. Admin vs Employee Role Scoping in findAll', () => {
    const mockRequest1 = {
      id: 1,
      customerId: 1,
      employeeId: 9, // Submitted by Employee EMP-009
      fromDate: new Date('2026-09-19'),
      toDate: new Date('2026-09-19'),
      startTime: '09:00 AM',
      endTime: '06:00 PM',
      days: 1,
      reason: 'Home emergency / remote work',
      status: RequestStatus.PENDING,
      createdAt: new Date('2026-09-19T10:00:00Z'),
      employee: {
        id: 9,
        employeeCode: 'EMP-009',
        firstName: 'Tirthraj',
        lastName: 'Solanki',
        department: { name: 'Engineering' },
        designation: { name: 'Senior Developer' },
        office: { name: 'Head Office', city: 'Mumbai' },
      },
    };

    it('Admin user with linked employee profile sees ALL employee requests (NOT scoped to own employeeId)', async () => {
      const adminUser = {
        id: 1,
        email: 'admin@quickboom.com',
        role: 'ADMIN',
        roles: ['ADMIN'],
        employee: { id: 1, employeeCode: 'EMP-001' }, // Admin has their own employee profile
      };

      mockPrisma.remoteRequest.findMany.mockResolvedValue([mockRequest1]);
      mockPrisma.remoteRequest.count.mockResolvedValue(1);

      const result = await service.findAll(adminUser, 1, { status: 'PENDING' });

      // Verify that findMany was NOT called with employeeId: 1
      const findManyCall = mockPrisma.remoteRequest.findMany.mock.calls[0][0];
      expect(findManyCall.where.employeeId).toBeUndefined();
      expect(findManyCall.where.customerId).toBe(1);
      expect(findManyCall.where.status).toBe(RequestStatus.PENDING);

      // Verify results
      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].employeeCode).toBe('EMP-009');
      expect(result.requests[0].employeeName).toBe('Tirthraj Solanki');
      expect(result.requests[0].status).toBe(RequestStatus.PENDING);
      expect(result.summary.totalRequests).toBe(1);
      expect(result.summary.pending).toBe(1);
    });

    it('Strict Employee user (mobile app) IS scoped strictly to their own employee ID', async () => {
      const employeeUser = {
        id: 9,
        email: 'tirthraj@quickboom.com',
        role: 'EMPLOYEE',
        roleType: 'EMPLOYEE',
        roles: ['EMPLOYEE'],
        employee: { id: 9, employeeCode: 'EMP-009' },
      };

      mockPrisma.remoteRequest.findMany.mockResolvedValue([mockRequest1]);
      mockPrisma.remoteRequest.count.mockResolvedValue(1);

      const result = await service.findAll(employeeUser, 1);

      // Verify that findMany was called with employeeId: 9
      const findManyCall = mockPrisma.remoteRequest.findMany.mock.calls[0][0];
      expect(findManyCall.where.employeeId).toBe(9);
      expect(findManyCall.where.customerId).toBe(1);

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].employeeCode).toBe('EMP-009');
    });

    it('All tab (status=ALL or undefined) returns all requests without status filter', async () => {
      const adminUser = {
        id: 1,
        role: 'ADMIN',
        roles: ['ADMIN'],
        employee: { id: 1 },
      };

      mockPrisma.remoteRequest.findMany.mockResolvedValue([mockRequest1]);
      mockPrisma.remoteRequest.count.mockResolvedValue(1);

      const result = await service.findAll(adminUser, 1, { status: 'ALL' });
      const findManyCall = mockPrisma.remoteRequest.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBeUndefined();
      expect(result.requests).toHaveLength(1);
    });
  });

  describe('2. Remote Work Approval and Rejection Flow', () => {
    it('approves a pending remote work request and updates status', async () => {
      const adminUser = {
        id: 1,
        firstName: 'System',
        lastName: 'Admin',
        role: 'ADMIN',
      };

      const pendingRequest = {
        id: 1,
        customerId: 1,
        employeeId: 9,
        status: RequestStatus.PENDING,
        employee: { firstName: 'Tirthraj' },
      };

      mockPrisma.remoteRequest.findFirst.mockResolvedValue(pendingRequest);
      mockPrisma.remoteRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.APPROVED,
        approvedById: 1,
        approvedByName: 'System Admin',
        approvedAt: new Date(),
      });

      const res = await service.approve(adminUser, 1, '1');
      expect(res.success).toBe(true);
      expect(res.data.status).toBe(RequestStatus.APPROVED);
      expect(res.data.approvedByName).toBe('System Admin');
    });

    it('rejects a pending remote work request with mandatory reason', async () => {
      const adminUser = {
        id: 1,
        firstName: 'System',
        lastName: 'Admin',
        role: 'ADMIN',
      };

      const pendingRequest = {
        id: 1,
        customerId: 1,
        employeeId: 9,
        status: RequestStatus.PENDING,
        employee: { firstName: 'Tirthraj' },
      };

      mockPrisma.remoteRequest.findFirst.mockResolvedValue(pendingRequest);
      mockPrisma.remoteRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.REJECTED,
        rejectedById: 1,
        rejectedByName: 'System Admin',
        rejectedAt: new Date(),
        rejectionReason: 'Mandatory client meeting in office',
      });

      const res = await service.reject(adminUser, 1, '1', {
        rejectionReason: 'Mandatory client meeting in office',
      });

      expect(res.success).toBe(true);
      expect(res.data.status).toBe(RequestStatus.REJECTED);
      expect(res.data.rejectionReason).toBe('Mandatory client meeting in office');
    });
  });
});
