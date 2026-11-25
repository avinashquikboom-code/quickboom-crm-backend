import { AnnouncementService } from './announcement.service';

describe('announcement image previews', () => {
  it('returns a fresh signed preview while retaining the stored image URL', async () => {
    const row = { id: 1, imageUrl: 'https://bucket.s3.amazonaws.com/announcements/a.png', department: null };
    const prisma = { announcement: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([row]) } };
    const s3 = { getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/image') };
    const result = await new AnnouncementService(prisma as any, s3 as any, {} as any).findAll(1);
    expect(s3.getPresignedUrl).toHaveBeenCalledWith(row.imageUrl, 3600);
    expect(result.data[0]).toMatchObject({ imageUrl: row.imageUrl, previewUrl: 'https://signed.example/image' });
  });
});
