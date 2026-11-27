import { LeadRepository } from './lead.repository';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';

describe('LeadRepository dateFilter & historical stage resolution', () => {
  const stages = [
    { id: 1, key: 'NEW', name: 'New', customerId: 10 },
    { id: 2, key: 'CONTACTED', name: 'Contacted', customerId: 10 },
    { id: 3, key: 'FOLLOW_UP', name: 'Follow Up', customerId: 10 },
    { id: 4, key: 'IN_PROGRESS', name: 'In Progress', customerId: 10 },
  ];

  // Lead created on 2026-11-26 as NEW, moved on 2026-11-27 (NEW -> IN_PROGRESS -> CONTACTED),
  // and moved on 2026-11-28 (CONTACTED -> FOLLOW_UP).
  const currentLeadRow = {
    id: 501,
    customerId: 10,
    title: 'Acme Travels',
    companyName: 'Acme Travels',
    stageId: 3,
    status: 'FOLLOW_UP',
    stage: stages[2],
    createdAt: new Date('2026-11-26T05:00:00.000Z'), // 2026-11-26 10:30 IST
    assignedTo: null,
    createdBy: null,
    employee: null,
    convertedByEmployee: null,
    socialProfiles: [],
    images: [],
    visitPhotos: [],
    visits: [],
  };

  const historyRows = [
    {
      id: 1,
      leadId: 501,
      fromStageId: 1,
      toStageId: 4,
      fromStatus: 'NEW',
      toStatus: 'IN_PROGRESS',
      createdAt: new Date('2026-11-27T04:00:00.000Z'), // 2026-11-27 09:30 IST
    },
    {
      id: 2,
      leadId: 501,
      fromStageId: 4,
      toStageId: 2,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'CONTACTED',
      createdAt: new Date('2026-11-27T11:30:00.000Z'), // 2026-11-27 17:00 IST (last on 27 Nov)
    },
    {
      id: 3,
      leadId: 501,
      fromStageId: 2,
      toStageId: 3,
      fromStatus: 'CONTACTED',
      toStatus: 'FOLLOW_UP',
      createdAt: new Date('2026-11-28T06:00:00.000Z'), // 2026-11-28 11:30 IST
    },
  ];

  function createRepo(overrides: Record<string, any> = {}) {
    const leadFindMany = jest.fn().mockResolvedValue([currentLeadRow]);
    const leadCount = jest.fn().mockResolvedValue(1);
    const prisma: any = {
      lead: {
        findMany: leadFindMany,
        count: leadCount,
      },
      leadStatusHistory: {
        findMany: jest.fn().mockResolvedValue(historyRows),
      },
      leadStage: {
        findMany: jest.fn().mockResolvedValue(stages),
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(stages.find((s) => (where?.id ? s.id === where.id : true)) || null),
        ),
      },
      ...overrides,
    };
    const repo = new LeadRepository(prisma);
    // Avoid unrelated enrichment queries in unit test
    jest.spyOn(repo as any, 'resolveMissingLeadBusinessNames').mockResolvedValue(undefined);
    jest.spyOn(repo as any, 'hydrateLeadContactLinksFromCaptures').mockResolvedValue(undefined);
    jest.spyOn(repo as any, 'attachPlacePhotos').mockResolvedValue(undefined);
    jest.spyOn(repo as any, 'resolveMissingLeadVisitedAndWonEmployees').mockResolvedValue(undefined);
    return { repo, prisma, leadFindMany };
  }

  const adminUser = { id: 1, role: 'ADMIN', customerId: 10 };

  it('uses IST today activity range (createdAt, statusHistory, timeline, notes, visits) for dateFilter=today', async () => {
    const { repo, leadFindMany } = createRepo();
    await repo.findAll(10, { dateFilter: 'today' }, adminUser);

    const callArg = leadFindMany.mock.calls[0][0];
    const todayRange = getBusinessDayRange(getBusinessDate(new Date()));
    const activityOr = callArg.where.AND.find((c: any) => Array.isArray(c.OR))?.OR;
    expect(activityOr).toEqual([
      { createdAt: { gte: todayRange.start, lte: todayRange.end } },
      { statusHistory: { some: { createdAt: { gte: todayRange.start, lte: todayRange.end } } } },
      { timeline: { some: { createdAt: { gte: todayRange.start, lte: todayRange.end } } } },
      { notes: { some: { createdAt: { gte: todayRange.start, lte: todayRange.end } } } },
      { visits: { some: { createdAt: { gte: todayRange.start, lte: todayRange.end } } } },
    ]);
  });

  it('uses IST yesterday range for dateFilter=yesterday', async () => {
    const { repo, leadFindMany } = createRepo();
    await repo.findAll(10, { dateFilter: 'yesterday' }, adminUser);

    const todayStr = getBusinessDate(new Date());
    const [yy, mm, dd] = todayStr.split('-').map(Number);
    const yestStr = new Date(Date.UTC(yy, mm - 1, dd - 1)).toISOString().slice(0, 10);
    const yestRange = getBusinessDayRange(yestStr);

    const callArg = leadFindMany.mock.calls[0][0];
    const activityOr = callArg.where.AND.find((c: any) => Array.isArray(c.OR))?.OR;
    expect(activityOr[0]).toEqual({ createdAt: { gte: yestRange.start, lte: yestRange.end } });
  });

  it('resolves historical stage per date (26 Nov=NEW, 27 Nov=last stage CONTACTED, 28 Nov=FOLLOW_UP)', async () => {
    const { repo } = createRepo();

    const nov26 = await repo.findAll(
      10,
      {
        dateFilter: 'custom',
        from: '2026-11-26',
        to: '2026-11-26',
      },
      adminUser,
    );
    expect(nov26.data[0].status).toBe('NEW');
    expect(nov26.data[0].stageId).toBe(1);

    const nov27 = await repo.findAll(
      10,
      {
        dateFilter: 'custom',
        from: '2026-11-27',
        to: '2026-11-27',
      },
      adminUser,
    );
    expect(nov27.data[0].status).toBe('CONTACTED');
    expect(nov27.data[0].stageId).toBe(2);

    const nov28 = await repo.findAll(
      10,
      {
        dateFilter: 'custom',
        from: '2026-11-28',
        to: '2026-11-28',
      },
      adminUser,
    );
    expect(nov28.data[0].status).toBe('FOLLOW_UP');
    expect(nov28.data[0].stageId).toBe(3);
  });

  it('filters by resolved historical stage rather than current DB stage when dateFilter is active', async () => {
    const { repo, leadFindMany } = createRepo();

    const matchHistorical = await repo.findAll(
      10,
      {
        dateFilter: 'custom',
        from: '2026-11-26',
        to: '2026-11-26',
        stageId: '1', // NEW on 26 Nov, even though current stageId is 3
      },
      adminUser,
    );
    // Ensure pipelineFilters was NOT pushed into DB where.AND when historicalRange is active
    const dbWhereAnd = leadFindMany.mock.calls[0][0].where.AND || [];
    expect(JSON.stringify(dbWhereAnd)).not.toContain('"stageId":1');
    expect(matchHistorical.data).toHaveLength(1);
    expect(matchHistorical.data[0].stageId).toBe(1);

    const mismatchHistorical = await repo.findAll(
      10,
      {
        dateFilter: 'custom',
        from: '2026-11-26',
        to: '2026-11-26',
        stageId: '3', // FOLLOW_UP only happened on 28 Nov
      },
      adminUser,
    );
    expect(mismatchHistorical.data).toHaveLength(0);
    expect(mismatchHistorical.meta.total).toBe(0);
  });

  it('returns current stage without historical rewrite when dateFilter=all', async () => {
    const { repo, prisma } = createRepo();
    const res = await repo.findAll(10, { dateFilter: 'all' }, adminUser);

    expect(prisma.leadStatusHistory.findMany).not.toHaveBeenCalled();
    expect(res.data[0].status).toBe('FOLLOW_UP');
    expect(res.data[0].stageId).toBe(3);
  });
});
