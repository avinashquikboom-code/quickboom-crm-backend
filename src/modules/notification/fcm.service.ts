import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService, isMaskedSecret } from '../integration-settings/integration-settings.service';
import { getApps, initializeApp, cert, applicationDefault, App, ServiceAccount, deleteApp } from 'firebase-admin/app';
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

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly integrationSettingsService?: IntegrationSettingsService,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
    // Asynchronously verify dynamic credentials from DB once dependency injection is ready
    setTimeout(() => {
      this.ensureInitialized().catch((err) =>
        this.logger.debug(`[FCM] Background ensureInitialized notice: ${err?.message}`),
      );
    }, 1000);
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
        '';
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
  public async initializeWithCredentials(credentialData: any): Promise<boolean> {
    try {
      // Clean up existing app instance if present
      await this.invalidateFirebaseInstance();

      const parsed = typeof credentialData === 'string' ? JSON.parse(credentialData) : credentialData;
      const projectId = parsed.projectId || parsed.project_id || process.env.FIREBASE_PROJECT_ID || '';
      const clientEmail = parsed.clientEmail || parsed.client_email;
      let privateKey = parsed.privateKey || parsed.private_key;

      if (privateKey && typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      const serviceAccount: ServiceAccount = {
        projectId,
        clientEmail,
        privateKey,
      };

      const credential = cert(serviceAccount);
      this.firebaseApp = initializeApp({ credential });
      this.isInitialized = true;
      this.logger.log(`✅ Firebase Admin SDK dynamically re-initialized for project: ${projectId}`);
      return true;
    } catch (e: any) {
      this.logger.error(`Failed dynamic Firebase initialization: ${e?.message}`);
      return false;
    }
  }

  /**
   * Disconnect and invalidate cached Firebase Admin instance
   */
  public async invalidateFirebaseInstance(): Promise<void> {
    if (this.firebaseApp) {
      try {
        await deleteApp(this.firebaseApp);
        this.logger.log('Firebase Admin SDK instance successfully invalidated.');
      } catch (err: any) {
        this.logger.warn(`Non-fatal: Error deleting Firebase App instance: ${err?.message}`);
      } finally {
        this.firebaseApp = null;
        this.isInitialized = false;
      }
    } else {
      const existingApps = getApps();
      for (const app of existingApps) {
        try {
          await deleteApp(app);
        } catch {
          // ignore
        }
      }
      this.firebaseApp = null;
      this.isInitialized = false;
    }
  }

  /**
   * Ensure Firebase Admin SDK is initialized before dispatching notifications.
   * If not already ready, attempts lazy dynamic initialization from IntegrationSettingsService (DB)
   * or environment variables / filesystem credentials.
   */
  public async ensureInitialized(): Promise<boolean> {
    if (this.ready()) {
      return true;
    }

    const existingApps = getApps();
    if (existingApps.length > 0) {
      this.firebaseApp = existingApps[0];
      this.isInitialized = true;
      return true;
    }

    // 1. Attempt loading dynamic credentials from IntegrationSettingsService (PostgreSQL)
    if (this.integrationSettingsService) {
      try {
        const fbConfig = await this.integrationSettingsService.getFirebaseConfig();
        const projectId = fbConfig.projectId || process.env.FIREBASE_PROJECT_ID || '';
        const clientEmail = fbConfig.clientEmail;
        const privateKey = fbConfig.privateKey;

        if (clientEmail && privateKey && !isMaskedSecret(privateKey)) {
          const success = await this.initializeWithCredentials({
            projectId,
            clientEmail,
            privateKey,
          });
          if (success) {
            this.logger.log(`[FCM] Firebase Admin SDK dynamically initialized from Integration Settings (project: ${projectId})`);
            return true;
          }
        }
      } catch (err: any) {
        this.logger.warn(`[FCM] Dynamic initialization from integration settings notice: ${err?.message}`);
      }
    }

    // 2. Fall back to environment / filesystem credentials
    this.initializeFirebase();
    return this.ready();
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
      this.logger.warn(`[FCM] No active device tokens found for customer ${meta?.customerId ?? 'N/A'}`);
      return { success: false, error: 'EMPTY_TOKEN', details: 'FCM token cannot be empty' };
    }

    // Ensure Firebase is initialized dynamically before checking readiness
    await this.ensureInitialized();

    try {
      if (this.integrationSettingsService) {
        const fbConfig = await this.integrationSettingsService.getFirebaseConfig();
        if (!fbConfig.isEnabled) {
          this.logger.log(
            '[FCM] Push notification skipped: Firebase integration is disabled in Admin Settings',
          );
          return { success: false, error: 'FIREBASE_DISABLED', details: 'FCM push delivery is disabled in Admin Panel' };
        }
      }
    } catch (_) {}

    if (!this.ready() || !this.firebaseApp) {
      this.logger.error(
        `[FCM] Send failed:\nFIREBASE_NOT_INITIALIZED - Firebase Admin SDK credentials are not configured on backend (customerId: ${meta?.customerId ?? 'N/A'}, token: ${maskedToken})`,
      );
      return {
        success: false,
        error: 'FIREBASE_NOT_INITIALIZED',
        details: 'Firebase Admin SDK credentials are not configured on backend',
      };
    }

    this.logger.log('[FCM] Firebase Admin initialized');
    this.logger.log('[FCM] Sending push');
    this.logger.log('[FCM] Sending notification');

    const stringifiedData: Record<string, string> = {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };
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
          channelId: 'quikboom_notifications',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          icon: 'ic_notification',
          color: '#23C45E',
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
      webpush: {
        headers: {
          Urgency: 'high',
        },
        notification: {
          title,
          body,
          icon: '/logo.png',
          badge: '/favicon.ico',
          requireInteraction: true,
        },
        fcmOptions: {
          link: data?.route || '/notifications',
        },
      },
    };

    const messaging = getMessaging(this.firebaseApp);

    try {
      const messageId = await messaging.send(message);
      this.logger.log('[FCM] Send response received');
      this.logger.log('[FCM] Push sent successfully');
      this.logger.log(`[FCM] Sent successfully:\n${messageId}`);
      return { success: true, messageId };
    } catch (err: any) {
      const errorCode = err.code || 'UNKNOWN_ERROR';
      const errorMessage = err.message || String(err);
      this.logger.error(`[FCM] Send failed:\n${errorCode} - ${errorMessage}`);
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
      this.logger.warn(`[FCM] No active device tokens found for customer ${meta?.customerId ?? 'N/A'}`);
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        messageIds: [],
      };
    }

    // Ensure Firebase is initialized dynamically before checking readiness
    await this.ensureInitialized();

    // Stringify all values in data payload for Firebase compliance
    const stringifiedData: Record<string, string> = {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    try {
      if (this.integrationSettingsService) {
        const fbConfig = await this.integrationSettingsService.getFirebaseConfig();
        if (!fbConfig.isEnabled) {
          this.logger.log(
            '[FCM] Push notification skipped: Firebase integration is disabled in Admin Settings',
          );
          return {
            successCount: 0,
            failureCount: 0,
            invalidTokens: [],
            messageIds: [],
          };
        }
      }
    } catch (_) {}

    if (!this.ready() || !this.firebaseApp) {
      this.logger.error(
        `[FCM] Send failed:\nFIREBASE_NOT_INITIALIZED - Firebase Admin SDK credentials are not configured on backend (customerId: ${meta?.customerId ?? 'N/A'})`,
      );
      return {
        successCount: 0,
        failureCount: validTokens.length,
        invalidTokens: [],
        messageIds: [],
      };
    }

    this.logger.log('[FCM] Firebase Admin initialized');
    this.logger.log('[FCM] Sending push');
    this.logger.log('[FCM] Sending notification');

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
            channelId: 'quikboom_notifications',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            icon: 'ic_notification',
            color: '#23C45E',
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
        webpush: {
          headers: {
            Urgency: 'high',
          },
          notification: {
            title,
            body,
            icon: '/logo.png',
            badge: '/favicon.ico',
            requireInteraction: true,
          },
          fcmOptions: {
            link: data?.route || '/notifications',
          },
        },
      };

      try {
        const response: BatchResponse = await messaging.sendEachForMulticast(message);
        this.logger.log('[FCM] Send response received');
        if (response.successCount > 0) {
          this.logger.log('[FCM] Push sent successfully');
        }
        successCount += response.successCount;
        failureCount += response.failureCount;

        response.responses.forEach((resp, index) => {
          const token = batchTokens[index];
          if (resp.success && resp.messageId) {
            messageIds.push(resp.messageId);
            this.logger.log(`[FCM] Sent successfully:\n${resp.messageId}`);
          } else if (resp.error) {
            const errorCode = resp.error.code;
            this.logger.error(`[FCM] Send failed:\n${errorCode} - ${resp.error.message}`);

            // Detect unregistered / expired / invalid tokens for cleanup
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/mismatched-credential' ||
              errorCode === 'messaging/invalid-argument'
            ) {
              invalidTokens.push(token);
            }
          }
        });
      } catch (batchError: any) {
        this.logger.error(
          `[FCM] Send failed:\nBATCH_FAILED - ${batchError?.message} (batch of ${batchTokens.length} tokens)`,
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
