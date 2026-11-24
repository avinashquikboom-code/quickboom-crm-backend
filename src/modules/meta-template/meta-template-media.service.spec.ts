import { MetaTemplateMediaService } from './meta-template-media.service';

describe('template header image uploads', () => {
  const s3 = { uploadBuffer: jest.fn() };
  const service = new MetaTemplateMediaService(s3 as any);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(8)]);
  beforeEach(() => { s3.uploadBuffer.mockReset().mockResolvedValue({ imageUrl: 'https://cdn.example.com/image.png' }); });
  it('stores a valid PNG and returns its reference', async () => {
    const result = await service.uploadImage({ buffer: png, mimetype: 'image/png', originalname: 'header.png' } as any, 12);
    expect(result.url).toBe('https://cdn.example.com/image.png');
    expect(s3.uploadBuffer).toHaveBeenCalledWith(png, 'image/png', 'header.png', 'meta-templates/12');
  });
  it('rejects disguised files, mismatched content types and oversized files', async () => {
    await expect(service.uploadImage({ buffer: Buffer.from('not an image'), mimetype: 'image/png' } as any, 12)).rejects.toThrow(/valid JPG or PNG/);
    await expect(service.uploadImage({ buffer: png, mimetype: 'image/jpeg' } as any, 12)).rejects.toThrow(/valid JPG or PNG/);
    await expect(service.uploadImage({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/png' } as any, 12)).rejects.toThrow(/5 MB/);
    expect(s3.uploadBuffer).not.toHaveBeenCalled();
  });
  it('rejects missing workspace before uploading', async () => {
    await expect(service.uploadImage({ buffer: png, mimetype: 'image/png' } as any)).rejects.toThrow(/workspace/);
    expect(s3.uploadBuffer).not.toHaveBeenCalled();
  });
});
