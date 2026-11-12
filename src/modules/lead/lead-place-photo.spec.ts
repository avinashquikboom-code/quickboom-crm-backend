import axios from 'axios';
import { LeadRepository } from './lead.repository';

jest.mock('axios');

describe('Google Places lead photos', () => {
  const resource = 'places/ChIJvalaji/photos/AelY_RealPhotoToken';
  const lead = { id: 1009, customerId: 1, companyName: 'Valaji Boutique', googlePlaceId: 'ChIJvalaji', images: [], placePhotos: [] };
  const created: any[] = [];
  const prisma: any = {
    dataCapturePlace: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    leadImage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }) => {
        created.push(data);
        return data;
      }),
    },
  };
  const integrationSettings = {
    getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: true, apiKey: 'server-key' }),
  };

  beforeEach(() => {
    created.length = 0;
    jest.clearAllMocks();
  });

  it('stores a proxy photo for an existing place and does not keep the Google key', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: { photos: [{ name: resource, authorAttributions: [{ displayName: 'A Visitor' }] }] },
    });
    const repository = new LeadRepository(prisma, integrationSettings as any);
    await (repository as any).attachPlacePhotos([lead]);

    expect(axios.get).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places/ChIJvalaji',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Goog-FieldMask': 'photos' }) }),
    );
    expect(JSON.stringify((axios.get as jest.Mock).mock.calls)).not.toMatch(/AIza/);
    expect(lead.placePhotos[0].url).toBe(`/api/v1/data-capture/photo?ref=${encodeURIComponent(resource)}`);
    expect(lead.placePhotos[0].attributions).toEqual(['A Visitor']);
    expect(created[0]).toEqual(expect.objectContaining({ leadId: 1009, isPrimary: true, url: lead.placePhotos[0].url }));
    expect(created[0].url).not.toContain('server-key');
  });

  it('recovers uploaded photos from an older linked capture with an empty photos array', async () => {
    const imported = { ...lead, images: [], placePhotos: [] };
    prisma.dataCapturePlace.findMany.mockResolvedValueOnce([
      { customerId: 1, importedLeadId: lead.id, photos: [], rawData: {
        photos: [{ secure_url: 'https://cdn.example.test/store.webp' }],
        images: ['/uploads/entrance.jpg'],
      } },
      { customerId: 2, importedLeadId: lead.id, photos: ['https://cdn.example.test/other.jpg'] },
    ]);
    const repository = new LeadRepository(prisma, integrationSettings as any);
    await (repository as any).attachPlacePhotos([imported]);

    expect(imported.placePhotos).toEqual([
      { url: 'https://cdn.example.test/store.webp', attributions: [] },
      { url: '/uploads/entrance.jpg', attributions: [] },
    ]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('leaves a manual lead without a place id untouched', async () => {
    const manual = { id: 4, customerId: 1, companyName: 'Manual Shop', images: [] };
    const repository = new LeadRepository(prisma, integrationSettings as any);
    await (repository as any).attachPlacePhotos([manual]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('stops the batch when Google reports a quota limit', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ status: 429, data: {} });
    const first = { ...lead, id: 1, placePhotos: [] };
    const second = { ...lead, id: 2, googlePlaceId: 'ChIJsecond', placePhotos: [] };
    const repository = new LeadRepository(prisma, integrationSettings as any);
    await (repository as any).attachPlacePhotos([first, second]);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(first.placePhotos).toEqual([]);
  });
});
