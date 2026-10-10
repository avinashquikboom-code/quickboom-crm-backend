import { Test, TestingModule } from '@nestjs/testing';
import { WorkPermissionService, STANDARD_WORK_MODULES, COMMON_MODULES } from './work-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkAccessRequestStatus, AccessOverrideType } from '@prisma/client';

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

  it('should list all standard role-specific modules', () => {
    const modules = service.getWorkModules();
    expect(modules.map((m) => m.key)).toEqual([
      'leads',
      'data_capture',
      'video_edit',
      'post_design',
      'story_design',
      'reel_shoot',
      'reel_post',
      'story_post',
      'influencer_promo',
    ]);
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

  describe('Test Case 6: Admin Role Permissions Update', () => {
    it('allows Admin to enable Leads for Video Editor and reflects in effective permissions', async () => {
      prisma.roleWorkPermission.upsert.mockResolvedValue({});
      await service.updateRoleWorkPermissions(1, 'Video Editor', {
        leads: true,
        video_edit: true,
        post_design: false,
        story_design: false,
        reel_shoot: false,
      });

      expect(prisma.roleWorkPermission.upsert).toHaveBeenCalledTimes(5);

      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        employeeCode: 'EMP-002',
        designation: { name: 'Video Editor' },
        employeeModuleOverrides: [],
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([
        { customerId: 1, roleName: 'Video Editor', workModule: 'leads', isEnabled: true },
        { customerId: 1, roleName: 'Video Editor', workModule: 'video_edit', isEnabled: true },
        { customerId: 1, roleName: 'Video Editor', workModule: 'post_design', isEnabled: false },
        { customerId: 1, roleName: 'Video Editor', workModule: 'story_design', isEnabled: false },
        { customerId: 1, roleName: 'Video Editor', workModule: 'reel_shoot', isEnabled: false },
      ]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.workPermissions).toContain('video_edit');
      expect(perms.workPermissions).toContain('leads');
      expect(perms.effectivePermissions['leads']).toBe(true);
    });
  });

  describe('Test Case 7: Access Request Flow & Rejection', () => {
    it('creates access request and rejects correctly', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 101, customerId: 1 });
      prisma.workAccessRequest.findFirst.mockResolvedValue(null);
      prisma.workAccessRequest.create.mockResolvedValue({
        id: 501,
        customerId: 1,
        employeeId: 101,
        workModule: 'post_design',
        status: WorkAccessRequestStatus.PENDING,
      });

      const request = await service.createAccessRequest(1, 101, 'post_design', 'Campaign need');
      expect(request.status).toBe(WorkAccessRequestStatus.PENDING);

      prisma.workAccessRequest.findFirst.mockResolvedValue({
        id: 501,
        customerId: 1,
        workModule: 'post_design',
      });
      prisma.workAccessRequest.update.mockResolvedValue({
        id: 501,
        status: WorkAccessRequestStatus.REJECTED,
      });

      const rejection = await service.rejectAccessRequest(1, 501, 'Denied by admin');
      expect(rejection.success).toBe(true);
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

  describe('Test Case 9: Dynamic Role Work Permissions from Database Designations', () => {
    it('returns newly added designations with calculated active and total employee counts', async () => {
      prisma.designation.findMany.mockResolvedValue([
        {
          id: 10,
          name: 'Flutter Developer',
          code: 'FLUT',
          employees: [
            { id: 1, status: 'ACTIVE' },
            { id: 2, status: 'ACTIVE' },
            { id: 3, status: 'INACTIVE' },
          ],
        },
        {
          id: 11,
          name: 'HR Executive',
          code: 'HREX',
          employees: [{ id: 4, status: 'ACTIVE' }],
        },
      ]);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);

      const res = await service.getRoleWorkPermissions(1);
      expect(res.roles).toHaveLength(2);

      const flutterDev = res.roles.find((r) => r.roleName === 'Flutter Developer');
      expect(flutterDev).toBeDefined();
      expect(flutterDev.id).toBe('10');
      expect(flutterDev.roleId).toBe('10');
      expect(flutterDev.activeEmployeesCount).toBe(2);
      expect(flutterDev.totalEmployeesCount).toBe(3);

      const hrExec = res.roles.find((r) => r.roleName === 'HR Executive');
      expect(hrExec).toBeDefined();
      expect(hrExec.id).toBe('11');
      expect(hrExec.activeEmployeesCount).toBe(1);
      expect(hrExec.totalEmployeesCount).toBe(1);
    });

    it('filters out inactive designations through isActive: true query', async () => {
      prisma.designation.findMany.mockImplementation(async (args: any) => {
        expect(args.where.isActive).toBe(true);
        return [{ id: 10, name: 'Active Dev', code: 'ACT', employees: [] }];
      });
      prisma.role.findMany.mockResolvedValue([]);
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);

      const res = await service.getRoleWorkPermissions(1);
      expect(res.roles).toHaveLength(1);
      expect(res.roles[0].roleName).toBe('Active Dev');
    });
  });

  describe('Test Case 10: ID-based Role Work Permissions Update', () => {
    it('resolves designation by numeric ID and updates permissions correctly', async () => {
      prisma.designation.findFirst.mockResolvedValue({
        id: 10,
        name: 'Flutter Developer',
      });
      prisma.roleWorkPermission.upsert.mockResolvedValue({
        id: 1,
        customerId: 1,
        roleName: 'Flutter Developer',
        workModule: 'leads',
        isEnabled: true,
      });

      const updateRes = await service.updateRoleWorkPermissions(1, '10', { leads: true });
      expect(updateRes.success).toBe(true);
      expect(updateRes.roleName).toBe('Flutter Developer');
      expect(prisma.roleWorkPermission.upsert).toHaveBeenCalled();
    });
  });
});
