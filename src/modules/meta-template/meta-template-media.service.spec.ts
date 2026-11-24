import { MetaTemplateMediaService } from './meta-template-media.service';

describe('template header image uploads', () => {
  const s3 = { uploadBuffer: jest.fn(), getPresignedUrl: jest.fn() };
  const service = new MetaTemplateMediaService(s3 as any);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(8)]);
  beforeEach(() => { s3.uploadBuffer.mockReset().mockResolvedValue({ imageKey: 'meta-templates/12/header.png', imageUrl: 'https://cdn.example.com/image.png' }); s3.getPresignedUrl.mockReset().mockResolvedValue('https://cdn.example.com/signed-image'); });
  it('stores a valid PNG and returns its reference', async () => {
    const result = await service.uploadImage({ buffer: png, mimetype: 'image/png', originalname: 'header.png' } as any, 12);
    expect(result.reference).toBe('s3key:meta-templates/12/header.png');
    expect(result.previewUrl).toBe('https://cdn.example.com/signed-image');
    expect(s3.getPresignedUrl).toHaveBeenCalledWith('meta-templates/12/header.png', 3600);
    expect(s3.uploadBuffer).toHaveBeenCalledWith(png, 'image/png', 'header.png', 'meta-templates/12');
  });
  it('rejects disguised files, mismatched content types and oversized files', async () => {
    await expect(service.uploadImage({ buffer: Buffer.from('not an image'), mimetype: 'image/png' } as any, 12)).rejects.toThrow(/valid JPG or PNG/);
    await expect(service.uploadImage({ buffer: png, mimetype: 'image/jpeg' } as any, 12)).rejects.toThrow(/valid JPG or PNG/);
    await expect(service.uploadImage({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/png' } as any, 12)).rejects.toThrow(/5 MB/);
    expect(s3.uploadBuffer).not.toHaveBeenCalled();
  });
  it('signs only keys owned by the current workspace, including older image URLs', async () => {
    await expect(service.previewImage('s3key:meta-templates/13/secret.png', 12)).rejects.toThrow(/workspace/);
    await expect(service.previewImage('s3key:meta-templates/12/../secret.png', 12)).rejects.toThrow(/workspace/);
    await expect(service.previewImage('https://bucket.example.com/meta-templates/12/header.png', 12)).resolves.toBe('https://cdn.example.com/signed-image');
    expect(s3.getPresignedUrl).toHaveBeenCalledWith('meta-templates/12/header.png', 3600);
  });
  it('rejects missing workspace before uploading', async () => {
    await expect(service.uploadImage({ buffer: png, mimetype: 'image/png' } as any)).rejects.toThrow(/workspace/);
    expect(s3.uploadBuffer).not.toHaveBeenCalled();
  });
});
