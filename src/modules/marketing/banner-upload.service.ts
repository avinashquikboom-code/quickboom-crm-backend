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

    this.logger.log(
      `[BANNER_UPLOAD_DEBUG]\noriginalImageValue: ${file.originalname}\nimageValueType: FILE\nisBase64: false\nisUrl: false\nisFile: true\nfileName: ${file.originalname}`,
    );

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

    this.logger.log(
      `[BANNER_UPLOAD_DEBUG]\noriginalImageValue: ${dataUri.substring(0, 40)}...\nimageValueType: BASE64\nisBase64: true\nisUrl: false\nisFile: false\nfileName: ${filename}`,
    );

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
