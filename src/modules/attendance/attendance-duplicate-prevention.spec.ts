import { AttendanceService } from './attendance.service';
import { EmployeeService } from '../employee/employee.service';
import { ConflictException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';

describe('Attendance Duplicate Prevention & Daily Grouping', () => {
  let attendanceService: AttendanceService;
  let employeeService: EmployeeService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findFirst: jest.fn(),
      },
      branchGeofence: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      attendancePolicy: {
        findFirst: jest.fn().mockResolvedValue({
          officeStartTime: '09:30',
          officeEndTime: '18:30',
          gracePeriodMinutes: 15,
          minWorkingHours: 9.0,
        }),
      },
      remoteRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      attendance: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      attendanceBreak: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        return cb(mockPrisma);
      }),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 13 }]),
    };

    attendanceService = new AttendanceService(mockPrisma);
    employeeService = new EmployeeService(mockPrisma, null as any);
  });

  describe('TEST 1 & 2: Multiple check-in calls on the same day', () => {
    it('rejects duplicate check-in with 409 Conflict if employee already punched in today', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: 13,
        employeeCode: 'QB-EMP-013',
        customerId: 1,
        status: 'ACTIVE',
        office: { id: 1, customerId: 1, name: 'Head Office', latitude: 19.033, longitude: 73.0297, radiusMeters: 200, isActive: true },
      });

      // Existing open punch-in for today
      mockPrisma.attendance.findFirst.mockResolvedValue({
        id: 101,
        employeeId: 13,
        punchIn: new Date(),
        punchOut: null,
      });

      await expect(
        attendanceService.checkIn(
          { id: 3, role: 'EMPLOYEE', email: 'emp013@quickboom.com' },
          1,
          { latitude: 19.033, longitude: 73.0297 },
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.attendance.create).not.toHaveBeenCalled();
    });
  });

  describe('TEST 7: Daily Attendance Consolidation (getAttendance)', () => {
    it('consolidates multiple duplicate attendance rows on the same date into exactly 1 record', async () => {
      // Suppose DB had 3 accidental duplicate rows for 2026-09-23
      const duplicateRows = [
        {
          id: 5,
          customerId: 1,
          employeeId: 13,
          date: new Date('2026-09-23T06:04:00.000Z'),
          punchIn: new Date('2026-09-23T06:04:00.000Z'),
          punchOut: new Date('2026-09-23T13:00:00.000Z'),
          workingMinutes: 416,
          workingHours: 6.93,
          status: AttendanceStatus.PRESENT,
          locationIn: 'QUIKBOOM MARKETING AGENCY (192m)',
          locationOut: null,
          breaks: [],
          employee: { firstName: 'Aarav', lastName: 'Patel', employeeCode: 'QB-EMP-013', office: { name: 'Head Office' } },
        },
        {
          id: 4,
          customerId: 1,
          employeeId: 13,
          date: new Date('2026-09-23T06:04:00.000Z'),
          punchIn: new Date('2026-09-23T06:04:00.000Z'),
          punchOut: null,
          workingMinutes: 0,
          workingHours: 0,
          status: AttendanceStatus.PRESENT,
          locationIn: 'QUIKBOOM MARKETING AGENCY (192m)',
          locationOut: null,
          breaks: [],
          employee: { firstName: 'Aarav', lastName: 'Patel', employeeCode: 'QB-EMP-013', office: { name: 'Head Office' } },
        },
        {
          id: 3,
          customerId: 1,
          employeeId: 13,
          date: new Date('2026-09-23T06:03:00.000Z'),
          punchIn: new Date('2026-09-23T06:03:00.000Z'),
          punchOut: null,
          workingMinutes: 0,
          workingHours: 0,
          status: AttendanceStatus.PRESENT,
          locationIn: 'QUIKBOOM MARKETING AGENCY (192m)',
          locationOut: null,
          breaks: [],
          employee: { firstName: 'Aarav', lastName: 'Patel', employeeCode: 'QB-EMP-013', office: { name: 'Head Office' } },
        },
        // And 1 record for yesterday
        {
          id: 2,
          customerId: 1,
          employeeId: 13,
          date: new Date('2026-09-22T05:02:00.000Z'),
          punchIn: new Date('2026-09-22T05:02:00.000Z'),
          punchOut: new Date('2026-09-22T13:15:00.000Z'),
          workingMinutes: 493,
          workingHours: 8.22,
          status: AttendanceStatus.PRESENT,
          locationIn: 'QUIKBOOM MARKETING AGENCY (192m)',
          locationOut: null,
          breaks: [],
          employee: { firstName: 'Aarav', lastName: 'Patel', employeeCode: 'QB-EMP-013', office: { name: 'Head Office' } },
        },
      ];

      mockPrisma.attendance.findMany.mockResolvedValue(duplicateRows);
      mockPrisma.attendance.count.mockResolvedValue(4);

      const result = await employeeService.getAttendance(
        { id: 3, role: 'EMPLOYEE' },
        1,
        false,
        {},
      );

      // Even though DB had 4 rows (3 for 23 Sep and 1 for 22 Sep), the API returns exactly 2 records!
      expect(result.data.length).toBe(2);
      expect(result.data[0].date).toBe('2026-09-23');
      expect(result.data[0].checkIn).toBeDefined();
      expect(result.data[0].checkOut).toBeDefined();
      expect(result.data[1].date).toBe('2026-09-22');
    });
  });
});
