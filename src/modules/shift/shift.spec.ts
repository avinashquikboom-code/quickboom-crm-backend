import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShiftService } from './shift.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShiftService (HRM Shifts & Guidance)', () => {
  let service: ShiftService;
  let prisma: any;

  const mockShift = {
    id: 1,
    customerId: 3,
    name: 'General Day Shift',
    code: 'GDS-01',
    startTime: '09:30 AM',
    endTime: '06:30 PM',
    durationHours: 9.0,
    gracePeriodMinutes: 15,
    halfDayThresholdHours: 4.5,
    breakDurationMinutes: 60,
    isNightShift: false,
    isRotational: false,
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    color: '#3B82F6',
    status: 'ACTIVE',
    notes: 'Standard office hours',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    guidance: {
      id: 1,
      shiftId: 1,
      customerId: 3,
      overtimeRule: 'Overtime after 9h at 1.5x',
      punchInRule: '15m grace period',
      punchOutRule: 'Manager signoff required',
      breakPolicy: '1h lunch',
      nightShiftAllowance: 'N/A',
      swapPolicy: '24h notice',
      geofenceRequirement: '150m radius',
      emergencyContactProtocol: 'Call HR',
      notes: null,
    },
    _count: {
      employees: 5,
    },
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
      },
      shift: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      shiftGuidance: {
        create: jest.fn(),
        upsert: jest.fn(),
      },
      employee: {
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ShiftService>(ShiftService);
  });

  describe('getMetrics', () => {
    it('returns accurate workforce and shift metrics for valid customerId', async () => {
      prisma.shift.count
        .mockResolvedValueOnce(4) // total
        .mockResolvedValueOnce(3) // active
        .mockResolvedValueOnce(1) // nightShifts
        .mockResolvedValueOnce(1); // rotationalShifts
      prisma.employee.count.mockResolvedValueOnce(15); // assignedEmployees

      const result = await service.getMetrics(3);

      expect(result).toEqual({
        total: 4,
        active: 3,
        nightShifts: 1,
        rotationalShifts: 1,
        assignedEmployees: 15,
      });
      expect(prisma.shift.count).toHaveBeenCalledWith({
        where: { customerId: 3, deletedAt: null },
      });
    });

    it('safely handles undefined customerId by resolving first active customer', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 3 });
      prisma.shift.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prisma.employee.count.mockResolvedValueOnce(0);

      const result = await service.getMetrics(undefined);

      expect(result).toEqual({
        total: 0,
        active: 0,
        nightShifts: 0,
        rotationalShifts: 0,
        assignedEmployees: 0,
      });
      expect(prisma.customer.findFirst).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns list of shifts with employee counts', async () => {
      prisma.shift.findMany.mockResolvedValueOnce([mockShift]);

      const result = await service.findAll(3, {});

      expect(result).toHaveLength(1);
      expect(result[0].employeeCount).toBe(5);
      expect(result[0].name).toBe('General Day Shift');
    });

    it('filters by status and type', async () => {
      prisma.shift.findMany.mockResolvedValueOnce([]);

      await service.findAll(3, { status: 'ACTIVE', type: 'NIGHT', search: 'Night' });

      expect(prisma.shift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 3,
            status: 'ACTIVE',
            isNightShift: true,
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns shift details with employees and guidance', async () => {
      prisma.shift.findFirst.mockResolvedValueOnce(mockShift);

      const result = await service.findOne(3, 1);

      expect(result.id).toBe(1);
      expect(result.guidance).toBeDefined();
    });

    it('throws NotFoundException when shift does not exist', async () => {
      prisma.shift.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne(3, 999)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid id', async () => {
      await expect(service.findOne(3, 'invalid-id')).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('creates shift and corresponding shift guidance in transaction', async () => {
      prisma.shift.findFirst.mockResolvedValueOnce(null); // No existing code collision
      prisma.shift.create.mockResolvedValueOnce({ ...mockShift, id: 2 });
      prisma.shift.findUnique.mockResolvedValueOnce({ ...mockShift, id: 2 });

      const dto = {
        name: 'Morning Shift',
        code: 'MS-01',
        startTime: '08:00 AM',
        endTime: '05:00 PM',
        guidance: {
          overtimeRule: 'Overtime after 9h',
        },
      };

      const result = await service.create(3, dto as any);

      expect(prisma.shift.create).toHaveBeenCalled();
      expect(prisma.shiftGuidance.create).toHaveBeenCalled();
      expect(result.id).toBe(2);
    });

    it('throws BadRequestException when shift code already exists', async () => {
      prisma.shift.findFirst.mockResolvedValueOnce(mockShift);

      const dto = {
        name: 'Duplicate Shift',
        code: 'GDS-01',
        startTime: '09:30 AM',
        endTime: '06:30 PM',
      };

      await expect(service.create(3, dto as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignEmployees', () => {
    it('assigns specific employees and department to shift', async () => {
      prisma.shift.findFirst.mockResolvedValue(mockShift);

      await service.assignEmployees(3, 1, {
        employeeIds: [10, 11],
        departmentId: 2,
      });

      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { customerId: 3, id: { in: [10, 11] } },
        data: { shiftId: 1 },
      });
      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { customerId: 3, departmentId: 2 },
        data: { shiftId: 1 },
      });
    });
  });

  describe('delete', () => {
    it('soft deletes shift by setting deletedAt and status to INACTIVE', async () => {
      prisma.shift.findFirst.mockResolvedValueOnce(mockShift);
      prisma.shift.update.mockResolvedValueOnce({ ...mockShift, status: 'INACTIVE', deletedAt: new Date() });

      await service.delete(3, 1);

      expect(prisma.shift.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          status: 'INACTIVE',
          deletedAt: expect.any(Date),
        }),
      });
    });
  });
});
