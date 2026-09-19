import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService, redactSensitiveData } from './audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      auditLog: {
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...args.data })),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            userId: 10,
            userName: 'Tirthraj Solanki',
            userRole: 'EMPLOYEE',
            source: 'MOBILE_APP',
            action: 'SUBMIT',
            module: 'Leave',
            description: 'Submitted new Leave application',
            entityType: 'Leave',
            entityId: '42',
            endpoint: '/api/v1/leaves',
            method: 'POST',
            ipAddress: '192.168.1.5',
            device: 'Mobile App',
            status: 'SUCCESS',
            details: { reason: 'Family function' },
            createdAt: new Date(),
            user: { id: 10, firstName: 'Tirthraj', lastName: 'Solanki', email: 'tirth@qb.com' },
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          userId: 10,
          userName: 'Tirthraj Solanki',
          userRole: 'EMPLOYEE',
          source: 'MOBILE_APP',
          action: 'SUBMIT',
          module: 'Leave',
          description: 'Submitted new Leave application',
          createdAt: new Date(),
        }),
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockResolvedValue([{ module: 'Leave', _count: { id: 1 } }]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  describe('Sensitive data redaction', () => {
    it('should redact sensitive keys recursively', () => {
      const payload = {
        name: 'Rohan',
        password: 'SuperSecretPassword!123',
        nested: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          apiKey: 'key_1234567890',
          cleanField: 'allowedValue',
        },
        otp: '123456',
      };

      const redacted = redactSensitiveData(payload);
      expect(redacted.name).toBe('Rohan');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.nested.token).toBe('[REDACTED]');
      expect(redacted.nested.apiKey).toBe('[REDACTED]');
      expect(redacted.nested.cleanField).toBe('allowedValue');
      expect(redacted.otp).toBe('[REDACTED]');
    });
  });

  describe('create', () => {
    it('should save audit log with sanitized details and correct source/role', async () => {
      await service.create({
        userId: 5,
        userName: 'Admin User',
        userRole: 'SUPER_ADMIN',
        source: 'ADMIN_PANEL',
        action: 'UPDATE',
        module: 'Settings',
        description: 'Updated SMTP configuration',
        endpoint: '/api/v1/admin/settings/integrations/SMTP',
        method: 'PUT',
        status: 'SUCCESS',
        details: { host: 'smtp.gmail.com', password: 'secretpassword' },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(createArg.data.userId).toBe(5);
      expect(createArg.data.source).toBe('ADMIN_PANEL');
      expect(createArg.data.userRole).toBe('SUPER_ADMIN');
      expect(createArg.data.action).toBe('UPDATE');
      expect(createArg.data.details.password).toBe('[REDACTED]');
      expect(createArg.data.details.host).toBe('smtp.gmail.com');
    });
  });

  describe('findAll', () => {
    it('should query real data with pagination and filters', async () => {
      const result = await service.findAll({
        source: 'MOBILE_APP',
        role: 'EMPLOYEE',
        page: 1,
        limit: 20,
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].source).toBe('MOBILE_APP');
      expect(result.items[0].role).toBe('EMPLOYEE');
      expect(result.pagination.total).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return aggregated log metrics', async () => {
      const stats = await service.getStats();
      expect(stats.total).toBe(1);
      expect(Array.isArray(stats.modules)).toBe(true);
    });
  });
});
