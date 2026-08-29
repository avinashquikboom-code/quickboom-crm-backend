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

    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];
    if (!allowedMimes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Invalid image format "${file.mimetype}". Supported formats: JPG, JPEG, PNG, WEBP`,
      );
    }

    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        `Image size exceeds maximum limit of 10MB (file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    try {
      const s3Result = await this.s3Service.uploadFile(file, folder);
      this.logger.log(`[S3_UPLOAD_SUCCESS] url: ${s3Result.imageUrl}, key: ${s3Result.imageKey}`);
      return {
        imageUrl: s3Result.imageUrl,
        imagePublicId: s3Result.imageKey,
      };
    } catch (s3Err: any) {
      this.logger.warn(
        `[S3_UPLOAD_FALLBACK] S3 upload skipped or unavailable (${s3Err?.message}). Generating Data URI fallback for local/test environment.`,
      );
      const base64Data = file.buffer.toString('base64');
      const dataUri = `data:${file.mimetype};base64,${base64Data}`;
      return {
        imageUrl: dataUri,
        imagePublicId: null,
      };
    }
  }

  async deleteBannerImage(imageKey?: string | null): Promise<void> {
    if (!imageKey) return;
    await this.s3Service.deleteFile(imageKey);
  }
}
