import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getLiveMetrics(tenantId: string, officeId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const offices = [
      { id: 'off-1', name: 'Head Office', city: 'Mumbai', totalEmployees: 52, present: 41, absent: 5, late: 3, onLeave: 2, remote: 1, working: 38, checkedOut: 3 },
      { id: 'off-2', name: 'Navi Mumbai Branch', city: 'Navi Mumbai', totalEmployees: 38, present: 31, absent: 3, late: 2, onLeave: 1, remote: 1, working: 28, checkedOut: 3 },
      { id: 'off-3', name: 'Mumbai Central Branch', city: 'Mumbai', totalEmployees: 27, present: 22, absent: 2, late: 1, onLeave: 1, remote: 1, working: 20, checkedOut: 2 },
    ];

    const summary = {
      totalEmployees: 117,
      present: 94,
      absent: 10,
      late: 6,
      onLeave: 4,
      remote: 3,
      working: 86,
      onBreak: 8,
      checkedOut: 8,
      locationTrackingActive: 94,
    };

    const recentPunchIns = [
      { id: 'p-1', employee: 'Demo User', employeeId: 'EMP001', office: 'Head Office', punchInTime: '09:12 AM', location: 'Office GPS', status: 'On Time' },
      { id: 'p-2', employee: 'Rahul Sharma', employeeId: 'EMP002', office: 'Navi Mumbai Branch', punchInTime: '09:26 AM', location: 'Office GPS', status: 'Late by 26m' },
      { id: 'p-3', employee: 'Priya Singh', employeeId: 'EMP003', office: 'Mumbai Central Branch', punchInTime: '09:05 AM', location: 'Office GPS', status: 'On Time' },
    ];

    const recentPunchOuts = [
      { id: 'po-1', employee: 'Sneha Gupta', employeeId: 'EMP004', office: 'Head Office', punchOutTime: '06:18 PM', workingHours: '8h 02m', breakDuration: '45m', status: 'Completed' },
      { id: 'po-2', employee: 'Amit Verma', employeeId: 'EMP005', office: 'Navi Mumbai Branch', punchOutTime: '06:30 PM', workingHours: '8h 30m', breakDuration: '30m', status: 'Completed' },
    ];

    const recentActivity = [
      { id: 'act-1', timestamp: '09:42 AM', title: 'Demo User punched in', office: 'Head Office', category: 'punch' },
      { id: 'act-2', timestamp: '09:45 AM', title: 'Rahul Sharma started break', office: 'Navi Mumbai Branch', category: 'break' },
      { id: 'act-3', timestamp: '10:02 AM', title: 'Priya Singh started client visit to Acme Corp', office: 'Mumbai Central Branch', category: 'visit' },
    ];

    const departments = [
      { name: 'Engineering & IT', total: 32, present: 27, absent: 2, late: 1, remote: 1, onLeave: 1, working: 24 },
      { name: 'Sales & BD', total: 45, present: 36, absent: 4, late: 2, remote: 2, onLeave: 1, working: 31 },
      { name: 'HR & Operations', total: 12, present: 11, absent: 0, late: 0, remote: 0, onLeave: 1, working: 10 },
      { name: 'Finance & Accounts', total: 18, present: 15, absent: 1, late: 1, remote: 0, onLeave: 1, working: 13 },
    ];

    return {
      success: true,
      timestamp: new Date().toISOString(),
      tenantId,
      selectedOfficeId: officeId || 'all',
      summary,
      offices,
      recentPunchIns,
      recentPunchOuts,
      recentActivity,
      departments,
    };
  }

  async getOffices(tenantId: string) {
    return [
      { id: 'all', name: 'All Offices' },
      { id: 'off-1', name: 'Head Office (Bandra)' },
      { id: 'off-2', name: 'Navi Mumbai Branch' },
      { id: 'off-3', name: 'Mumbai Central Branch' },
    ];
  }
}
