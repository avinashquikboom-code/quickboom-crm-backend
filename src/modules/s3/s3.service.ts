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

    const bucket = (config.bucket || process.env.AWS_S3_BUCKET || 'quikboom-marketing-banners').trim();
    const region = (config.region || process.env.AWS_REGION || 'ap-south-1').trim();
    const customDomain = (config.customDomain || process.env.AWS_S3_CUSTOM_DOMAIN || '').trim();

    const credentials =
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined;

    const client = new S3Client({
      region,
      credentials,
    });

    return {
      client,
      bucket,
      region,
      customDomain,
    };
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = 'marketing/banners',
  ): Promise<S3UploadResult> {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
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

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .toLowerCase();
    const imageKey = `${folder}/${Date.now()}-${uniqueId}-${sanitizedName}`;

    const { client, bucket, region, customDomain } = await this.resolveS3Client();

    this.logger.log(
      `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true`,
    );

    const imageUrl = customDomain
      ? `https://${customDomain}/${imageKey}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${imageKey}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: imageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await client.send(command);

      this.logger.log(
        `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: true\ns3Url: ${imageUrl}`,
      );

      return { imageUrl, imageKey };
    } catch (err: any) {
      this.logger.error(
        `[S3_UPLOAD_FAILED]\nbucket: ${bucket}\nkey: ${imageKey}\nerror: ${err?.message || err}`,
      );
      throw new Error(`S3 upload failed: ${err?.message || err}`);
    }
  }

  /**
   * Universal media upload method supporting Images (JPG, PNG, WEBP) & Videos (MP4, MOV, WEBM)
   */
  async uploadMedia(
    file: Express.Multer.File,
    folder = 'marketing/trending',
    expectedType?: 'IMAGE' | 'VIDEO',
  ): Promise<S3UploadResult> {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }

    const imageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const videoMimes = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'video/avi',
      'video/mpeg',
      'video/ogg',
      'video/3gpp',
    ];

    const cleanMime = (file.mimetype || '').toLowerCase();
    const isImage = imageMimes.includes(cleanMime);
    const isVideo = videoMimes.includes(cleanMime);

    if (expectedType === 'IMAGE' && !isImage) {
      throw new BadRequestException(
        `Invalid image format "${file.mimetype}". Supported image formats: JPG, JPEG, PNG, WEBP`,
      );
    }

    if (expectedType === 'VIDEO' && !isVideo) {
      throw new BadRequestException(
        `Invalid video format "${file.mimetype}". Supported video formats: MP4, MOV, WEBM, MKV, AVI`,
      );
    }

    if (!isImage && !isVideo) {
      throw new BadRequestException(
        `Unsupported media format "${file.mimetype}". Please upload an image (JPG, PNG, WEBP) or video (MP4, MOV, WEBM).`,
      );
    }

    const maxImageSize = 10 * 1024 * 1024; // 10MB
    const maxVideoSize = 100 * 1024 * 1024; // 100MB

    if (isImage && file.size > maxImageSize) {
      throw new BadRequestException(
        `Image size exceeds maximum limit of 10MB (file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    if (isVideo && file.size > maxVideoSize) {
      throw new BadRequestException(
        `Video size exceeds maximum limit of 100MB (file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const sanitizedName = (file.originalname || (isImage ? 'media.jpg' : 'media.mp4'))
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .toLowerCase();
    const imageKey = `${folder}/${Date.now()}-${uniqueId}-${sanitizedName}`;

    const { client, bucket, region, customDomain } = await this.resolveS3Client();

    this.logger.log(
      `[MEDIA_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true`,
    );

    const imageUrl = customDomain
      ? `https://${customDomain}/${imageKey}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${imageKey}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: imageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await client.send(command);

      this.logger.log(
        `[MEDIA_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadSuccess: true\ns3Url: ${imageUrl}`,
      );

      return { imageUrl, imageKey };
    } catch (err: any) {
      this.logger.error(
        `[S3_UPLOAD_FAILED]\nbucket: ${bucket}\nkey: ${imageKey}\nerror: ${err?.message || err}`,
      );
      throw new Error(`S3 upload failed: ${err?.message || err}`);
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

    const imageUrl = customDomain
      ? `https://${customDomain}/${imageKey}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${imageKey}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: imageKey,
        Body: buffer,
        ContentType: cleanMime,
      });

      await client.send(command);

      this.logger.log(
        `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true\nuploadSuccess: true\ns3Url: ${imageUrl}`,
      );

      return { imageUrl, imageKey };
    } catch (err: any) {
      this.logger.error(
        `[S3_UPLOAD_FAILED]\nbucket: ${bucket}\nkey: ${imageKey}\nerror: ${err?.message || err}`,
      );
      throw new Error(`S3 upload failed: ${err?.message || err}`);
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
