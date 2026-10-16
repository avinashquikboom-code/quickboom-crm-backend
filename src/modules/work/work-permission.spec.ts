import { Test, TestingModule } from '@nestjs/testing';
import { WorkPermissionService } from './work-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { AccessOverrideType } from '@prisma/client';

describe('WorkPermissionService - Role-Based Module Access & Employee Overrides', () => {
  let service: WorkPermissionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
      },
      designation: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      role: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      roleWorkPermission: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      employeeModuleOverride: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      workAccessRequest: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkPermissionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkPermissionService>(WorkPermissionService);
  });

  it('should list common employee modules', () => {
    const common = service.getCommonModules();
    expect(common.map((m) => m.key)).toEqual([
      'dashboard',
      'attendance',
      'leave',
      'calendar',
      'profile',
    ]);
  });

  describe('Test Case 1: Video Editor default permissions', () => {
    it('returns Video Edit = ON, Leads = OFF, Post Design = OFF, Story Design = OFF, Reel Shoot = OFF', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        employeeCode: 'EMP-002',
        firstName: 'Alex',
        lastName: 'Editor',
        designation: { name: 'Video Editor' },
        user: { role: 'VIDEO_EDITOR' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.role).toBe('Video Editor');
      expect(perms.workPermissions).toContain('video_edit');
      expect(perms.workPermissions).not.toContain('leads');
      expect(perms.workPermissions).not.toContain('post_design');
      expect(perms.workPermissions).not.toContain('story_design');
      expect(perms.workPermissions).not.toContain('reel_shoot');
      expect(perms.effectivePermissions['video_edit']).toBe(true);
      expect(perms.effectivePermissions['leads']).toBe(false);
      expect(perms.commonModules).toContain('dashboard');
    });
  });

  describe('Test Case 2: Graphic Designer default permissions', () => {
    it('returns Post Design = ON, Story Design = ON, Leads = OFF, Video Edit = OFF, Reel Shoot = OFF', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 102,
        employeeCode: 'EMP-003',
        firstName: 'Sara',
        lastName: 'Design',
        designation: { name: 'Graphic Designer' },
        user: { role: 'GRAPHIC_DESIGNER' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 102 });
      expect(perms.role).toBe('Graphic Designer');
      expect(perms.workPermissions).toContain('post_design');
      expect(perms.workPermissions).toContain('story_design');
      expect(perms.workPermissions).not.toContain('leads');
      expect(perms.workPermissions).not.toContain('video_edit');
      expect(perms.workPermissions).not.toContain('reel_shoot');
      expect(perms.effectivePermissions['post_design']).toBe(true);
      expect(perms.effectivePermissions['story_design']).toBe(true);
      expect(perms.effectivePermissions['leads']).toBe(false);
    });
  });

  describe('Test Case 3: Photographer default permissions', () => {
    it('returns Reel Shoot = ON, Leads = OFF, Video Edit = OFF, Post Design = OFF', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 103,
        employeeCode: 'EMP-004',
        firstName: 'Peter',
        lastName: 'Photo',
        designation: { name: 'Photographer' },
        user: { role: 'PHOTOGRAPHER' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 103 });
      expect(perms.role).toBe('Photographer');
      expect(perms.workPermissions).toContain('reel_shoot');
      expect(perms.workPermissions).not.toContain('leads');
      expect(perms.workPermissions).not.toContain('video_edit');
      expect(perms.workPermissions).not.toContain('post_design');
      expect(perms.workPermissions).not.toContain('story_design');
    });
  });

  describe('Test Case 4: Telecaller / Sales default permissions', () => {
    it('returns Leads = ON, Work modules = OFF', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 104,
        employeeCode: 'EMP-005',
        firstName: 'Tom',
        lastName: 'Sales',
        designation: { name: 'Telecaller' },
        user: { role: 'TELECALLER' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 104 });
      expect(perms.role).toBe('Telecaller');
      expect(perms.workPermissions).toContain('leads');
      expect(perms.workPermissions).not.toContain('video_edit');
      expect(perms.workPermissions).not.toContain('post_design');
    });
  });

  describe('Test Case 5: Employee-Specific Overrides (ALLOW and DENY)', () => {
    it('applies ALLOW override to grant Leads access to Graphic Designer', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 102,
        employeeCode: 'EMP-003',
        designation: { name: 'Graphic Designer' },
        employeeModuleOverrides: [
          { moduleKey: 'leads', override: AccessOverrideType.ALLOW },
        ],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 102 });
      expect(perms.workPermissions).toContain('post_design');
      expect(perms.workPermissions).toContain('story_design');
      expect(perms.workPermissions).toContain('leads');
      expect(perms.effectivePermissions['leads']).toBe(true);
    });

    it('applies DENY override to block Post Design for Graphic Designer EMP-002', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 102,
        employeeCode: 'EMP-002',
        designation: { name: 'Graphic Designer' },
        employeeModuleOverrides: [
          { moduleKey: 'post_design', override: AccessOverrideType.DENY },
        ],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 102 });
      expect(perms.workPermissions).not.toContain('post_design');
      expect(perms.workPermissions).toContain('story_design');
      expect(perms.effectivePermissions['post_design']).toBe(false);
      expect(perms.effectivePermissions['story_design']).toBe(true);
    });
  });



  describe('Test Case 8: Multi-tenant Customer Isolation & Security', () => {
    it('strictly isolates permissions by customerId and throws ForbiddenException on unauthorized access', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        designation: { name: 'Video Editor' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      await expect(service.checkPermission(1, 101, 'leads')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.checkPermission(1, 101, 'video_edit')).resolves.toBe(true);
    });
  });


  describe('Activity permission organization context', () => {
    it('derives the organization from the employee when no context is supplied', async () => {
      prisma.employee.findUnique = jest.fn().mockResolvedValue({ customerId: 27 });
      const resolver = jest.spyOn(service, 'getEmployeeEffectivePermissions').mockResolvedValue({
        role: 'Video Editor', workPermissions: ['video_edit'],
      } as any);
      await service.getAllowedActivityTypesForEmployee(101);
      expect(resolver).toHaveBeenCalledWith(27, { employeeId: 101 });
    });

    it('rejects unresolved organization context without evaluating another tenant', async () => {
      prisma.employee.findUnique = jest.fn().mockResolvedValue(null);
      const resolver = jest.spyOn(service, 'getEmployeeEffectivePermissions');
      await expect(service.getAllowedActivityTypesForEmployee(101)).rejects.toThrow(ForbiddenException);
      expect(resolver).not.toHaveBeenCalled();
    });
  });

});
