import { BadRequestException, Injectable } from '@nestjs/common';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class MetaTemplateMediaService {
  constructor(private readonly s3: S3Service) {}

  async uploadImage(file: Express.Multer.File, customerId?: number | string) {
    const data = file?.buffer;
    if (!data?.length) throw new BadRequestException('Choose an image file.');
    if (data.length > 5 * 1024 * 1024) throw new BadRequestException('Image must be 5 MB or smaller.');
    const png = data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.subarray(12, 16).toString('ascii') === 'IHDR';
    const jpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
    const actual = png ? 'image/png' : jpeg ? 'image/jpeg' : '';
    const reported = String(file.mimetype || '').toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!actual || reported !== actual) throw new BadRequestException('Upload a valid JPG or PNG image with a matching content type.');
    const tenant = Number(customerId);
    if (!Number.isSafeInteger(tenant) || tenant <= 0) throw new BadRequestException('A workspace is required to upload an image.');
    const result = await this.s3.uploadBuffer(data, actual, actual === 'image/png' ? 'header.png' : 'header.jpg', `meta-templates/${tenant}`);
    const reference = `s3key:${result.imageKey}`;
    const previewUrl = await this.previewImage(reference, tenant);
    return { reference, previewUrl, url: previewUrl, fileName: file.originalname, size: data.length, mimeType: actual };
  }

  private keyForWorkspace(reference: string, customerId?: number | string) {
    const tenant = Number(customerId);
    if (!Number.isSafeInteger(tenant) || tenant <= 0) throw new BadRequestException('A workspace is required.');
    const input = String(reference || '').trim();
    let key = input.startsWith('s3key:') ? input.slice(6) : '';
    if (!key && /^https:\/\//i.test(input)) {
      try {
        const path = decodeURIComponent(new URL(input).pathname);
        const prefix = `/meta-templates/${tenant}/`;
        const index = path.indexOf(prefix);
        if (index >= 0) key = path.slice(index + 1);
      } catch { throw new BadRequestException('Invalid media reference.'); }
    }
    const prefix = `meta-templates/${tenant}/`;
    if (!key.startsWith(prefix) || !/^[a-zA-Z0-9._-]+$/.test(key.slice(prefix.length))) throw new BadRequestException('Image is not available in this workspace.');
    return key;
  }

  async readImage(reference: string, customerId?: number | string) {
    const key = this.keyForWorkspace(reference, customerId);
    const data = await this.s3.readPrivateObject(key);
    if (!data.length || data.length > 5 * 1024 * 1024) throw new BadRequestException('Stored image is empty or exceeds 5 MB. Upload it again.');
    const png = data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.subarray(12, 16).toString('ascii') === 'IHDR';
    const jpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
    if (!png && !jpeg) throw new BadRequestException('Stored image is invalid. Upload a JPG or PNG again.');
    return { data, mimeType: png ? 'image/png' : 'image/jpeg', fileName: png ? 'header.png' : 'header.jpg' };
  }

  async previewImage(reference: string, customerId?: number | string) {
    const key = this.keyForWorkspace(reference, customerId);
    const url = await this.s3.getPresignedUrl(key, 3600);
    if (!url || !/^https:\/\//i.test(url)) throw new BadRequestException('Could not generate an image preview URL.');
    return url;
  }
}
