import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApps, initializeApp, cert, applicationDefault, App, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, MulticastMessage, BatchResponse, Message } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  messageIds: string[];
}

export interface FcmContextMeta {
  customerId?: string | number;
  notificationType?: string;
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
        this.configService.get<string>('FIREBASE_CLIENT_EMAIL') || process.env.FIREBASE_CLIENT_EMAIL;
      const rawPrivateKey =
        this.configService.get<string>('FIREBASE_PRIVATE_KEY') || process.env.FIREBASE_PRIVATE_KEY;
      const serviceAccountJson =
        this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON') ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      const serviceAccountPath =
        this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') ||
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

      let credential = null;

      if (clientEmail && rawPrivateKey) {
        const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
        const serviceAccount: ServiceAccount = {
          projectId,
          clientEmail,
          privateKey,
        };
        credential = cert(serviceAccount);
        this.logger.log(`Initializing Firebase Admin SDK with project: ${projectId} (client: ${clientEmail})`);
      } else if (serviceAccountJson) {
        const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        credential = cert(parsed);
        this.logger.log(`Initializing Firebase Admin SDK from JSON config for project: ${parsed.project_id}`);
      } else if (serviceAccountPath) {
        const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
        if (fs.existsSync(resolvedPath)) {
          const fileContent = fs.readFileSync(resolvedPath, 'utf8');
          const parsed = JSON.parse(fileContent);
          credential = cert(parsed);
          this.logger.log(`Initializing Firebase Admin SDK from file: ${resolvedPath} (project: ${parsed.project_id})`);
        } else {
          this.logger.warn(`Firebase service account file not found at: ${resolvedPath}`);
        }
      } else {
        // Search default filesystem locations for service-account credentials
        const candidates = [
          path.resolve(process.cwd(), 'firebase-service-account.json'),
          path.resolve(process.cwd(), 'service-account.json'),
          path.resolve(process.cwd(), 'secrets/firebase-service-account.json'),
          '/var/www/qbapp.online/secrets/firebase-service-account.json',
          '/var/www/qbapp.online/firebase-service-account.json',
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            try {
              const fileContent = fs.readFileSync(candidate, 'utf8');
              const parsed = JSON.parse(fileContent);
              credential = cert(parsed);
              this.logger.log(`✅ Loaded Firebase service account from candidate: ${candidate} (project: ${parsed.project_id})`);
              break;
            } catch (err: any) {
              this.logger.warn(`Failed reading candidate ${candidate}: ${err.message}`);
            }
          }
        }
      }

      if (!credential && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
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
   * Reinitialize with runtime credentials (e.g. from database or dynamic config)
   */
  public initializeWithCredentials(credentialData: any): boolean {
    try {
      const parsed = typeof credentialData === 'string' ? JSON.parse(credentialData) : credentialData;
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      const credential = cert(parsed);
      this.firebaseApp = initializeApp({ credential });
      this.isInitialized = true;
      this.logger.log(`✅ Firebase Admin SDK dynamically re-initialized for project: ${parsed.project_id || 'quikboom-crm-925d5'}`);
      return true;
    } catch (e: any) {
      this.logger.error(`Failed dynamic Firebase initialization: ${e?.message}`);
      return false;
    }
  }

  /**
   * Check if Firebase Admin is ready to send notifications
   */
  public ready(): boolean {
    return this.isInitialized && this.firebaseApp !== null;
  }

  /**
   * Send push notification directly to a single device token (used for verification & test delivery)
   */
  async sendToSingleToken(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    meta?: FcmContextMeta,
  ): Promise<{ success: boolean; messageId?: string; error?: string; details?: string }> {
    const cleanToken = (token || '').trim();
    const maskedToken =
      cleanToken.length > 12
        ? `${cleanToken.substring(0, 6)}...${cleanToken.substring(cleanToken.length - 4)}`
        : cleanToken || 'EMPTY';

    if (!cleanToken) {
      this.logger.error(
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: EMPTY\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: FAILED (EMPTY_TOKEN)`,
      );
      return { success: false, error: 'EMPTY_TOKEN', details: 'FCM token cannot be empty' };
    }

    if (!this.ready() || !this.firebaseApp) {
      this.logger.error(
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${maskedToken}\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: FAILED (FIREBASE_NOT_INITIALIZED)`,
      );
      return {
        success: false,
        error: 'FIREBASE_NOT_INITIALIZED',
        details: 'Firebase Admin SDK credentials are not configured on backend',
      };
    }

    const stringifiedData: Record<string, string> = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    const message: Message = {
      token: cleanToken,
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
          icon: 'ic_notification',
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: 'public',
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

    const messaging = getMessaging(this.firebaseApp);

    try {
      const messageId = await messaging.send(message);
      this.logger.log(
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${maskedToken}\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: ${messageId}\nsend result: SUCCESS`,
      );
      return { success: true, messageId };
    } catch (err: any) {
      const errorCode = err.code || 'UNKNOWN_ERROR';
      const errorMessage = err.message || String(err);
      this.logger.error(
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${maskedToken}\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: FAILED (${errorCode} - ${errorMessage})`,
      );
      return {
        success: false,
        error: errorCode,
        details: errorMessage,
      };
    }
  }

  /**
   * Send FCM multicast push notification to multiple device tokens
   */
  async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    meta?: FcmContextMeta,
  ): Promise<FcmSendResult> {
    const validTokens = (tokens || []).filter((t) => typeof t === 'string' && t.trim().length > 0);

    if (validTokens.length === 0) {
      this.logger.warn(
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: NONE\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: SKIPPED (NO_VALID_TOKENS)`,
      );
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
        `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${validTokens.length} device(s)\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: FAILED (FIREBASE_NOT_INITIALIZED)`,
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
            icon: 'ic_notification',
            defaultSound: true,
            defaultVibrateTimings: true,
            visibility: 'public',
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
          const token = batchTokens[index];
          const maskedToken =
            token.length > 12
              ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}`
              : token;

          if (resp.success && resp.messageId) {
            messageIds.push(resp.messageId);
            this.logger.log(
              `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${maskedToken}\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: ${resp.messageId}\nsend result: SUCCESS`,
            );
          } else if (resp.error) {
            const errorCode = resp.error.code;
            this.logger.warn(
              `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: ${maskedToken}\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: FAILED (${errorCode} - ${resp.error.message})`,
            );

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
        this.logger.error(
          `[FCM]\ncustomerId: ${meta?.customerId ?? 'N/A'}\ntoken: batch (${batchTokens.length})\nnotificationType: ${meta?.notificationType ?? 'N/A'}\nmessageId: none\nsend result: BATCH_FAILED (${batchError?.message})`,
        );
        failureCount += batchTokens.length;
      }
    }

    return {
      successCount,
      failureCount,
      invalidTokens,
      messageIds,
    };
  }
}
