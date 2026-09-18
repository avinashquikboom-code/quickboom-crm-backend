import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApps, initializeApp, cert, applicationDefault, App, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, MulticastMessage, BatchResponse } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  messageIds: string[];
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private firebaseApp: App | null = null;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      this.firebaseApp = existingApps[0];
      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK already initialized from existing app instance.');
      return;
    }

    try {
      const projectId =
        this.configService.get<string>('FIREBASE_PROJECT_ID') ||
        process.env.FIREBASE_PROJECT_ID ||
        'quikboom-crm-925d5';
      const clientEmail =
        this.configService.get<string>('FIREBASE_CLIENT_EMAIL') ||
        process.env.FIREBASE_CLIENT_EMAIL;
      let privateKey =
        this.configService.get<string>('FIREBASE_PRIVATE_KEY') ||
        process.env.FIREBASE_PRIVATE_KEY;

      const serviceAccountPath =
        this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') ||
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const serviceAccountJson =
        this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON') ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

      let credential: any = null;

      if (projectId && clientEmail && privateKey) {
        // Handle escaped newlines in private key string
        privateKey = privateKey.replace(/\\n/g, '\n');
        const serviceAccount: ServiceAccount = {
          projectId,
          clientEmail,
          privateKey,
        };
        credential = cert(serviceAccount);
        this.logger.log(`Initializing Firebase Admin SDK with project: ${projectId} (client: ${clientEmail})`);
      } else if (serviceAccountJson) {
        const parsed = JSON.parse(serviceAccountJson);
        credential = cert(parsed);
        this.logger.log(`Initializing Firebase Admin SDK from JSON config for project: ${parsed.project_id}`);
      } else if (serviceAccountPath) {
        const resolvedPath = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.resolve(process.cwd(), serviceAccountPath);

        if (fs.existsSync(resolvedPath)) {
          const fileContent = fs.readFileSync(resolvedPath, 'utf8');
          const parsed = JSON.parse(fileContent);
          credential = cert(parsed);
          this.logger.log(`Initializing Firebase Admin SDK from file: ${resolvedPath}`);
        } else {
          this.logger.warn(`Firebase service account file not found at: ${resolvedPath}`);
        }
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = applicationDefault();
        this.logger.log('Initializing Firebase Admin SDK with Application Default Credentials');
      }

      if (credential) {
        this.firebaseApp = initializeApp({
          credential,
        });
        this.isInitialized = true;
        this.logger.log(`✅ Firebase Admin SDK successfully initialized for project "${projectId}".`);
      } else {
        this.logger.warn(
          `Firebase Admin credentials are not configured for project "${projectId}". Push notifications cannot be dispatched to FCM until real credentials are supplied.`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${error?.message}`, error?.stack);
    }
  }

  /**
   * Check if Firebase Admin is ready to send notifications
   */
  public ready(): boolean {
    return this.isInitialized && this.firebaseApp !== null;
  }

  /**
   * Send FCM multicast push notification to multiple device tokens
   */
  async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<FcmSendResult> {
    const validTokens = (tokens || []).filter((t) => typeof t === 'string' && t.trim().length > 0);

    if (validTokens.length === 0) {
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        messageIds: [],
      };
    }

    // Stringify all values in data payload for Firebase compliance
    const stringifiedData: Record<string, string> = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    if (!this.ready() || !this.firebaseApp) {
      this.logger.error(
        `[FCM Dispatch Failed] Firebase Admin SDK is not initialized; push notification was not sent to ${validTokens.length} device(s).`,
      );
      return {
        successCount: 0,
        failureCount: validTokens.length,
        invalidTokens: [],
        messageIds: [],
      };
    }

    const invalidTokens: string[] = [];
    const messageIds: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Firebase multicast supports up to 500 tokens per batch
    const batchSize = 500;
    const messaging = getMessaging(this.firebaseApp);

    for (let i = 0; i < validTokens.length; i += batchSize) {
      const batchTokens = validTokens.slice(i, i + batchSize);

      const message: MulticastMessage = {
        tokens: batchTokens,
        notification: {
          title,
          body,
        },
        data: stringifiedData,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'high_importance_channel',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      try {
        const response: BatchResponse = await messaging.sendEachForMulticast(message);
        successCount += response.successCount;
        failureCount += response.failureCount;

        response.responses.forEach((resp, index) => {
          if (resp.success && resp.messageId) {
            messageIds.push(resp.messageId);
          } else if (resp.error) {
            const token = batchTokens[index];
            const errorCode = resp.error.code;
            const maskedToken = token.length > 8 ? `${token.substring(0, 8)}...` : '***';
            this.logger.warn(`FCM send error for token "${maskedToken}": ${errorCode} (${resp.error.message})`);

            // Detect unregistered / expired / invalid tokens for cleanup
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/mismatched-credential'
            ) {
              invalidTokens.push(token);
            }
          }
        });
      } catch (batchError: any) {
        this.logger.error(`Error sending FCM batch: ${batchError?.message}`, batchError?.stack);
        failureCount += batchTokens.length;
      }
    }

    this.logger.log(
      `[FCM Send Result] Title: "${title}" | Sent: ${successCount} | Failed: ${failureCount} | Invalid Tokens: ${invalidTokens.length}`,
    );

    return {
      successCount,
      failureCount,
      invalidTokens,
      messageIds,
    };
  }
}
