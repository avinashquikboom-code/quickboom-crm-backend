import { JwtStrategy } from './jwt.strategy';
import * as jwt from 'jsonwebtoken';

describe('access token signing configuration', () => {
  const signingSecret = 'unique-test-access-signing-secret';
  let strategy: JwtStrategy;

  beforeEach(() => {
    const config = { get: (key: string) => key === 'JWT_SECRET' ? signingSecret : undefined };
    strategy = new JwtStrategy(config as any, {} as any);
    jest.spyOn(strategy, 'validate').mockImplementation(async (payload) => ({ id: payload.sub }) as any);
  });

  function authenticate(token?: string): Promise<{ user?: any; info?: any }> {
    return new Promise((resolve, reject) => {
      const passportStrategy = strategy as any;
      passportStrategy.success = (user: any) => resolve({ user });
      passportStrategy.fail = (info: any) => resolve({ info });
      passportStrategy.error = reject;
      passportStrategy.authenticate({ headers: token ? { authorization: `Bearer ${token}` } : {} });
    });
  }

  it('accepts a token signed with JWT_SECRET', async () => {
    const token = jwt.sign({ sub: 1 }, signingSecret, { expiresIn: '1h' });
    expect((await authenticate(token)).user).toEqual({ id: 1 });
  });

  it('rejects missing, expired, and incorrectly signed tokens', async () => {
    const expired = jwt.sign({ sub: 1, exp: Math.floor(Date.now() / 1000) - 10 }, signingSecret);
    const invalid = jwt.sign({ sub: 1 }, 'incorrect-test-secret', { expiresIn: '1h' });
    expect((await authenticate()).user).toBeUndefined();
    expect((await authenticate(expired)).user).toBeUndefined();
    expect((await authenticate(invalid)).user).toBeUndefined();
  });

  it('does not accept tokens signed with built-in development or production fallback keys', async () => {
    const fallbackKeys = [
      'quikboom_super_secret_jwt_access_key_2026',
      'quikboom_jwt_secret_development_key_3847291847',
      'quikboom_production_secure_token_secret_key_3847291847',
    ];

    for (const key of fallbackKeys) {
      const token = jwt.sign({ sub: 1 }, key, { expiresIn: '1h' });
      expect((await authenticate(token)).user).toBeUndefined();
    }
  });

  it('does not allow fallback-key tokens when no access signing secret is configured', async () => {
    const unconfigured = new JwtStrategy({ get: () => undefined } as any, {} as any);
    jest.spyOn(unconfigured, 'validate').mockImplementation(async (payload) => ({ id: payload.sub }) as any);
    const token = jwt.sign({ sub: 1 }, 'quikboom_super_secret_jwt_access_key_2026', { expiresIn: '1h' });

    const result = await new Promise((resolve, reject) => {
      const passportStrategy = unconfigured as any;
      passportStrategy.success = (user: any) => resolve(user);
      passportStrategy.fail = (info: any) => resolve(info);
      passportStrategy.error = reject;
      passportStrategy.authenticate({ headers: { authorization: `Bearer ${token}` } });
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/invalid signature|secret or public key must be provided/i);
  });
});
