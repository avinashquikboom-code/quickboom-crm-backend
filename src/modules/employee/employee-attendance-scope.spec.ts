import { EmployeeService } from './employee.service';
import { ForbiddenException } from '@nestjs/common';

describe('Attendance list scope', () => {
  function fixture() {
    const record = {
      id: 101, customerId: 3, employeeId: 22,
      date: new Date('2026-10-13T00:00:00+05:30'),
      punchIn: new Date('2026-10-13T09:00:00+05:30'),
      punchOut: new Date('2026-10-13T18:00:00+05:30'),
      breaks: [], status: 'PRESENT', workingMinutes: 540,
      employee: { firstName: 'Test', lastName: 'Employee', employeeCode: 'TEST', branch: 'Office' },
    };
    const matching = ({ where }: any) => where.employeeId && where.employeeId !== record.employeeId ? [] : [record];
    const prisma = {
      attendance: {
        findMany: jest.fn(async args => matching(args)),
        count: jest.fn(async args => matching(args).length),
      },
      branchGeofence: { findMany: jest.fn().mockResolvedValue([{ id: 7, name: 'Office' }]) },
    };
    const service = new EmployeeService(prisma as any);
    jest.spyOn(service as any, 'autoCheckOutOpenAttendances').mockResolvedValue(undefined);
    return { service, prisma };
  }

  it.each(['SUPER_ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN'])('does not restrict %s to its linked employee', async role => {
    const { service, prisma } = fixture();
    const result = await service.getAttendance({ role, employee: { id: 11 } }, 3, role === 'SUPER_ADMIN', {
      date: '2026-10-13', branch: 'Office', page: 1, limit: 20,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].attendanceDate).toBe('2026-10-13');
    const query = prisma.attendance.findMany.mock.calls[0][0];
    expect(query.where.employeeId).toBeUndefined();
    expect(query.where.customerId).toBe(3);
    expect(query.where.employee.OR).toContainEqual({ officeId: 7 });
    expect(query.where.date).toEqual({
      gte: new Date('2026-10-12T18:30:00.000Z'),
      lte: new Date('2026-10-13T18:29:59.999Z'),
    });
    expect(query.skip).toBe(0);
    expect(query.take).toBe(20);
    expect(prisma.attendance.count).toHaveBeenCalledWith({ where: query.where });
  });

  it('keeps ordinary employees limited to their own recorded attendance', async () => {
    const { service, prisma } = fixture();
    const result = await service.getAttendance({ role: 'EMPLOYEE', employee: { id: 11 } }, 3, false, { date: '2026-10-13' });
    expect(result.data).toEqual([]);
    expect(prisma.attendance.findMany.mock.calls[0][0].where.employeeId).toBe(11);
  });

  it('still rejects non-super-admin access without tenant context', async () => {
    const { service, prisma } = fixture();
    await expect(service.getAttendance({ role: 'COMPANY_ADMIN', employee: { id: 11 } }, undefined, false)).rejects.toThrow(ForbiddenException);
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });
});
