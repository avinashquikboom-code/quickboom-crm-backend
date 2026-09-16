import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
   * Constructs an SSL-compliant S3 URL.
   * For bucket names containing dots (e.g. "qbapp.online"), AWS wildcard certificates
   * (*.s3.region.amazonaws.com) fail hostname verification on virtual-hosted URLs.
   * Path-style ("https://s3.region.amazonaws.com/bucket/key") resolves against the
   * valid AWS certificate SAN without hostname mismatch.
   */
  formatS3Url(bucket: string, region: string, key: string, customDomain?: string): string {
    if (customDomain) {
      return `https://${customDomain}/${key}`;
    }
    if (bucket.includes('.')) {
      return `https://s3.${region}.amazonaws.com/${bucket}/${key}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  /**
   * Resolves AWS S3 credentials dynamically from IntegrationSettingsService.
   * Priority: Admin Settings (DB with 5-min cache) → ENV fallback.
   * Uses forcePathStyle: true to ensure standard TLS certificate validation for all buckets.
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

    if (!config.isConfigured || !config.isEnabled || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('AWS S3 is not configured or enabled');
    }

    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };

    const client = new S3Client({
      region,
      forcePathStyle: true,
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

    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
      'image/svg',
    ];
    if (!allowedMimes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Invalid image format "${file.mimetype}". Supported formats: JPG, JPEG, PNG, WEBP, SVG`,
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

    const imageUrl = this.formatS3Url(bucket, region, imageKey, customDomain);

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

    const imageUrl = this.formatS3Url(bucket, region, imageKey, customDomain);

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
    customKey?: string,
  ): Promise<S3UploadResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Buffer is required for upload');
    }

    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
      'image/svg',
    ];
    const cleanMime = mimetype.toLowerCase();
    if (!allowedMimes.includes(cleanMime)) {
      throw new BadRequestException(
        `Invalid image format "${mimetype}". Supported formats: JPG, JPEG, PNG, WEBP, SVG`,
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
    const imageKey = customKey || `${folder}/${Date.now()}-${uniqueId}-${sanitizedName}`;

    const { client, bucket, region, customDomain } = await this.resolveS3Client();

    this.logger.log(
      `[BANNER_S3_DEBUG]\nbucket: ${bucket}\nkey: ${imageKey}\nuploadStarted: true`,
    );

    const imageUrl = this.formatS3Url(bucket, region, imageKey, customDomain);

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
   * Extracts clean S3 object key from a full S3 URL or returns the key if already relative.
   */
  extractKey(keyOrUrl?: string | null): string | null {
    if (!keyOrUrl || typeof keyOrUrl !== 'string') return null;
    const trimmed = keyOrUrl.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const url = new URL(trimmed);
        const pathname = url.pathname.replace(/^\/+/, '');
        // Matches all known S3 folder conventions:
        // marketing/banners, marketing/trending, marketing/social-media,
        // marketing/videos, marketing/thumbnails, ai-posters, ai-studio
        const match = pathname.match(
          /((?:marketing\/(?:banners|trending|social-media|videos|thumbnails)|ai-posters(?:\/\d+)?|ai-studio(?:\/[^\/?]+)?)\/[^\/?]+)/i,
        );
        if (match) {
          return match[1];
        }
        return pathname;
      } catch (_) {
        return trimmed;
      }
    }

    return trimmed;
  }

  /**
   * Generates a temporary presigned GET URL for an S3 object key or full S3 URL.
   * Presigned URLs grant secure read access to objects in private S3 buckets without making the bucket public.
   */
  async getPresignedUrl(keyOrUrl?: string | null, expiresIn = 3600): Promise<string | null> {
    if (!keyOrUrl) return null;
    const trimmed = keyOrUrl.trim();
    if (!trimmed) return null;

    // If external non-S3 URL or base64 or local disk upload, return directly
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('/uploads/') ||
      trimmed.startsWith('http://localhost') ||
      trimmed.startsWith('https://images.unsplash.com') ||
      trimmed.startsWith('https://placehold.co')
    ) {
      return trimmed;
    }

    const key = this.extractKey(trimmed);
    if (!key) return trimmed;

    try {
      const { client, bucket, region, customDomain } = await this.resolveS3Client();
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const presigned = await getSignedUrl(client, command, { expiresIn });
      return presigned;
    } catch (err: any) {
      this.logger.warn(`[S3_PRESIGNED_URL_WARN] Could not generate presigned URL for ${key}: ${err?.message}`);
      try {
        const { bucket, region, customDomain } = await this.resolveS3Client();
        return this.formatS3Url(bucket, region, key, customDomain);
      } catch {
        return trimmed;
      }
    }
  }

  /**
   * Generates a presigned GET URL specifically for video objects.
   * Uses a longer expiry (7 days = 604800s) so video URLs remain valid
   * during Admin preview and Customer playback sessions.
   */
  async getVideoPresignedUrl(keyOrUrl?: string | null): Promise<string | null> {
    return this.getPresignedUrl(keyOrUrl, 604800); // 7 days
  }

  /**
   * Generates public URL for a given S3 key using current config.
   */
  async getFileUrl(imageKey: string): Promise<string> {
    const config = await this.integrationSettings.getAwsS3Config();
    const bucket = (config.bucket || process.env.AWS_S3_BUCKET || 'quikboom-marketing-banners').trim();
    const region = (config.region || process.env.AWS_REGION || 'ap-south-1').trim();
    const customDomain = (config.customDomain || process.env.AWS_S3_CUSTOM_DOMAIN || '').trim();
    return this.formatS3Url(bucket, region, imageKey, customDomain);
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
