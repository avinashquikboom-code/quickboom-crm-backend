import { LeadService } from './lead.service';
import { WorkService } from '../work/work.service';
import { TaskStatus, WorkStatus, WorkType } from '@prisma/client';

describe('Flow 2: Lead Won -> Customer Conversion -> Employee Calendar & My Work', () => {
  const tenantId = 1;
  const leadId = 50;
  const convertedCustomerId = 113;
  const productionTeamId = 7;

  const graphicDesigner = {
    id: 20,
    userId: 200,
    firstName: 'Sumit',
    lastName: 'Sharma',
    customerId: tenantId,
    status: 'ACTIVE',
    designation: { name: 'Graphic Designer' },
    department: { name: 'Design' },
    user: { userRoles: [{ role: { name: 'GRAPHIC_DESIGNER' } }] },
  };

  const videoEditor = {
    id: 21,
    userId: 201,
    firstName: 'Priya',
    lastName: 'Verma',
    customerId: tenantId,
    status: 'ACTIVE',
    designation: { name: 'Video Editor' },
    department: { name: 'Video Production' },
    user: { userRoles: [{ role: { name: 'VIDEO_EDITOR' } }] },
  };

  const productionTeam = {
    id: productionTeamId,
    customerId: tenantId,
    name: 'Production Team A',
    description: 'Core creative and production team',
    isActive: true,
    members: [
      { employeeId: graphicDesigner.id, employee: graphicDesigner },
      { employeeId: videoEditor.id, employee: videoEditor },
    ],
  };

  it('correctly assigns production team, role-based employees, and displays tasks in Employee Calendar using new customerId', async () => {
    let customerRecord: any = null;
    const workRecords: any[] = [];
    const workTaskRecords: any[] = [];

    const mockPrisma: any = {
      customer: {
        findFirst: jest.fn().mockImplementation(async () => customerRecord),
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === convertedCustomerId && customerRecord) {
            return { ...customerRecord, assignedTeam: productionTeam, originLead: { customerId: tenantId, assignedTeam: productionTeamId } };
          }
          return null;
        }),
        findMany: jest.fn().mockImplementation(async () => (customerRecord ? [{ id: customerRecord.id }] : [])),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          customerRecord = {
            id: convertedCustomerId,
            ...data,
            originLead: { id: leadId, customerId: tenantId },
            assignedTeam: productionTeam,
          };
          return customerRecord;
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          customerRecord = { ...customerRecord, ...data };
          return customerRecord;
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
          if (customerRecord) customerRecord = { ...customerRecord, ...data };
          return { count: 1 };
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 301, ...data })),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 5, name: 'CUSTOMER' }),
      },
      userRole: {
        create: jest.fn().mockResolvedValue({}),
      },
      lead: {
        update: jest.fn().mockResolvedValue({}),
      },
      team: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === productionTeamId) return productionTeam;
          return null;
        }),
        findFirst: jest.fn().mockImplementation(async () => productionTeam),
        findMany: jest.fn().mockImplementation(async () => [productionTeam]),
      },
      teamMember: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const empIds = where.employeeId?.in || [where.employeeId];
          const matches = [];
          if (empIds.includes(graphicDesigner.id)) {
            matches.push({ teamId: productionTeamId, team: productionTeam });
          }
          if (empIds.includes(videoEditor.id)) {
            matches.push({ teamId: productionTeamId, team: productionTeam });
          }
          return matches;
        }),
      },
      employee: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === graphicDesigner.id) return graphicDesigner;
          if (where.id === videoEditor.id) return videoEditor;
          return null;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id === graphicDesigner.id) return graphicDesigner;
          if (where?.id === videoEditor.id) return videoEditor;
          return null;
        }),
      },
      work: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return workRecords.filter((w) => {
            if (where.customerId && w.customerId !== where.customerId) return false;
            if (where.status && where.status.not && w.status === where.status.not) return false;
            if (where.OR) {
              const matchesOr = where.OR.some((cond: any) => {
                if ('assignedToId' in cond && cond.assignedToId === null) return w.assignedToId === null;
                if ('teamId' in cond && cond.teamId === null) return w.teamId === null;
                if (cond.assignedToId && w.assignedToId === cond.assignedToId) return true;
                if (cond.editorId && w.editorId === cond.editorId) return true;
                if (cond.teamId?.in && cond.teamId.in.includes(w.teamId)) return true;
                if (cond.customerId?.in && cond.customerId.in.includes(w.customerId)) return true;
                if (cond.customer?.assignedTeamId?.in && cond.customer.assignedTeamId.in.includes(productionTeamId)) return true;
                return false;
              });
              if (!matchesOr) return false;
            }
            return true;
          });
        }),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const newWork = {
            id: workRecords.length + 100,
            ...data,
            team: productionTeam,
            customer: customerRecord,
            assignedTo: data.assignedToId === graphicDesigner.id ? graphicDesigner : (data.assignedToId === videoEditor.id ? videoEditor : null),
            editor: data.editorId === videoEditor.id ? videoEditor : null,
            tasks: [],
          };
          workRecords.push(newWork);
          return newWork;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const idx = workRecords.findIndex((w) => w.id === where.id);
          if (idx !== -1) {
            workRecords[idx] = { ...workRecords[idx], ...data };
            return workRecords[idx];
          }
          return null;
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          let count = 0;
          for (let i = 0; i < workRecords.length; i++) {
            if (where.id && workRecords[i].id !== where.id) continue;
            if (where.customerId && workRecords[i].customerId !== where.customerId) continue;
            workRecords[i] = { ...workRecords[i], ...data };
            count++;
          }
          return { count };
        }),
      },
      workTask: {
        createMany: jest.fn().mockImplementation(async ({ data }: any) => {
          for (const item of data) {
            workTaskRecords.push({ id: workTaskRecords.length + 1, ...item });
          }
          return { count: data.length };
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          let count = 0;
          for (let i = 0; i < workTaskRecords.length; i++) {
            if (where.workId && workTaskRecords[i].workId !== where.workId) continue;
            if (where.assignedToId === null && workTaskRecords[i].assignedToId !== null) continue;
            workTaskRecords[i] = { ...workTaskRecords[i], ...data };
            count++;
          }
          return { count };
        }),
      },
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 1, ...data })),
      },
      customerSubscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const workService = new WorkService(mockPrisma);
    const assignmentSync = jest.spyOn(workService, 'syncCustomerTeamWorkAssignments');
    const leadService = new LeadService(
      {} as any,
      mockPrisma,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workService,
    );

    // Mock role eligibility in workService
    jest.spyOn(workService as any, 'eligibleProductionMemberIds').mockImplementation(async (activity: any) => {
      const type = activity.workType || '';
      const title = String(activity.title || '').toLowerCase();
      if (type === WorkType.EDITING || type === WorkType.VIDEO_EDITING || title.includes('video') || title.includes('edit')) {
        return [videoEditor.id];
      }
      return [graphicDesigner.id];
    });

    // 1. Simulate Lead WON conversion
    const wonLead = {
      id: leadId,
      customerId: tenantId,
      title: 'Reliance SMART Superstore',
      companyName: 'Reliance SMART Superstore',
      email: 'reliance.smart@example.com',
      phone: '9876543210',
      assignedTeam: productionTeamId,
      status: 'WON',
    };

    const conversionResult = await leadService.handleLeadWonCustomerConversion(
      tenantId,
      wonLead,
      1,
      'Negotiation',
      'WON',
      { employeeId: 99 },
    );

    expect(conversionResult.success).toBe(true);
    expect(conversionResult.customerId).toBe(convertedCustomerId);
    expect(customerRecord.id).toBe(convertedCustomerId);
    expect(customerRecord.leadId).toBe(leadId);
    expect(assignmentSync).toHaveBeenCalledWith(convertedCustomerId, productionTeamId, undefined, { onlyMissing: true });
    expect(customerRecord.assignedTeamId).toBe(productionTeamId);

    // 2. Simulate plan scheduling for newly converted customer
    await mockPrisma.work.create({
      data: {
        customerId: convertedCustomerId,
        teamId: null,
        assignedToId: null,
        editorId: null,
        workType: 'STORY_DESIGN',
        title: 'Story #1: Post',
        scheduledDate: new Date('2026-10-17T04:30:00Z'),
        scheduledTime: '10:00 AM',
        status: WorkStatus.SCHEDULED,
      },
    });

    await mockPrisma.work.create({
      data: {
        customerId: convertedCustomerId,
        teamId: null,
        assignedToId: null,
        editorId: null,
        workType: 'EDITING',
        title: 'Reel #1: Edit',
        scheduledDate: new Date('2026-10-17T04:30:00Z'),
        scheduledTime: '11:00 AM',
        status: WorkStatus.SCHEDULED,
      },
    });

    // 3. Sync work assignments
    const syncedCount = await workService.syncCustomerTeamWorkAssignments(convertedCustomerId, productionTeamId);
    expect(syncedCount).toBe(2);

    // Verify Story is assigned to Graphic Designer (Sumit)
    const storyWork = workRecords.find((w) => w.title === 'Story #1: Post');
    expect(storyWork.assignedToId).toBe(graphicDesigner.id);
    expect(storyWork.teamId).toBe(productionTeamId);
    expect(storyWork.status).toBe(WorkStatus.ASSIGNED);
    expect(storyWork.customerId).toBe(convertedCustomerId);

    // Verify Reel is assigned to Video Editor (Priya)
    const reelWork = workRecords.find((w) => w.title === 'Reel #1: Edit');
    expect(reelWork.assignedToId).toBe(videoEditor.id);
    expect(reelWork.teamId).toBe(productionTeamId);
    expect(reelWork.status).toBe(WorkStatus.ASSIGNED);
    expect(reelWork.customerId).toBe(convertedCustomerId);

    // 4. Query Graphic Designer's calendar (Sumit ID 20)
    const sumitCalendar = await workService.getEmployeeCalendar(
      graphicDesigner.id,
      { date: '2026-10-17' },
      { assignedOnly: true },
    );
    expect(sumitCalendar.length).toBeGreaterThanOrEqual(1);
    const sumitItems = sumitCalendar.map((i) => i.title);
    expect(sumitItems).toContain('Story #1: Post');
    expect(sumitCalendar[0].customerId).toBe(String(convertedCustomerId));

    // 5. Query Video Editor's calendar (Priya ID 21)
    const priyaCalendar = await workService.getEmployeeCalendar(
      videoEditor.id,
      { date: '2026-10-17' },
      { assignedOnly: true },
    );
    expect(priyaCalendar.length).toBeGreaterThanOrEqual(1);
    const priyaItems = priyaCalendar.map((i) => i.title);
    expect(priyaItems).toContain('Reel #1: Edit');
    expect(priyaCalendar[0].customerId).toBe(String(convertedCustomerId));
  });
});
