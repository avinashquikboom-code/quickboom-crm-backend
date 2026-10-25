import axios from 'axios';
import { NotFoundException } from '@nestjs/common';
import { DataCaptureService } from './data-capture.service';

jest.mock('axios');
const user = { id: 12, employee: { id: 7, status: 'ACTIVE' } };
function fixture() {
  const prisma: any = {
    dataCaptureJob: {
      findMany: jest.fn(async () => []), count: jest.fn(async () => 21),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date(), places: (data.places?.create || []).map((p: any, i: number) => ({ ...p, id: i + 1 })) })),
    },
    $transaction: (queries: any[]) => Promise.all(queries),
  };
  const service = new DataCaptureService({ get: jest.fn() } as any, prisma,
    { getGoogleMapsConfig: async () => ({ isEnabled: true, apiKey: 'test-key' }) } as any);
  jest.spyOn(service, 'getUsageSummary').mockResolvedValue({ quotaRemaining: 100 } as any);
  (service as any).enrichPlacesWithWebsiteContactsInBackground = jest.fn();
  return { service, prisma };
}

describe('Capture session history', () => {
  afterEach(() => jest.clearAllMocks());
  it('reads persisted sessions with user scope, search, date bounds and pagination without Places or quota calls', async () => {
    const { service, prisma } = fixture();
    const result = await service.getCaptureHistory(user, { page: 2, limit: 20, search: 'gym', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
    expect(prisma.dataCaptureJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20, take: 20, where: { userId: 12, OR: expect.any(Array), createdAt: { gte: new Date('2026-10-01'), lt: new Date('2026-11-01') } },
    }));
    expect(result.pagination.totalPages).toBe(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(service.getUsageSummary).not.toHaveBeenCalled();
  });
  it('does not allow opening another user session', async () => {
    const { service, prisma } = fixture();
    await expect(service.getCaptureHistoryRecords(user, 'other-job', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dataCaptureJob.findFirst).toHaveBeenCalledWith({ where: { jobId: 'other-job', userId: 12 }, select: { jobId: true } });
  });
  it('opens saved businesses only after checking session ownership', async () => {
    const { service, prisma } = fixture();
    prisma.dataCaptureJob.findFirst.mockResolvedValue({ jobId: 'own-job' });
    const list = jest.spyOn(service, 'listPlaces').mockResolvedValue({ data: [] } as any);
    await service.getCaptureHistoryRecords(user, 'own-job', { page: 2 });
    expect(list).toHaveBeenCalledWith(undefined, { page: 2, jobId: 'own-job' }, user);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('persists failed attempts before returning the original API error', async () => {
    const { service, prisma } = fixture();
    (axios.post as jest.Mock).mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout' });
    await expect(service.extractPlaces(undefined, user, { keyword: 'gym', location: 'Pune', maxResults: 2 })).rejects.toThrow('timed out');
    expect(prisma.dataCaptureJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 12, keyword: 'gym', location: 'Pune', captureStatus: 'FAILED', capturedResults: 0, foundResults: 0 }) });
  });
  it.each([false, true])('persists completed/partial sessions (partial=%s)', async partial => {
    const { service, prisma } = fixture();
    (axios.post as jest.Mock).mockResolvedValueOnce({ data: { places: [{ id: 'place-test', displayName: { text: 'Business' }, formattedAddress: 'Pune' }], ...(partial ? { nextPageToken: 'next' } : {}) } });
    if (partial) (axios.post as jest.Mock).mockRejectedValueOnce(new Error('upstream unavailable'));
    await service.extractPlaces(undefined, user, { keyword: 'gym', location: 'Pune', maxResults: 2 });
    expect(prisma.dataCaptureJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ captureStatus: partial ? 'PARTIALLY_COMPLETED' : 'COMPLETED', foundResults: 1, capturedResults: 1, userId: 12 }) }));
  });
});
