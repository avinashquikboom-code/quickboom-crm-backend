import { EmployeeLeadStageReportService } from './employee-lead-stage-report.service';

describe('EmployeeLeadStageReportService', () => {
  const stages = [
    { id: 1, key: 'NEW', name: 'New', color: '#0284C7', bgColor: '#E0F2FE', sortOrder: 1 },
    { id: 2, key: 'HOT_LEAD', name: 'Hot Lead', color: '#EA580C', bgColor: '#FFEDD5', sortOrder: 2 },
    { id: 3, key: 'FOLLOW_UP', name: 'Follow Up', color: '#D97706', bgColor: '#FEF3C7', sortOrder: 3 },
    { id: 4, key: 'CUSTOM_DEMO', name: 'Demo Scheduled', color: '#7C3AED', bgColor: '#EDE9FE', sortOrder: 4 },
    { id: 5, key: 'WON', name: 'Won', color: '#16A34A', bgColor: '#DCFCE7', sortOrder: 5 },
  ];

  const now = new Date();
  const mockPrisma: any = {
    leadStage: { findMany: jest.fn().mockResolvedValue(stages) },
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: 10, userId: 100, name: 'Aarav Sharma', employeeCode: 'EMP-10', departmentId: 1, department: { id: 1, name: 'Sales' }, designation: { name: 'Executive' }, user: { id: 100, name: 'Aarav Sharma' } },
      ]),
    },
    department: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Sales' }]) },
    lead: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 501, customerId: 1, firstName: 'Riya', lastName: 'Patel', title: 'Riya Patel', companyName: 'Riya Fitness',
          phone: '9876543210', email: 'riya@example.com', source: 'GOOGLE_PLACES', value: 25000, stageId: 2, status: 'HOT_LEAD', employeeId: 10, assignedToId: 100,
          createdAt: now, updatedAt: now, nextFollowUpDate: now, workNotes: 'Called customer',
          stage: stages[1], employee: { id: 10, name: 'Aarav Sharma', department: { name: 'Sales' } },
          assignedTo: { id: 100, name: 'Aarav Sharma' }, statusHistory: [{ fromStageId: 1, fromStatus: 'NEW', createdAt: now, notes: 'Moved to Hot' }],
          visits: [{ date: now }], notes: [{ content: 'Requested quote' }],
        },
        {
          id: 502, customerId: 1, firstName: 'Karan', lastName: 'Mehta', title: 'Karan Mehta', companyName: 'Mehta Co',
          phone: '9876500000', email: 'karan@example.com', source: 'WEBSITE', value: 40000, stageId: 5, status: 'WON', employeeId: 10, assignedToId: 100,
          createdAt: now, updatedAt: now, nextFollowUpDate: null, workNotes: 'Closed',
          stage: stages[4], employee: { id: 10, name: 'Aarav Sharma', department: { name: 'Sales' } },
          assignedTo: { id: 100, name: 'Aarav Sharma' }, statusHistory: [{ fromStageId: 4, fromStatus: 'CUSTOM_DEMO', createdAt: now, notes: 'Deal won' }],
          visits: [], notes: [],
        },
      ]),
    },
    leadStatusHistory: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1, leadId: 501, fromStageId: 1, fromStatus: 'NEW', toStageId: 2, toStatus: 'HOT_LEAD', changedById: 100, notes: 'Interested', createdAt: now,
          lead: { id: 501, firstName: 'Riya', lastName: 'Patel', companyName: 'Riya Fitness', phone: '9876543210', value: 25000, stageId: 2, employeeId: 10, assignedToId: 100, stage: stages[1], employee: { name: 'Aarav Sharma' } },
        },
        {
          id: 2, leadId: 501, fromStageId: 2, fromStatus: 'HOT_LEAD', toStageId: 2, toStatus: 'HOT_LEAD', changedById: 100, notes: 'Re-confirmed', createdAt: now,
          lead: { id: 501, firstName: 'Riya', lastName: 'Patel', companyName: 'Riya Fitness', phone: '9876543210', value: 25000, stageId: 2, employeeId: 10, assignedToId: 100, stage: stages[1], employee: { name: 'Aarav Sharma' } },
        },
      ]),
    },
  };

  it('aggregates dynamic stages, deduplicates unique leads, and generates PDF/Excel/CSV', async () => {
    const service = new EmployeeLeadStageReportService(mockPrisma);
    const res = await service.getReport(1, { preset: 'today' }, { id: 1, role: 'COMPANY_ADMIN' });

    expect(res.data.stages.some((s: any) => s.key === 'CUSTOM_DEMO')).toBe(true);
    expect(res.data.summary.totalAssignedLeads).toBe(2);
    expect(res.data.summary.hotDeals).toBe(1);
    expect(res.data.summary.wonLeads).toBe(1);
    expect(res.data.summary.totalLeadsWorkedOn).toBe(1); // deduplicated leadId 501
    expect(res.data.summary.conversionRate).toBe(50);

    const drill = await service.getDrilldown(1, { preset: 'today', drillEmployeeId: '10', drillStageKey: 'HOT_LEAD' }, { id: 1, role: 'COMPANY_ADMIN' });
    expect(drill.data.rows).toHaveLength(1);
    expect(drill.data.rows[0].isHotLead).toBe(true);

    const pdf = await service.exportReport(1, { preset: 'today', format: 'pdf', exportScope: 'all_complete' }, { id: 1, role: 'COMPANY_ADMIN' });
    expect(pdf.buffer.slice(0, 5).toString()).toBe('%PDF-');

    const stagePdf = await service.exportReport(1, { preset: 'today', format: 'pdf', exportScope: 'stage_wise' }, { id: 1, role: 'COMPANY_ADMIN' });
    expect(stagePdf.buffer.slice(0, 5).toString()).toBe('%PDF-');

    const indivPdf = await service.exportReport(1, { preset: 'today', format: 'pdf', exportScope: 'individual', exportEmployeeId: '10' }, { id: 1, role: 'COMPANY_ADMIN' });
    expect(indivPdf.buffer.slice(0, 5).toString()).toBe('%PDF-');

    const xlsx = await service.exportReport(1, { preset: 'today', format: 'excel', exportScope: 'all_complete' }, { id: 1, role: 'COMPANY_ADMIN' });
    expect(xlsx.buffer.slice(0, 2).toString()).toBe('PK');

    const csv = await service.exportReport(1, { preset: 'today', format: 'csv', exportScope: 'detailed' }, { id: 1, role: 'COMPANY_ADMIN' });
    const csvText = csv.buffer.toString('utf8');
    expect(csvText).toContain('Aarav Sharma');
    expect(csvText).toContain('Requested quote');
  });
});
