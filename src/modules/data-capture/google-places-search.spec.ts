import axios from 'axios';
import { DataCaptureService } from './data-capture.service';

function setup(enabled: boolean) {
  const prisma = { dataCaptureJob: { create: jest.fn() } };
  const service = new DataCaptureService({} as any, prisma as any, {
    getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: enabled, apiKey: enabled ? 'test-key' : '' }),
  } as any);
  jest.spyOn(service, 'getUsageSummary').mockResolvedValue({ quotaRemaining: 60 } as any);
  return { service, prisma };
}

describe('Google Places search failures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects missing configuration without persisting fabricated businesses', async () => {
    const { service, prisma } = setup(false);
    await expect(service.extractPlaces(undefined, { id: 2 }, { keyword: 'Design', location: 'Test City' }))
      .rejects.toMatchObject({ status: 503 });
    expect(prisma.dataCaptureJob.create).not.toHaveBeenCalled();
  });

  it('rejects upstream failures without a sandbox success response', async () => {
    const { service, prisma } = setup(true);
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('upstream unavailable'));
    await expect(service.extractPlaces(undefined, { id: 2 }, { keyword: 'Design', location: 'Test City' }))
      .rejects.toMatchObject({ status: 502 });
    expect(prisma.dataCaptureJob.create).not.toHaveBeenCalled();
  });
});
