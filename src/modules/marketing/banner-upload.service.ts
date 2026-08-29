import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { S3Service } from '../s3/s3.service';

export interface UploadResult {
  imageUrl: string;
  imagePublicId?: string | null;
}

@Injectable()
export class BannerUploadService {
  private readonly logger = new Logger(BannerUploadService.name);

  constructor(private readonly s3Service: S3Service) {}

  async uploadBannerImage(
    file: Express.Multer.File,
    folder = 'marketing/banners',
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const s3Result = await this.s3Service.uploadFile(file, folder);
    this.logger.log(`[S3_UPLOAD_SUCCESS] url: ${s3Result.imageUrl}, key: ${s3Result.imageKey}`);
    return {
      imageUrl: s3Result.imageUrl,
      imagePublicId: s3Result.imageKey,
    };
  }

  async uploadBase64(
    dataUri: string,
    folder = 'marketing/banners',
  ): Promise<UploadResult> {
    if (!dataUri || !dataUri.startsWith('data:')) {
      throw new BadRequestException('Invalid base64 data URI format');
    }

    const matches = dataUri.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new BadRequestException('Invalid base64 image data');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `banner.${ext}`;

    const s3Result = await this.s3Service.uploadBuffer(buffer, mimeType, filename, folder);
    this.logger.log(`[S3_BASE64_UPLOAD_SUCCESS] url: ${s3Result.imageUrl}, key: ${s3Result.imageKey}`);
    return {
      imageUrl: s3Result.imageUrl,
      imagePublicId: s3Result.imageKey,
    };
  }

  async deleteBannerImage(imageKey?: string | null): Promise<void> {
    if (!imageKey) return;
    await this.s3Service.deleteFile(imageKey);
  }
}
