import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export interface UploadResult {
  imageUrl: string;
  imagePublicId?: string | null;
}

@Injectable()
export class BannerUploadService {
  private readonly logger = new Logger(BannerUploadService.name);
  private readonly isCloudinaryConfigured: boolean;

  constructor(private readonly configService: ConfigService) {
    const cloudName =
      this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ||
      process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey =
      this.configService.get<string>('CLOUDINARY_API_KEY') ||
      process.env.CLOUDINARY_API_KEY;
    const apiSecret =
      this.configService.get<string>('CLOUDINARY_API_SECRET') ||
      process.env.CLOUDINARY_API_SECRET;

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isCloudinaryConfigured = true;
      this.logger.log(`Cloudinary configured successfully for cloud: ${cloudName}`);
    } else {
      this.isCloudinaryConfigured = false;
      this.logger.warn(
        'Cloudinary credentials not detected in environment. Using fallback data URI / memory storage.',
      );
    }
  }

  /**
   * Upload an image file buffer to Cloudinary or return high-res data URI
   */
  async uploadBannerImage(
    file: Express.Multer.File,
    folder = 'quikboom/banners',
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    // Validate mime type (JPG, JPEG, PNG, WEBP)
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

    // Max file size: 10MB
    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        `Image size exceeds maximum limit of 10MB (file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
      );
    }

    if (this.isCloudinaryConfigured) {
      try {
        const result = await new Promise<UploadApiResponse>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: 'image',
              transformation: [
                { quality: 'auto', fetch_format: 'auto' },
              ],
            },
            (error, response) => {
              if (error || !response) {
                reject(error || new Error('Cloudinary upload returned empty response'));
              } else {
                resolve(response);
              }
            },
          );
          uploadStream.end(file.buffer);
        });

        this.logger.log(`[CLOUDINARY_UPLOAD_SUCCESS] url: ${result.secure_url}, publicId: ${result.public_id}`);
        return {
          imageUrl: result.secure_url,
          imagePublicId: result.public_id,
        };
      } catch (err: any) {
        this.logger.error(`[CLOUDINARY_UPLOAD_ERROR] ${err?.message || err}`);
        throw new BadRequestException(
          `Failed to upload image to Cloudinary: ${err?.message || 'Upload error'}`,
        );
      }
    }

    // Fallback: Convert to base64 Data URI when Cloudinary credentials are not present locally
    const base64Data = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64Data}`;
    this.logger.log(`[LOCAL_UPLOAD_SUCCESS] Generated data URI for ${file.originalname}`);

    return {
      imageUrl: dataUri,
      imagePublicId: null,
    };
  }

  /**
   * Delete image from Cloudinary by public ID
   */
  async deleteBannerImage(publicId?: string | null): Promise<void> {
    if (!publicId || !this.isCloudinaryConfigured) return;

    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`[CLOUDINARY_DELETE_SUCCESS] publicId: ${publicId}`);
    } catch (err: any) {
      this.logger.warn(`[CLOUDINARY_DELETE_WARN] Could not delete image ${publicId}: ${err?.message}`);
    }
  }
}
