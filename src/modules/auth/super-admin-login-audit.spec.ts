import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { RoleType } from '@prisma/client';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('Super Admin Login and Authentication Audit', () => {
  let authService: AuthService;
  let prisma: any;
  let jwtService: any;

  const validPassword = 'AdminPassword123!';
  const hashedPassword = bcrypt.hashSync(validPassword, 10);

  const mockSuperAdminRole = {
    id: 1,
    name: 'Super Administrator',
    type: RoleType.SUPER_ADMIN,
    description: 'Full administrative access',
  };

  const createMockAdminUser = (overrides = {}) => ({
    id: 1,
    email: 'admin@quikboom.com',
    phone: '+1-555-0100',
    firstName: 'Super',
    lastName: 'Admin',
    passwordHash: hashedPassword,
    isActive: true,
    isVerified: true,
    deletedAt: null,
    customerId: null,
    customer: null,
    employee: null,
    userRoles: [
      {
        id: 1,
        userId: 1,
        roleId: 1,
        role: mockSuperAdminRole,
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(mockSuperAdminRole),
        create: jest.fn().mockResolvedValue(mockSuperAdminRole),
        update: jest.fn().mockResolvedValue(mockSuperAdminRole),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userRole: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        upsert: jest.fn().mockResolvedValue({ id: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      employee: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 1, token: 'mock-refresh-token' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn().mockReturnValue({ sub: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test-access-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
              return null;
            }),
          },
        },
        {
          provide: QBIdGenerator,
          useValue: {
            generateQBUserId: jest.fn(() => 'QB-SUPER-001'),
          },
        },
        {
          provide: Msg91Service,
          useValue: {
            normalizeMobile: jest.fn((m) => m),
            extract10DigitMobile: jest.fn((m) => m),
            maskMobile: jest.fn((m) => m),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test Scenario 1: Existing Super Admin login
  it('1. Existing Super Admin login succeeds with canonical email and password', async () => {
    const mockUser = createMockAdminUser();
    prisma.user.findFirst.mockResolvedValue(mockUser);

    const result = await authService.login(
      { email: 'admin@quikboom.com', password: validPassword },
      'ADMIN',
    );

    expect(result.success).toBe(true);
    expect(result.user.role).toBe('SUPER_ADMIN');
    expect(result.tokens.accessToken).toBe('mock-jwt-token');
    expect(result.tokens.refreshToken).toBe('mock-jwt-token');
  });

  // Test Scenario 2: Incorrect password
  it('2. Incorrect password returns Invalid credentials', async () => {
    const mockUser = createMockAdminUser();
    prisma.user.findFirst.mockResolvedValue(mockUser);

    await expect(
      authService.login(
        { email: 'admin@quikboom.com', password: 'WrongPassword999!' },
        'ADMIN',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  // Test Scenario 3: Unknown email
  it('3. Unknown email returns Invalid credentials', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      authService.login(
        { email: 'nonexistent@quikboom.com', password: validPassword },
        'ADMIN',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  // Test Scenario 4: Case-insensitive email handling & domain alias support
  it('4. Case-insensitive email handling and domain alias (@quickboom.com <-> @quikboom.com)', async () => {
    const mockUser = createMockAdminUser({ email: 'admin@quikboom.com' });
    prisma.user.findFirst.mockResolvedValue(mockUser);

    // Uppercase canonical
    const upperResult = await authService.login(
      { email: 'ADMIN@QUIKBOOM.COM', password: validPassword },
      'ADMIN',
    );
    expect(upperResult.success).toBe(true);
    expect(upperResult.user.role).toBe('SUPER_ADMIN');

    // Domain alias spelling with 'c'
    const aliasResult = await authService.login(
      { email: 'Admin@QuickBoom.com', password: validPassword },
      'ADMIN',
    );
    expect(aliasResult.success).toBe(true);
    expect(aliasResult.user.role).toBe('SUPER_ADMIN');

    // Verify lookup variants included both forms
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { email: { equals: 'admin@quickboom.com', mode: 'insensitive' } },
            { email: { equals: 'admin@quikboom.com', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  // Test Scenario 5: Inactive account
  it('5. Inactive administrator account throws deactivated error', async () => {
    const mockUser = createMockAdminUser({ isActive: false });
    prisma.user.findFirst.mockResolvedValue(mockUser);

    await expect(
      authService.login(
        { email: 'admin@quikboom.com', password: validPassword },
        'ADMIN',
      ),
    ).rejects.toThrow('Your account has been deactivated');
  });

  // Test Scenario 6: Locked / soft-deleted account
  it('6. Locked / soft-deleted account throws Invalid credentials', async () => {
    const mockUser = createMockAdminUser({ deletedAt: new Date() });
    prisma.user.findFirst.mockResolvedValue(mockUser);

    await expect(
      authService.login(
        { email: 'admin@quikboom.com', password: validPassword },
        'ADMIN',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  // Test Scenario 7: Correct password hash verification
  it('7. Correct password hash verification with bcrypt (including leading/trailing whitespace tolerance)', async () => {
    const mockUser = createMockAdminUser();
    prisma.user.findFirst.mockResolvedValue(mockUser);

    // Exact match
    const exact = await authService.login(
      { email: 'admin@quikboom.com', password: validPassword },
      'ADMIN',
    );
    expect(exact.success).toBe(true);

    // Trimmed match if spaces accidentally passed in password
    const withWhitespace = await authService.login(
      { email: 'admin@quikboom.com', password: ` ${validPassword} ` },
      'ADMIN',
    );
    expect(withWhitespace.success).toBe(true);
  });

  // Test Scenario 8: Role resilience & auto-healing
  it('8. Auto-heals Super Admin role when user 1 role association is missing', async () => {
    const mockUserWithoutRoles = createMockAdminUser({ userRoles: [] });
    prisma.user.findFirst.mockResolvedValue(mockUserWithoutRoles);

    const result = await authService.login(
      { email: 'admin@quikboom.com', password: validPassword },
      'ADMIN',
    );

    expect(result.success).toBe(true);
    expect(result.user.role).toBe('SUPER_ADMIN');
    expect(prisma.userRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_roleId: {
            userId: 1,
            roleId: 1,
          },
        },
      }),
    );
  });

  // Test Scenario 9: JWT / session creation
  it('9. Generates JWT access and refresh tokens and records RefreshToken in database', async () => {
    const mockUser = createMockAdminUser();
    prisma.user.findFirst.mockResolvedValue(mockUser);

    const result = await authService.login(
      { email: 'admin@quikboom.com', password: validPassword },
      'ADMIN',
    );

    expect(jwtService.sign).toHaveBeenCalledTimes(2);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          token: 'mock-jwt-token',
        }),
      }),
    );
    expect(result.tokens).toBeDefined();
    expect(result.tokens.accessToken).toBe('mock-jwt-token');
    expect(result.tokens.refreshToken).toBe('mock-jwt-token');
  });

  // Test Scenario 10: Super Admin permissions and recovery utility
  it('10. Super Admin permissions are fully resolved and recovery utility safely restores access', async () => {
    const mockUser = createMockAdminUser();
    prisma.user.findFirst.mockResolvedValue(mockUser);

    const result = await authService.login(
      { email: 'admin@quikboom.com', password: validPassword },
      'SUPER_ADMIN',
    );

    expect(result.user.role).toBe('SUPER_ADMIN');
    expect(result.user.permissions).toBeDefined();

    // Verify secure recovery method
    const recoveryResult = await authService.recoverSuperAdminPassword('NewSuperPassword123!', 1);
    expect(recoveryResult.success).toBe(true);
    expect(recoveryResult.role).toBe('SUPER_ADMIN');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, isRevoked: false },
      data: { isRevoked: true },
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 1 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          action: 'PASSWORD_RESET',
          userRole: 'SUPER_ADMIN',
          status: 'SUCCESS',
        }),
      }),
    );
  });
});
