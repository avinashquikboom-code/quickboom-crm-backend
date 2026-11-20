import { AuthService } from './auth.service';
import * as crypto from 'crypto';

describe('AuthService.logout', () => {
  it('revokes the supplied refresh token and records a hash of a verified access token', async () => {
    const accessToken = 'signed-access-token';
    const marker = `qb-revoked-access:${crypto.createHash('sha256').update(accessToken).digest('hex')}`;
    const prisma = {
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      session: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
      },
    };
    const service = Object.create(AuthService.prototype) as any;
    service.prisma = prisma;
    service.jwtService = { verify: jest.fn().mockReturnValue({ sub: 42 }) };
    service.configService = { get: jest.fn((key: string) => key === 'JWT_SECRET' ? 'test-secret' : undefined) };

    const result = await service.logout('refresh-token', accessToken);

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'refresh-token', isRevoked: false },
      data: { isRevoked: true },
    });
    expect(prisma.session.create).toHaveBeenCalledWith({ data: { userId: 42, device: marker } });
    expect(result).toMatchObject({ success: true, revokedRefreshTokens: 1, revokedAccessToken: true });
    expect(JSON.stringify(prisma.session.create.mock.calls)).not.toContain(accessToken);
  });
});
