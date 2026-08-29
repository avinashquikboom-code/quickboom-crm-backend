import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { S3Service } from '../s3/s3.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface UploadResult {
  imageUrl: string;
  imagePublicId?: string | null;
}

@Injectable()
export class BannerUploadService {
  private readonly logger = new Logger(BannerUploadService.name);

  constructor(private readonly s3Service: S3Service) {}

  // ─── Local Disk Fallback ─────────────────────────────────────────────────────

  /**
   * Saves a buffer to the local uploads directory and returns a relative URL
   * (e.g. /uploads/banners/1234-abc-image.jpg) that is served by the static
   * file server registered in main.ts.
   */
  private saveToLocalDisk(buffer: Buffer, ext: string, folder: string): string {
    // Resolve to <project_root>/uploads/<folder>/
    const uploadDir = path.join(process.cwd(), 'uploads', folder);
    fs.mkdirSync(uploadDir, { recursive: true });

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}-${uniqueId}.${ext}`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, buffer);

    const relativeUrl = `/uploads/${folder}/${filename}`;
    this.logger.log(`[LOCAL_DISK_SAVE_SUCCESS] path: ${filepath}  url: ${relativeUrl}`);
    return relativeUrl;
  }

  // ─── Public Upload Methods ────────────────────────────────────────────────────

  async uploadBannerImage(
    file: Express.Multer.File,
    folder = 'banners',
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    this.logger.log(
      `[BANNER_UPLOAD_DEBUG]\noriginalImageValue: ${file.originalname}\nimageValueType: FILE\nisBase64: false\nisUrl: false\nisFile: true\nfileName: ${file.originalname}`,
    );

    // Try S3 first; fall back to local disk on any error
    try {
      const s3Result = await this.s3Service.uploadFile(file, `marketing/${folder}`);
      this.logger.log(`[S3_UPLOAD_SUCCESS] url: ${s3Result.imageUrl}, key: ${s3Result.imageKey}`);
      return {
        imageUrl: s3Result.imageUrl,
        imagePublicId: s3Result.imageKey,
      };
    } catch (s3Err: any) {
      this.logger.warn(
        `[S3_UPLOAD_FALLBACK] S3 failed (${s3Err?.message}). Saving to local disk.`,
      );

      const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
      const localUrl = this.saveToLocalDisk(file.buffer, ext, folder);
      return { imageUrl: localUrl, imagePublicId: null };
    }
  }

  async uploadBase64(
    dataUri: string,
    folder = 'banners',
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

    // Try S3 first; fall back to local disk on any error
    try {
      const s3Result = await this.s3Service.uploadBuffer(buffer, mimeType, filename, `marketing/${folder}`);
      this.logger.log(`[S3_BASE64_UPLOAD_SUCCESS] url: ${s3Result.imageUrl}, key: ${s3Result.imageKey}`);
      return {
        imageUrl: s3Result.imageUrl,
        imagePublicId: s3Result.imageKey,
      };
    } catch (s3Err: any) {
      this.logger.warn(
        `[S3_BASE64_UPLOAD_FALLBACK] S3 failed (${s3Err?.message}). Saving to local disk.`,
      );

      const localUrl = this.saveToLocalDisk(buffer, ext, folder);
      return { imageUrl: localUrl, imagePublicId: null };
    }
  }

  async deleteBannerImage(imageKey?: string | null): Promise<void> {
    if (!imageKey) return;
    // Only attempt S3 delete for S3 keys (not local disk paths)
    if (imageKey.startsWith('/uploads/') || imageKey.startsWith('uploads/')) return;
    await this.s3Service.deleteFile(imageKey);
  }
}
