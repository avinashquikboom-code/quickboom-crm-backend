import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { EmployeeService } from '../employee/employee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { WorkStatus, WorkType } from '@prisma/client';

describe('Customer Booking -> Employee Assignment -> Calendar Visibility Lifecycle', () => {
  let workService: WorkService;
  let employeeService: EmployeeService;
  let prismaMock: any;

  // In-memory data store simulating the database
  let worksStore: any[] = [];
  let employeesStore: any[] = [];

  beforeEach(async () => {
    // 1. Setup Employee Database records
    employeesStore = [
      {
        id: 10,
        employeeCode: 'EMP-010',
        firstName: 'Alex',
        lastName: 'Sharma',
        email: 'alex.sharma@quikboom.com',
        phone: '+91 9876543210',
        user: { id: 101, avatar: 'https://cdn.quikboom.com/avatars/alex.jpg' },
        department: { id: 1, name: 'Creative' },
        designation: { id: 2, name: 'Video Editor' },
        branch: { id: 1, name: 'Head Office - Mumbai' },
      },
      {
        id: 20,
        employeeCode: 'EMP-020',
        firstName: 'Priya',
        lastName: 'Patel',
        email: 'priya.patel@quikboom.com',
        phone: '+91 9123456780',
        user: { id: 102, avatar: null },
        department: { id: 2, name: 'Media Production' },
        designation: { id: 3, name: 'Senior Photographer' },
        branch: { id: 1, name: 'Head Office - Mumbai' },
      },
    ];

    // Reset works store
    worksStore = [];

    prismaMock = {
      work: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return worksStore.filter((w) => {
            if (where.OR) {
              const matchesOr = where.OR.some((cond: any) => {
                if (cond.assignedToId != null && w.assignedToId === cond.assignedToId) return true;
                if (cond.editorId != null && w.editorId === cond.editorId) return true;
                if (cond.tasks?.some?.assignedToId != null) {
                  return w.tasks?.some((t: any) => t.assignedToId === cond.tasks.some.assignedToId);
                }
                if (cond.customer?.assignedEmployeeId != null && w.customer?.assignedEmployeeId === cond.customer.assignedEmployeeId) {
                  return true;
                }
                return false;
              });
              if (!matchesOr) return false;
            }
            if (where.scheduledDate) {
              if (where.scheduledDate.gte && w.scheduledDate < where.scheduledDate.gte) return false;
              if (where.scheduledDate.lte && w.scheduledDate > where.scheduledDate.lte) return false;
            }
            if (where.status?.not && w.status === where.status.not) return false;
            return true;
          });
        }),
      },
      employee: {
        findUnique: jest.fn().mockImplementation(({ where, include }: any) => {
          const emp = employeesStore.find((e) => e.id === where.id);
          return emp ? { ...emp } : null;
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const emp = employeesStore.find(
            (e) => (where.OR && where.OR.some((c: any) => c.userId === e.user?.id || c.email === e.email))
          );
          return emp ? { ...emp } : null;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        EmployeeService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PlanAccessService, useValue: {} },
        { provide: PlanScheduleGateway, useValue: { server: { to: () => ({ emit: () => {} }) } } },
      ],
    }).compile();

    workService = module.get<WorkService>(WorkService);
    employeeService = module.get<EmployeeService>(EmployeeService);
  });

  it('Step 1 -> 5: Customer books service -> Employee A assigned -> appears on Employee A calendar with details -> Employee B cannot see it', async () => {
    // 1. Customer "Star Retailers" books a Video Shoot service scheduled for 2026-09-15 at 10:30 AM
    // 2. Employee A (Priya Patel, id: 20) is assigned to the work
    const bookingWorkItem = {
      id: 501,
      customerId: 301,
      subscriptionId: 101,
      assignedToId: 20, // Assigned to Priya (Photographer)
      editorId: null,
      workType: WorkType.REELS_SHOOT,
      title: 'Festival Reels Shoot',
      scheduledDate: new Date('2026-09-15T00:00:00.000Z'),
      scheduledTime: '10:30 AM',
      status: WorkStatus.SCHEDULED,
      notes: 'Bring gimbal and wide angle lens for store walkthrough',
      customer: {
        id: 301,
        name: 'Star Retailers',
        address: '101 MG Road',
        city: 'Pune',
        state: 'Maharashtra',
      },
      team: { name: 'Field Production' },
      assignedTo: { id: 20, firstName: 'Priya', lastName: 'Patel' },
      editor: null,
      entitlement: { serviceName: 'Reels Shoot' },
      subscription: { id: 101, plan: { name: 'Growth Tier' } },
      tasks: [
        { id: 901, title: 'Walkthrough Video', status: 'PENDING', assignedToId: 20 },
      ],
    };

    worksStore.push(bookingWorkItem);

    // 3. Query Employee A (Priya, id: 20) calendar for 2026-09-15
    const priyaCalendar = await workService.getEmployeeCalendar(20, {
      date: '2026-09-15',
      dateFrom: '2026-09-15',
      dateTo: '2026-09-15',
    });

    // Verify it appears on Priya's calendar
    expect(priyaCalendar).toHaveLength(1);
    const priyaEvent = priyaCalendar[0];

    // Verify correct date and time
    expect(new Date(priyaEvent.date).toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(priyaEvent.time).toBe('10:30 AM');

    // Verify customer details
    expect(priyaEvent.customerName).toBe('Star Retailers');
    expect(priyaEvent.customerId).toBe('301');
    expect(priyaEvent.title).toBe('Festival Reels Shoot');
    expect(priyaEvent.status).toBe(WorkStatus.SCHEDULED);
    expect(priyaEvent.notes).toBe('Bring gimbal and wide angle lens for store walkthrough');
    expect(priyaEvent.location).toBe('101 MG Road, Pune, Maharashtra');

    // 4. Query Employee B (Alex Sharma, id: 10) calendar for the same date
    const alexCalendar = await workService.getEmployeeCalendar(10, {
      date: '2026-09-15',
      dateFrom: '2026-09-15',
      dateTo: '2026-09-15',
    });

    // Employee B must NOT see Employee A's assigned work
    expect(alexCalendar).toHaveLength(0);
  });

  it('Step 6: Customer books Video Editing service -> Employee B assigned -> Employee B sees it, Employee A does not', async () => {
    // Customer "Alpha Tech" books Video Editing service
    // Employee B (Alex Sharma, id: 10) is assigned as editor
    const editingWorkItem = {
      id: 502,
      customerId: 302,
      subscriptionId: 102,
      assignedToId: null,
      editorId: 10, // Assigned to Alex (Editor)
      workType: WorkType.VIDEO_EDITING,
      title: 'YouTube Product Review Edit',
      scheduledDate: new Date('2026-09-16T00:00:00.000Z'),
      scheduledTime: '02:00 PM',
      status: WorkStatus.IN_PROGRESS,
      notes: 'Color grading and caption synchronization required',
      customer: {
        id: 302,
        name: 'Alpha Tech',
        address: '404 Cyber City',
        city: 'Hyderabad',
        state: 'Telangana',
      },
      team: { name: 'Post-Production' },
      assignedTo: null,
      editor: { id: 10, firstName: 'Alex', lastName: 'Sharma' },
      entitlement: { serviceName: 'Video Editing' },
      subscription: { id: 102, plan: { name: 'Enterprise' } },
      tasks: [],
    };

    worksStore.push(editingWorkItem);

    // Query Alex (id: 10)
    const alexCalendar = await workService.getEmployeeCalendar(10, {
      date: '2026-09-16',
    });
    expect(alexCalendar).toHaveLength(1);
    expect(alexCalendar[0].customerName).toBe('Alpha Tech');
    expect(alexCalendar[0].time).toBe('02:00 PM');
    expect(alexCalendar[0].location).toBe('404 Cyber City, Hyderabad, Telangana');

    // Query Priya (id: 20)
    const priyaCalendar = await workService.getEmployeeCalendar(20, {
      date: '2026-09-16',
    });
    expect(priyaCalendar).toHaveLength(0);
  });

  it('Step 7: Verify Employee Profile returns real Designation, Department, Employee Code, and Profile Photo', async () => {
    // Fetch profile for Alex (userId: 101)
    const alexProfile = await employeeService.getMyProfile({ id: 101, email: 'alex.sharma@quikboom.com' });

    expect(alexProfile.employeeCode).toBe('EMP-010');
    expect(alexProfile.firstName).toBe('Alex');
    expect(alexProfile.lastName).toBe('Sharma');
    expect(alexProfile.designation).toBe('Video Editor');
    expect(alexProfile.department).toBe('Creative');
    expect(alexProfile.profilePhoto).toBe('https://cdn.quikboom.com/avatars/alex.jpg');

    // Fetch profile for Priya (userId: 102)
    const priyaProfile = await employeeService.getMyProfile({ id: 102, email: 'priya.patel@quikboom.com' });

    expect(priyaProfile.employeeCode).toBe('EMP-020');
    expect(priyaProfile.firstName).toBe('Priya');
    expect(priyaProfile.lastName).toBe('Patel');
    expect(priyaProfile.designation).toBe('Senior Photographer');
    expect(priyaProfile.department).toBe('Media Production');
    expect(priyaProfile.profilePhoto).toBeNull(); // Fallback to initials avatar in frontend
  });
});
