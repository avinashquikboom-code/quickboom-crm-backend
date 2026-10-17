import { JwtStrategy } from './jwt.strategy';
import * as jwt from 'jsonwebtoken';

// Exercise Passport verification, including signature and expiry, before DB validation.
describe('JWT signing contract', () => {
  const secret = 'test-configured-access-key';
  let strategy: any;
  let prisma: any;
  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 1, accountType: 'SUPER_ADMIN', isActive: true }) } };
    strategy = new JwtStrategy({ get: () => secret } as any, prisma);
  });
  function authenticate(token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      strategy.success = resolve;
      strategy.fail = reject;
      strategy.error = reject;
      strategy.authenticate({ headers: { authorization: `Bearer ${token}` } });
    });
  }
  it('accepts an access token signed with the configured login key', async () => {
    await expect(authenticate(jwt.sign({ sub: 1 }, secret, { expiresIn: '1h' }))).resolves.toMatchObject({ id: 1 });
  });
  it.each(['wrong-key', 'quikboom_jwt_secret_development_key_3847291847', 'test-refresh-key'])('rejects another signing key: %s', async key => {
    await expect(authenticate(jwt.sign({ sub: 1 }, key))).rejects.toBeDefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('rejects an expired token before database validation', async () => {
    await expect(authenticate(jwt.sign({ sub: 1 }, secret, { expiresIn: -1 }))).rejects.toBeDefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
