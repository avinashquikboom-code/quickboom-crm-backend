import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

export interface S3UploadResult {
  imageUrl: string;
  imageKey: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly integrationSettings: IntegrationSettingsService) {}

  /**
   * Resolves AWS S3 credentials dynamically from IntegrationSettingsService.
   * Priority: Admin Settings (DB with 5-min cache) → ENV fallback.
   * This ensures that Admin Panel changes take effect immediately.
   */
  private async resolveS3Client(): Promise<{
    client: S3Client;
    bucket: string;
    region: string;
    customDomain: string;
  }> {
    const config = await this.integrationSettings.getAwsS3Config();

    if (!config.isConfigured) {
      throw new BadRequestException(
        'Amazon S3 is not configured. Please set AWS credentials in Admin → Settings → Integrations.',
      );
    }

    const client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    return {
      client,
      bucket: config.bucket,
      region: config.region,
      customDomain: config.customDomain || '',
    };
  }

  /**
   * Uploads a file buffer to Amazon S3.
   * Credentials are fetched dynamically — Admin Setting changes take effect immediately.
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'marketing/banners',
  ): Promise<S3UploadResult> {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }

    // Validate MIME types
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Invalid image format "${file.mimetype}". Supported formats: JPG, JPEG, PNG, WEBP`,
      );
    }

    // Max file size: 10MB
    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        `Image size exceeds maximum limit of 10MB (file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .toLowerCase();
    const imageKey = `${folder}/${Date.now()}-${uniqueId}-${sanitizedName}`;

    const { client, bucket, region, customDomain } = await this.resolveS3Client();

    this.logger.log(
      `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true`,
    );

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: imageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await client.send(command);

      const imageUrl = customDomain
        ? `https://${customDomain}/${imageKey}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${imageKey}`;

      this.logger.log(
        `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: true\ns3Url: ${imageUrl}`,
      );

      return { imageUrl, imageKey };
    } catch (err: any) {
      this.logger.error(`[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: false\ns3Url: null\nerror: ${err?.message || err}`);
      throw new BadRequestException(
        `Failed to upload image to Amazon S3: ${err?.message || 'S3 Upload Error'}`,
      );
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    mimetype: string,
    filename = 'image.png',
    folder = 'marketing/banners',
  ): Promise<S3UploadResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Buffer is required for upload');
    }

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const cleanMime = mimetype.toLowerCase();
    if (!allowedMimes.includes(cleanMime)) {
      throw new BadRequestException(
        `Invalid image format "${mimetype}". Supported formats: JPG, JPEG, PNG, WEBP`,
      );
    }

    const maxSizeBytes = 10 * 1024 * 1024;
    if (buffer.length > maxSizeBytes) {
      throw new BadRequestException(
        `Image size exceeds maximum limit of 10MB (file size: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
    const imageKey = `${folder}/${Date.now()}-${uniqueId}-${sanitizedName}`;

    const { client, bucket, region, customDomain } = await this.resolveS3Client();

    this.logger.log(
      `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true`,
    );

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: imageKey,
        Body: buffer,
        ContentType: cleanMime,
      });

      await client.send(command);

      const imageUrl = customDomain
        ? `https://${customDomain}/${imageKey}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${imageKey}`;

      this.logger.log(
        `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: true\ns3Url: ${imageUrl}`,
      );

      return { imageUrl, imageKey };
    } catch (err: any) {
      this.logger.error(`[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: false\ns3Url: null\nerror: ${err?.message || err}`);
      throw new BadRequestException(
        `Failed to upload image to Amazon S3: ${err?.message || 'S3 Upload Error'}`,
      );
    }
  }

  /**
   * Deletes an object from Amazon S3 by key.
   * Silently warns on failure (non-critical — DB is source of truth).
   */
  async deleteFile(imageKey?: string | null): Promise<void> {
    if (!imageKey) return;

    let client: S3Client;
    let bucket: string;

    try {
      const resolved = await this.resolveS3Client();
      client = resolved.client;
      bucket = resolved.bucket;
    } catch {
      this.logger.warn(`[S3_DELETE_SKIP] S3 not configured — cannot delete key: ${imageKey}`);
      return;
    }

    try {
      const command = new DeleteObjectCommand({ Bucket: bucket, Key: imageKey });
      await client.send(command);
      this.logger.log(`[S3_DELETE_SUCCESS] key: ${imageKey}`);
    } catch (err: any) {
      this.logger.warn(`[S3_DELETE_WARN] Could not delete S3 object ${imageKey}: ${err?.message}`);
    }
  }

  /**
   * Generates public URL for a given S3 key using current config.
   */
  async getFileUrl(imageKey: string): Promise<string> {
    const config = await this.integrationSettings.getAwsS3Config();
    return config.customDomain
      ? `https://${config.customDomain}/${imageKey}`
      : `https://${config.bucket}.s3.${config.region}.amazonaws.com/${imageKey}`;
  }

  /**
   * Tests S3 connectivity by listing objects (max 1) — used by testIntegration.
   */
  async testConnection(): Promise<{ success: boolean; bucket: string; region: string }> {
    const { client, bucket, region } = await this.resolveS3Client();
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return { success: true, bucket, region };
  }
}
