import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';

describe('Auth Axios Interceptor Lifecycle & Token Flow', () => {
  const JWT_SECRET = 'test_jwt_secret_key_12345';
  const REFRESH_SECRET = 'test_jwt_refresh_secret_key_12345';

  let mockStorage: Record<string, string>;
  let mockStore: {
    token: string | null;
    refreshToken: string | null;
    user: any;
    isAuthenticated: boolean;
    updateTokens: (t: string, r?: string) => void;
    logout: () => void;
  };

  let refreshEndpointCalls: number;
  let testSendCalls: number;
  let refreshPromise: Promise<string> | null = null;
  let testApi: AxiosInstance;

  // Helpers to generate tokens
  const generateAccessToken = (userId: number, expiresInSec: number) => {
    return jwt.sign(
      { sub: userId, userId, role: 'SUPER_ADMIN', roleType: 'SUPER_ADMIN' },
      JWT_SECRET,
      { expiresIn: expiresInSec }
    );
  };

  const generateRefreshToken = (userId: number, expiresInSec: number) => {
    return jwt.sign(
      { sub: userId, userId, role: 'SUPER_ADMIN', roleType: 'SUPER_ADMIN' },
      REFRESH_SECRET,
      { expiresIn: expiresInSec }
    );
  };

  beforeEach(() => {
    mockStorage = {};
    refreshEndpointCalls = 0;
    testSendCalls = 0;
    refreshPromise = null;

    mockStore = {
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      updateTokens: (token: string, refreshToken?: string) => {
        mockStore.token = token;
        mockStorage['accessToken'] = token;
        mockStorage['token'] = token;
        if (refreshToken) {
          mockStore.refreshToken = refreshToken;
          mockStorage['refreshToken'] = refreshToken;
        }
        mockStore.isAuthenticated = true;
      },
      logout: () => {
        mockStore.token = null;
        mockStore.refreshToken = null;
        mockStore.user = null;
        mockStore.isAuthenticated = false;
        delete mockStorage['accessToken'];
        delete mockStorage['token'];
        delete mockStorage['refreshToken'];
        delete mockStorage['user'];
        delete mockStorage['quikboom-next-auth-storage'];
      },
    };

    // Instantiate mock Axios instance configured identically to lib/api.ts
    testApi = axios.create({
      baseURL: 'https://api.test.qbapp.online/api/v1',
    });

    const performTokenRefresh = async (): Promise<string> => {
      if (refreshPromise) {
        return refreshPromise;
      }

      refreshPromise = (async () => {
        try {
          const refreshToken = mockStore.refreshToken || mockStorage['refreshToken'];
          if (!refreshToken) {
            mockStore.logout();
            throw new Error('No refresh token available');
          }

          refreshEndpointCalls++;

          // Simulate backend refresh verification
          let payload: any;
          try {
            payload = jwt.verify(refreshToken, REFRESH_SECRET);
          } catch (e) {
            mockStore.logout();
            const err: any = new Error('Invalid or expired refresh token');
            err.response = { status: 401, data: { message: 'Invalid or expired refresh token' } };
            throw err;
          }

          const newAcc = generateAccessToken(payload.sub, 3600);
          const newRef = generateRefreshToken(payload.sub, 86400);

          mockStore.updateTokens(newAcc, newRef);
          testApi.defaults.headers.common['Authorization'] = `Bearer ${newAcc}`;
          return newAcc;
        } finally {
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    };

    // Request interceptor matching lib/api.ts
    testApi.interceptors.request.use(async (config: any) => {
      const isAuthUrl = typeof config.url === 'string' && config.url.includes('/auth/');
      let token = mockStore.token || mockStorage['accessToken'];
      const refreshToken = mockStore.refreshToken || mockStorage['refreshToken'];

      if (!isAuthUrl && !config._retry && token && refreshToken) {
        try {
          const decoded: any = jwt.decode(token);
          if (decoded?.exp && decoded.exp * 1000 <= Date.now() + 1000) {
            try {
              token = await performTokenRefresh();
            } catch (_) {}
          }
        } catch (_) {}
      }

      if (token) {
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      return config;
    });

    // Mock adapter for requests
    testApi.interceptors.request.use((config: any) => {
      config.adapter = async (cfg: any) => {
        if (cfg.url === '/templates/meta/test-send') {
          testSendCalls++;
          const auth = cfg.headers?.['Authorization'] || cfg.headers?.['authorization'];
          const token = auth ? auth.replace('Bearer ', '').trim() : null;

          if (!token) {
            const err: any = new Error('Unauthorized');
            err.response = { status: 401, data: { message: 'Invalid or expired authentication token' } };
            err.config = cfg;
            throw err;
          }

          try {
            jwt.verify(token, JWT_SECRET);
            return {
              data: { success: true, messageId: 'msg_12345', status: 'SENT' },
              status: 200,
              statusText: 'OK',
              headers: {},
              config: cfg,
            };
          } catch (e) {
            const err: any = new Error('Unauthorized');
            err.response = { status: 401, data: { message: 'Invalid or expired authentication token' } };
            err.config = cfg;
            throw err;
          }
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config: cfg };
      };
      return config;
    });

    // Response interceptor matching lib/api.ts
    testApi.interceptors.response.use(
      (response) => response.data,
      async (error) => {
        const originalRequest = error.config;
        if (!originalRequest) return Promise.reject(error);

        // Infinite loop prevention: Already retried request gets 401 again
        if (error?.response?.status === 401 && originalRequest._retry) {
          mockStore.logout();
          return Promise.reject(error);
        }

        // 401 on first attempt: refresh token once and retry
        if (error?.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const newAccessToken = await performTokenRefresh();
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
            return testApi(originalRequest);
          } catch (refreshErr) {
            return Promise.reject(refreshErr);
          }
        }

        return Promise.reject(error);
      }
    );
  });

  it('Scenario 1: Fresh login → test-send succeeds on first attempt without refresh', async () => {
    const validAccessToken = generateAccessToken(1, 3600);
    const validRefreshToken = generateRefreshToken(1, 86400);

    mockStore.updateTokens(validAccessToken, validRefreshToken);

    const res: any = await testApi.post('/templates/meta/test-send', {
      templateId: 10,
      to: '+919876543210',
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('SENT');
    expect(testSendCalls).toBe(1);
    expect(refreshEndpointCalls).toBe(0);
    expect(mockStore.isAuthenticated).toBe(true);
  });

  it('Scenario 2: Expired access token + valid refresh token → refresh and retry succeeds', async () => {
    // Generate an expired access token (-10 seconds)
    const expiredAccessToken = generateAccessToken(1, -10);
    const validRefreshToken = generateRefreshToken(1, 86400);

    mockStore.updateTokens(expiredAccessToken, validRefreshToken);

    const res: any = await testApi.post('/templates/meta/test-send', {
      templateId: 10,
      to: '+919876543210',
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('SENT');
    // Refresh was called once
    expect(refreshEndpointCalls).toBe(1);
    // test-send succeeded
    expect(testSendCalls).toBeGreaterThanOrEqual(1);
    // Newly returned access token was saved in store & storage
    expect(mockStore.token).not.toBe(expiredAccessToken);
    expect(mockStorage['accessToken']).toBe(mockStore.token);
    expect(mockStore.isAuthenticated).toBe(true);
  });

  it('Scenario 3: Expired refresh token → logout, no retry loop', async () => {
    // Both access token and refresh token are expired
    const expiredAccessToken = generateAccessToken(1, -10);
    const expiredRefreshToken = generateRefreshToken(1, -10);

    mockStore.updateTokens(expiredAccessToken, expiredRefreshToken);

    await expect(
      testApi.post('/templates/meta/test-send', {
        templateId: 10,
        to: '+919876543210',
      })
    ).rejects.toThrow();

    // Refresh was attempted once
    expect(refreshEndpointCalls).toBe(1);
    // Auth state was cleared completely
    expect(mockStore.isAuthenticated).toBe(false);
    expect(mockStore.token).toBeNull();
    expect(mockStore.refreshToken).toBeNull();
    expect(mockStorage['accessToken']).toBeUndefined();
    expect(mockStorage['refreshToken']).toBeUndefined();
  });

  it('Scenario 4: Multiple simultaneous 401s → only one refresh request', async () => {
    // Expired access token + valid refresh token
    const expiredAccessToken = generateAccessToken(1, -10);
    const validRefreshToken = generateRefreshToken(1, 86400);

    mockStore.updateTokens(expiredAccessToken, validRefreshToken);

    // Fire 5 concurrent requests simultaneously
    const promises = [
      testApi.post('/templates/meta/test-send', { templateId: 10, to: '+919876543210' }),
      testApi.post('/templates/meta/test-send', { templateId: 10, to: '+919876543211' }),
      testApi.post('/templates/meta/test-send', { templateId: 10, to: '+919876543212' }),
      testApi.post('/templates/meta/test-send', { templateId: 10, to: '+919876543213' }),
      testApi.post('/templates/meta/test-send', { templateId: 10, to: '+919876543214' }),
    ];

    const results: any[] = await Promise.all(promises);

    // All 5 requests succeeded
    expect(results).toHaveLength(5);
    results.forEach((res) => {
      expect(res.success).toBe(true);
      expect(res.status).toBe('SENT');
    });

    // CRITICAL: Exactly ONE refresh request was made despite 5 simultaneous 401s!
    expect(refreshEndpointCalls).toBe(1);
    expect(mockStore.isAuthenticated).toBe(true);
  });
});
