import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

describe('Leads API Authentication & Token Flow', () => {
  let jwtStrategy: JwtStrategy;
  let mockConfigService: any;
  let mockPrisma: any;
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  const DEV_SECRET = 'quikboom_jwt_secret_development_key_3847291847';
  const PROD_SECRET = 'quikboom_super_secret_jwt_access_key_2026';

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return DEV_SECRET;
        return null;
      }),
    };

    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
      },
    };

    jwtStrategy = new JwtStrategy(mockConfigService, mockPrisma);
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('1. Token Extraction & Sanitization', () => {
    it('successfully validates a clean Bearer token payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'superadmin@quickboom.com',
        isActive: true,
        deletedAt: null,
        userRoles: [
          { role: { name: 'SUPER_ADMIN', type: 'SUPER_ADMIN', rolePermissions: [] } },
        ],
      });

      const user = await jwtStrategy.validate({ sub: 1, email: 'superadmin@quickboom.com', role: 'SUPER_ADMIN' });
      expect(user).toBeDefined();
      expect(user.id).toBe(1);
      expect(user.role).toBe('SUPER_ADMIN');
    });

    it('rejects payload with missing or invalid subject', async () => {
      await expect(jwtStrategy.validate({ email: 'test@crm.com' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects inactive or deleted user account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'inactive@crm.com',
        isActive: false,
        deletedAt: null,
      });

      await expect(jwtStrategy.validate({ sub: 2 })).rejects.toThrow(
        'User account is inactive or no longer exists.',
      );
    });
  });

  describe('2. Secret Verification Across Environments', () => {
    it('verifies tokens signed with DEV_SECRET', () => {
      const token = jwt.sign({ sub: 1, email: 'admin@quickboom.com' }, DEV_SECRET, { expiresIn: '1h' });
      const decoded: any = jwt.verify(token, DEV_SECRET);
      expect(decoded.sub).toBe(1);
    });

    it('verifies tokens signed with PROD_SECRET', () => {
      const token = jwt.sign({ sub: 1, email: 'admin@quickboom.com' }, PROD_SECRET, { expiresIn: '1h' });
      const decoded: any = jwt.verify(token, PROD_SECRET);
      expect(decoded.sub).toBe(1);
    });

    it('detects and throws TokenExpiredError on expired tokens', () => {
      const expiredToken = jwt.sign({ sub: 1 }, DEV_SECRET, { expiresIn: '-10s' });
      expect(() => {
        jwt.verify(expiredToken, DEV_SECRET);
      }).toThrow('jwt expired');
    });
  });

  describe('3. JwtAuthGuard Behavior for Leads Endpoint', () => {
    it('throws UnauthorizedException("Invalid or expired authentication token") on missing user or expired token', () => {
      expect(() => {
        guard.handleRequest(null, null, { message: 'jwt expired' }, undefined as any);
      }).toThrow(new UnauthorizedException('Invalid or expired authentication token'));
    });

    it('throws UnauthorizedException when no Authorization header was provided', () => {
      expect(() => {
        guard.handleRequest(null, null, { message: 'No auth token' }, undefined as any);
      }).toThrow(new UnauthorizedException('Invalid or expired authentication token'));
    });

    it('returns authenticated user on valid authentication', () => {
      const mockUser = { id: 1, email: 'admin@quickboom.com', role: 'SUPER_ADMIN' };
      const result = guard.handleRequest(null, mockUser, null, undefined as any);
      expect(result).toEqual(mockUser);
    });
  });
});
