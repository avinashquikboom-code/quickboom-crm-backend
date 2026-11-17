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
});
