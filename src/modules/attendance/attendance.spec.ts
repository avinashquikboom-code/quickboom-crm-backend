import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { AttendanceService, calculateDistanceMeters } from './attendance.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AttendanceService (Punch In / Punch Out & Geofencing)', () => {
  let service: AttendanceService;
  let prisma: any;

  const mockEmployee = {
    id: 10,
    customerId: 1,
    userId: 5,
    employeeCode: 'QB-EMP-010',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    status: 'ACTIVE',
    branch: 'Head Office',
    officeId: 1,
    office: {
      id: 1,
      customerId: 1,
      name: 'Head Office',
      city: 'Navi Mumbai',
      latitude: 19.0330,
      longitude: 73.0297,
      radiusMeters: 200.0,
      isActive: true,
    },
  };

  const mockUser = {
    id: 5,
    email: 'john.doe@example.com',
    customerId: 1,
    role: 'EMPLOYEE',
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      branchGeofence: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      attendancePolicy: {
        findFirst: jest.fn(),
      },
      remoteRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      attendance: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      attendanceBreak: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  describe('Haversine Distance Calculation', () => {
    it('calculates distance between two close points accurately in meters', () => {
      // (19.0330, 73.0297) to (19.0335, 73.0300) is ~63 meters
      const distance = calculateDistanceMeters(19.0330, 73.0297, 19.0335, 73.0300);
      expect(distance).toBeGreaterThan(40);
      expect(distance).toBeLessThan(100);
    });

    it('returns 0 for identical points', () => {
      const distance = calculateDistanceMeters(19.0330, 73.0297, 19.0330, 73.0297);
      expect(distance).toBe(0);
    });
  });

  describe('POST /attendance/punch-in (Geofencing & Validation)', () => {
    it('ALLOWS Punch In when employee GPS is within assigned office radius (distance <= 200m)', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);
      prisma.attendance.findFirst.mockResolvedValue(null);
      prisma.attendance.create.mockImplementation(({ data }: any) => ({
        id: 101,
        ...data,
      }));

      // Employee is ~63m away from office (within 200m radius)
      const result = await service.checkIn(mockUser, 1, {
        latitude: 19.0335,
        longitude: 73.0300,
        accuracy: 12.5,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Punch In successful');
      expect(result.office.distanceMeters).toBeLessThanOrEqual(200);
      expect(prisma.attendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 10,
            customerId: 1,
            officeId: 1,
            latitude: 19.0335,
            longitude: 73.0300,
            accuracy: 12.5,
          }),
        }),
      );
    });

    it('REJECTS Punch In with 403 Forbidden when employee GPS is outside assigned office radius (> 200m)', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);

      // Employee is at 19.0450, 73.0450 (~2.0 km away)
      await expect(
        service.checkIn(mockUser, 1, {
          latitude: 19.0450,
          longitude: 73.0450,
          accuracy: 10.0,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('REJECTS Punch In with 400 Bad Request for invalid latitude (>90 or <-90)', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);

      await expect(
        service.checkIn(mockUser, 1, {
          latitude: 95.0,
          longitude: 73.0297,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('REJECTS Punch In with 400 Bad Request for (0, 0) coordinates when office is not at (0, 0)', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);

      await expect(
        service.checkIn(mockUser, 1, {
          latitude: 0,
          longitude: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('REJECTS Duplicate Punch In with 409 Conflict when already punched in today', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);

      // Existing active attendance record today with punchIn and no punchOut
      prisma.attendance.findFirst.mockResolvedValue({
        id: 101,
        employeeId: 10,
        punchIn: new Date(),
        punchOut: null,
      });

      await expect(
        service.checkIn(mockUser, 1, {
          latitude: 19.0330,
          longitude: 73.0297,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('REJECTS Punch In with 403 Forbidden when employee is inactive', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        status: 'INACTIVE',
      });

      await expect(
        service.checkIn(mockUser, 1, {
          latitude: 19.0330,
          longitude: 73.0297,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('POST /attendance/punch-out', () => {
    it('ALLOWS Punch Out when active Punch In exists for today and calculates duration', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      prisma.attendance.findFirst.mockResolvedValue({
        id: 101,
        employeeId: 10,
        punchIn: twoHoursAgo,
        punchOut: null,
        status: 'PRESENT',
        breaks: [],
      });

      prisma.attendance.update.mockImplementation(({ data }: any) => ({
        id: 101,
        punchIn: twoHoursAgo,
        ...data,
      }));

      const result = await service.checkOut(mockUser, 1, {
        latitude: 19.0330,
        longitude: 73.0297,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Punch Out successful');
      expect(result.data.workingMinutes).toBeGreaterThanOrEqual(115);
      expect(prisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({
            punchOut: expect.any(Date),
            workingHours: expect.any(Number),
          }),
        }),
      );
    });

    it('REJECTS Punch Out with 404 Not Found when no active punch-in exists for today', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);
      prisma.attendance.findFirst.mockResolvedValue(null);

      await expect(
        service.checkOut(mockUser, 1, {
          latitude: 19.0330,
          longitude: 73.0297,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('REJECTS Punch Out with 409 Conflict when already punched out for today', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.branchGeofence.findUnique.mockResolvedValue(mockEmployee.office);
      prisma.attendancePolicy.findFirst.mockResolvedValue(null);

      prisma.attendance.findFirst.mockResolvedValue({
        id: 101,
        employeeId: 10,
        punchIn: new Date(Date.now() - 4 * 60 * 60 * 1000),
        punchOut: new Date(Date.now() - 1 * 60 * 60 * 1000),
        breaks: [],
      });

      await expect(
        service.checkOut(mockUser, 1, {
          latitude: 19.0330,
          longitude: 73.0297,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('GET /attendance/today', () => {
    it('returns PUNCHED_IN status and working minutes for employee currently working', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      prisma.attendance.findFirst.mockResolvedValue({
        id: 101,
        employeeId: 10,
        punchIn: oneHourAgo,
        punchOut: null,
        status: 'PRESENT',
        workingHours: 0,
        breaks: [],
      });

      const result = await service.getTodayAttendance(mockUser, 1);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('PUNCHED_IN');
      expect(result.data.isPunchedIn).toBe(true);
      expect(result.data.workingMinutes).toBeGreaterThanOrEqual(59);
    });

    it('returns NOT_MARKED when employee has not punched in today', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendance.findFirst.mockResolvedValue(null);

      const result = await service.getTodayAttendance(mockUser, 1);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('NOT_MARKED');
      expect(result.data.isPunchedIn).toBe(false);
      expect(result.data.workingMinutes).toBe(0);
    });
  });

  describe('GET /attendance/history', () => {
    it('returns only the authenticated employee attendance logs with pagination', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendance.count.mockResolvedValue(2);
      prisma.attendance.findMany.mockResolvedValue([
        {
          id: 101,
          employeeId: 10,
          customerId: 1,
          date: new Date('2026-08-31'),
          punchIn: new Date('2026-08-31T09:30:00Z'),
          punchOut: new Date('2026-08-31T18:30:00Z'),
          workingHours: 8.0,
          status: 'PRESENT',
          office: { id: 1, name: 'Head Office', city: 'Navi Mumbai', radiusMeters: 200 },
          breaks: [],
        },
      ]);

      const result = await service.getAttendanceHistory(mockUser, 1, {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.data.length).toBe(1);
      expect(prisma.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 10,
            customerId: 1,
          }),
        }),
      );
    });
  });

  describe('HRMS Live Dashboard', () => {
    const mockAdminUser = {
      id: 1,
      email: 'admin@quickboom.online',
      role: 'SUPER_ADMIN',
    };

    beforeEach(() => {
      prisma.customer = {
        findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'QuickBoom Inc' }),
      };
      prisma.employeeLocation = {
        findMany: jest.fn().mockResolvedValue([]),
      };
    });

    it('calculates full live dashboard summary with present, working, on-break, and radius status', async () => {
      prisma.employee.findMany = jest.fn().mockResolvedValue([
        {
          id: 10,
          customerId: 1,
          employeeCode: 'QB-001',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          status: 'ACTIVE',
          department: { name: 'Engineering' },
          designation: { name: 'Developer' },
          office: {
            id: 1,
            name: 'Head Office',
            city: 'Mumbai',
            latitude: 19.076,
            longitude: 72.8777,
            radiusMeters: 200,
          },
          shift: {
            id: 1,
            name: 'Morning Shift',
            code: 'MS-01',
            startTime: '09:30 AM',
            endTime: '06:30 PM',
            gracePeriodMinutes: 15,
            durationHours: 8,
          },
        },
      ]);

      prisma.branchGeofence.findMany = jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Head Office',
          city: 'Mumbai',
          latitude: 19.076,
          longitude: 72.8777,
          radiusMeters: 200,
          isActive: true,
        },
      ]);

      prisma.attendance.findMany = jest.fn().mockResolvedValue([
        {
          id: 50,
          customerId: 1,
          employeeId: 10,
          date: new Date(),
          punchIn: new Date(Date.now() - 3600000), // 1 hour ago
          punchOut: null,
          status: 'PRESENT',
          latitude: 19.0761,
          longitude: 72.8778,
          locationStatus: 'INSIDE_RADIUS',
          workMode: 'OFFICE',
          breaks: [],
        },
      ]);

      const result = await service.getLiveDashboardData(mockAdminUser, 1);

      expect(result.success).toBe(true);
      expect(result.data.summary.totalEmployees).toBe(1);
      expect(result.data.summary.present).toBe(1);
      expect(result.data.summary.absent).toBe(0);
      expect(result.data.summary.working).toBe(1);
      expect(result.data.summary.onBreak).toBe(0);
      expect(result.data.summary.insideRadius).toBe(1);
      expect(result.data.employees.length).toBe(1);
      expect(result.data.employees[0].currentStatus).toBe('WORKING');
    });

    it('identifies on-break status when active break is open', async () => {
      prisma.employee.findMany = jest.fn().mockResolvedValue([
        {
          id: 10,
          customerId: 1,
          employeeCode: 'QB-001',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          status: 'ACTIVE',
          department: { name: 'Engineering' },
          designation: { name: 'Developer' },
          office: {
            id: 1,
            name: 'Head Office',
            city: 'Mumbai',
            latitude: 19.076,
            longitude: 72.8777,
            radiusMeters: 200,
          },
        },
      ]);

      prisma.branchGeofence.findMany = jest.fn().mockResolvedValue([]);
      prisma.attendance.findMany = jest.fn().mockResolvedValue([
        {
          id: 50,
          customerId: 1,
          employeeId: 10,
          date: new Date(),
          punchIn: new Date(Date.now() - 7200000),
          punchOut: null,
          status: 'PRESENT',
          breaks: [
            {
              id: 1,
              breakStart: new Date(Date.now() - 600000),
              breakEnd: null,
              duration: null,
            },
          ],
        },
      ]);

      const result = await service.getLiveBreaks(mockAdminUser, 1);

      expect(result.success).toBe(true);
      expect(result.data.onBreakCount).toBe(1);
      expect(result.data.activeBreaks.length).toBe(1);
      expect(result.data.activeBreaks[0].breakStatus).toBe('ON_BREAK');
    });
  });

  describe('Break & Working Duration Formatting & Calculation', () => {
    it('formats minutes into Xh Ym correctly for all edge cases', () => {
      const { formatDurationHoursMinutes } = require('../../common/utils/timezone.util');

      expect(formatDurationHoursMinutes(0)).toBe('0h 0m');
      expect(formatDurationHoursMinutes(1)).toBe('0h 1m');
      expect(formatDurationHoursMinutes(30)).toBe('0h 30m');
      expect(formatDurationHoursMinutes(59)).toBe('0h 59m');
      expect(formatDurationHoursMinutes(60)).toBe('1h 0m');
      expect(formatDurationHoursMinutes(61)).toBe('1h 1m');
      expect(formatDurationHoursMinutes(90)).toBe('1h 30m');
      expect(formatDurationHoursMinutes(119)).toBe('1h 59m');
      expect(formatDurationHoursMinutes(120)).toBe('2h 0m');
      expect(formatDurationHoursMinutes(125)).toBe('2h 5m');
      expect(formatDurationHoursMinutes('90 min')).toBe('1h 30m');
      expect(formatDurationHoursMinutes('1h 30m')).toBe('1h 30m');
      expect(formatDurationHoursMinutes(null)).toBe('0h 0m');
    });

    it('calculates total break and net working duration accurately across multiple breaks', async () => {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000); // 120 mins gross
      const break1Start = new Date(Date.now() - 90 * 60 * 1000);
      const break1End = new Date(Date.now() - 75 * 60 * 1000); // 15 mins
      const break2Start = new Date(Date.now() - 60 * 60 * 1000);
      const break2End = new Date(Date.now() - 30 * 60 * 1000); // 30 mins
      // Total breaks = 45 mins (0h 45m). Net working = 120 - 45 = 75 mins (1h 15m)

      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.attendancePolicy.findFirst.mockResolvedValue({
        officeStartTime: '09:30',
        officeEndTime: '18:30',
        minWorkingHours: 8.0,
        earlyCheckoutGraceMinutes: 15,
        earlyCheckoutAction: 'HALF_DAY',
        breakType: 'UNPAID',
      });
      prisma.branchGeofence.findMany.mockResolvedValue([mockEmployee.office]);

      const existingAttendance = {
        id: 100,
        customerId: 1,
        employeeId: mockEmployee.id,
        punchIn: twoHoursAgo,
        punchOut: null,
        status: 'PRESENT',
        breaks: [
          { id: 1, breakStart: break1Start, breakEnd: break1End, duration: 15 },
          { id: 2, breakStart: break2Start, breakEnd: break2End, duration: 30 },
        ],
      };

      prisma.attendance.findFirst.mockResolvedValue(existingAttendance);
      prisma.attendance.update.mockImplementation(({ data }) => ({
        ...existingAttendance,
        ...data,
      }));

      const result = await service.checkOut(
        mockUser,
        1,
        {
          latitude: 19.0330,
          longitude: 73.0297,
          accuracy: 5.0,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.totalBreakMinutes).toBe(45);
      expect(result.data.breakDuration).toBe('0h 45m');
      expect(result.data.workingMinutes).toBe(75); // 120 gross - 45 break = 75
      expect(result.data.workingDuration).toBe('1h 15m');
    });
  });
});

