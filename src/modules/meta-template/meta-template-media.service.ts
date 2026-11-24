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
    return { url: result.imageUrl, fileName: file.originalname, size: data.length, mimeType: actual };
  }
}
