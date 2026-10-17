import { DataCaptureService } from '../modules/data-capture/data-capture.service';

describe('Data Capture after Customer/Lead removal', () => {
  it('keeps capture jobs, places and employee search usage without a tenant ID', async () => {
    const prisma = {
      dataCaptureJob: {
        count: jest.fn().mockResolvedValue(2),
        aggregate: jest.fn().mockResolvedValue({ _sum: { googleApiRequests: 9 } }),
      },
      dataCapturePlace: { count: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(3).mockResolvedValueOnce(1) },
      dataCaptureSearch: { count: jest.fn().mockResolvedValue(4) },
    };
    const service = new DataCaptureService({} as any, prisma as any, {} as any);
    const summary = await service.getUsageSummary(undefined, { id: 21, employee: { id: 7 } });
    expect(summary).toMatchObject({ totalExtractions: 2, totalLeadsCaptured: 7, totalGoogleApiCalls: 9, searches: 4 });
    expect(prisma.dataCaptureSearch.count).toHaveBeenCalledWith({ where: { employeeId: 7 } });
    expect(prisma.dataCaptureJob.count.mock.calls[0][0].where).not.toHaveProperty('customerId');
    expect(prisma.dataCapturePlace.count.mock.calls[0][0].where).not.toHaveProperty('customerId');
  });

  it('propagates database failures instead of reporting empty usage', async () => {
    const failure = new Error('Database unavailable');
    const prisma = {
      dataCaptureJob: { count: jest.fn().mockRejectedValue(failure), aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      dataCapturePlace: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new DataCaptureService({} as any, prisma as any, {} as any);
    await expect(service.getUsageSummary()).rejects.toBe(failure);
  });
});
