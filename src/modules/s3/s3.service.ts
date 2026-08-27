import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';

export interface S3UploadResult {
  imageUrl: string;
  imageKey: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly isS3Configured: boolean;

  constructor(private readonly configService: ConfigService) {
    this.region =
      this.configService.get<string>('AWS_REGION') ||
      process.env.AWS_REGION ||
      'ap-south-1';
    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET') ||
      this.configService.get<string>('S3_BUCKET') ||
      process.env.AWS_S3_BUCKET ||
      process.env.S3_BUCKET ||
      'quikboom-marketing-banners';

    const accessKeyId =
      this.configService.get<string>('AWS_ACCESS_KEY_ID') ||
      process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ||
      process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint =
      this.configService.get<string>('AWS_S3_ENDPOINT') ||
      process.env.AWS_S3_ENDPOINT;

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
      this.isS3Configured = true;
      this.logger.log(`Amazon S3 initialized for bucket "${this.bucketName}" in region "${this.region}"`);
    } else {
      this.isS3Configured = false;
      this.logger.warn('AWS credentials not found in environment. Using fallback data URI in local/test environment.');
    }
  }

  /**
   * Uploads a file buffer to Amazon S3.
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

    if (this.isS3Configured && this.s3Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: imageKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        });

        await this.s3Client.send(command);

        const customDomain =
          this.configService.get<string>('AWS_S3_CUSTOM_DOMAIN') ||
          process.env.AWS_S3_CUSTOM_DOMAIN;

        const imageUrl = customDomain
          ? `https://${customDomain}/${imageKey}`
          : `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${imageKey}`;

        this.logger.log(`[S3_UPLOAD_SUCCESS] url: ${imageUrl}, key: ${imageKey}`);

        return {
          imageUrl,
          imageKey,
        };
      } catch (err: any) {
        this.logger.error(`[S3_UPLOAD_ERROR] ${err?.message || err}`);
        throw new BadRequestException(
          `Failed to upload image to Amazon S3: ${err?.message || 'S3 Upload Error'}`,
        );
      }
    }

    // Fallback data URI when AWS S3 credentials are not set locally
    const base64Data = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64Data}`;
    this.logger.log(`[LOCAL_UPLOAD_SUCCESS] Generated data URI for ${file.originalname}`);

    return {
      imageUrl: dataUri,
      imageKey,
    };
  }

  /**
   * Deletes an object from Amazon S3 by key.
   */
  async deleteFile(imageKey?: string | null): Promise<void> {
    if (!imageKey || !this.isS3Configured || !this.s3Client) return;

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: imageKey,
      });
      await this.s3Client.send(command);
      this.logger.log(`[S3_DELETE_SUCCESS] key: ${imageKey}`);
    } catch (err: any) {
      this.logger.warn(`[S3_DELETE_WARN] Could not delete S3 object ${imageKey}: ${err?.message}`);
    }
  }

  /**
   * Generates public URL for a given S3 key.
   */
  getFileUrl(imageKey: string): string {
    const customDomain =
      this.configService.get<string>('AWS_S3_CUSTOM_DOMAIN') ||
      process.env.AWS_S3_CUSTOM_DOMAIN;

    return customDomain
      ? `https://${customDomain}/${imageKey}`
      : `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${imageKey}`;
  }
}
