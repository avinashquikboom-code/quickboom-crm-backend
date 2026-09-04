import { Test, TestingModule } from '@nestjs/testing';
import { WorkPermissionService, STANDARD_WORK_MODULES } from './work-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkAccessRequestStatus } from '@prisma/client';

describe('WorkPermissionService - Role-Based Work Module Access', () => {
  let service: WorkPermissionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      designation: {
        findMany: jest.fn(),
      },
      role: {
        findMany: jest.fn(),
      },
      roleWorkPermission: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
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

  it('should list all 4 standard work modules', () => {
    const modules = service.getWorkModules();
    expect(modules.map((m) => m.key)).toEqual([
      'video_edit',
      'post_design',
      'story_design',
      'reel_shoot',
    ]);
  });

  describe('Test Case 1: Video Editor default permissions', () => {
    it('returns Video Edit = ON, others = OFF by default', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        employeeCode: 'EMP-002',
        firstName: 'Alex',
        lastName: 'Editor',
        designation: { name: 'Video Editor' },
        user: { role: 'VIDEO_EDITOR' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.role).toBe('Video Editor');
      expect(perms.workPermissions).toContain('video_edit');
      expect(perms.workPermissions).not.toContain('post_design');
      expect(perms.workPermissions).not.toContain('story_design');
      expect(perms.workPermissions).not.toContain('reel_shoot');
    });
  });

  describe('Test Case 2: Graphic Designer default permissions', () => {
    it('returns Post Design = ON, Story Design = ON, others = OFF by default', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 102,
        employeeCode: 'EMP-003',
        firstName: 'Sara',
        lastName: 'Design',
        designation: { name: 'Graphic Designer' },
        user: { role: 'GRAPHIC_DESIGNER' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 102 });
      expect(perms.role).toBe('Graphic Designer');
      expect(perms.workPermissions).toContain('post_design');
      expect(perms.workPermissions).toContain('story_design');
      expect(perms.workPermissions).not.toContain('video_edit');
      expect(perms.workPermissions).not.toContain('reel_shoot');
    });
  });

  describe('Test Case 3: Photographer default permissions', () => {
    it('returns Reel Shoot = ON, others = OFF by default', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 103,
        employeeCode: 'EMP-004',
        firstName: 'Peter',
        lastName: 'Photo',
        designation: { name: 'Photographer' },
        user: { role: 'PHOTOGRAPHER' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 103 });
      expect(perms.role).toBe('Photographer');
      expect(perms.workPermissions).toContain('reel_shoot');
      expect(perms.workPermissions).not.toContain('video_edit');
      expect(perms.workPermissions).not.toContain('post_design');
      expect(perms.workPermissions).not.toContain('story_design');
    });
  });

  describe('Test Case 4: Admin Override for Role Permissions', () => {
    it('allows Admin to enable Post Design for Video Editor and reflects in effective permissions', async () => {
      // 1. Admin saves override: Video Editor -> video_edit = true, post_design = true
      prisma.roleWorkPermission.upsert.mockResolvedValue({});
      await service.updateRoleWorkPermissions(1, 'Video Editor', {
        video_edit: true,
        post_design: true,
        story_design: false,
        reel_shoot: false,
      });

      expect(prisma.roleWorkPermission.upsert).toHaveBeenCalledTimes(4);

      // 2. Fetch employee permissions after override
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        employeeCode: 'EMP-002',
        designation: { name: 'Video Editor' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([
        { customerId: 1, roleName: 'Video Editor', workModule: 'video_edit', isEnabled: true },
        { customerId: 1, roleName: 'Video Editor', workModule: 'post_design', isEnabled: true },
        { customerId: 1, roleName: 'Video Editor', workModule: 'story_design', isEnabled: false },
        { customerId: 1, roleName: 'Video Editor', workModule: 'reel_shoot', isEnabled: false },
      ]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.workPermissions).toContain('video_edit');
      expect(perms.workPermissions).toContain('post_design');
      expect(perms.workPermissions).not.toContain('reel_shoot');
    });
  });

  describe('Test Case 5: Employee Access Request & Admin Approval Flow', () => {
    it('allows employee to submit access request and becomes effective after approval', async () => {
      // 1. Employee creates access request for post_design
      prisma.employee.findFirst.mockResolvedValue({ id: 101, customerId: 1 });
      prisma.workAccessRequest.findFirst.mockResolvedValue(null);
      prisma.workAccessRequest.create.mockResolvedValue({
        id: 501,
        customerId: 1,
        employeeId: 101,
        workModule: 'post_design',
        status: WorkAccessRequestStatus.PENDING,
        reason: 'Need for client campaign',
      });

      const request = await service.createAccessRequest(1, 101, 'post_design', 'Need for client campaign');
      expect(request.status).toBe(WorkAccessRequestStatus.PENDING);
      expect(request.workModule).toBe('post_design');

      // 2. Admin approves the request
      prisma.workAccessRequest.findFirst.mockResolvedValue({
        id: 501,
        customerId: 1,
        employeeId: 101,
        workModule: 'post_design',
      });
      prisma.workAccessRequest.update.mockResolvedValue({
        id: 501,
        status: WorkAccessRequestStatus.APPROVED,
      });

      const approval = await service.approveAccessRequest(1, 501, 999);
      expect(approval.success).toBe(true);
      expect(approval.request.status).toBe(WorkAccessRequestStatus.APPROVED);

      // 3. Employee effective permissions include post_design via approved request
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        employeeCode: 'EMP-002',
        designation: { name: 'Video Editor' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([{ workModule: 'post_design' }]);

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.workPermissions).toContain('video_edit');
      expect(perms.workPermissions).toContain('post_design');
    });
  });

  describe('Test Case 6: Access Request Rejection', () => {
    it('sets status to REJECTED and leaves module inaccessible', async () => {
      prisma.workAccessRequest.findFirst.mockResolvedValue({
        id: 502,
        customerId: 1,
        employeeId: 101,
        workModule: 'reel_shoot',
      });
      prisma.workAccessRequest.update.mockResolvedValue({
        id: 502,
        status: WorkAccessRequestStatus.REJECTED,
        rejectionReason: 'Camera gear not available for this role.',
      });

      const rejection = await service.rejectAccessRequest(
        1,
        502,
        'Camera gear not available for this role.',
        999,
      );
      expect(rejection.success).toBe(true);
      expect(rejection.request.status).toBe(WorkAccessRequestStatus.REJECTED);

      // Check effective permissions -> reel_shoot is NOT included
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        designation: { name: 'Video Editor' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]); // No approved requests

      const perms = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(perms.workPermissions).not.toContain('reel_shoot');
    });
  });

  describe('Test Case 7: Backend Security & 403 Forbidden', () => {
    it('throws ForbiddenException when employee attempts unauthorized work module', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        designation: { name: 'Video Editor' },
      });
      prisma.roleWorkPermission.findMany.mockResolvedValue([]);
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      await expect(service.checkPermission(1, 101, 'reel_shoot')).rejects.toThrow(
        ForbiddenException,
      );

      await expect(service.checkPermission(1, 101, 'video_edit')).resolves.toBe(true);
    });
  });

  describe('Test Case 8: Multi-tenant Customer Isolation', () => {
    it('strictly isolates role permissions and access requests by customerId', async () => {
      prisma.roleWorkPermission.findMany.mockImplementation(async (query: any) => {
        if (query.where.customerId === 1) {
          return [{ customerId: 1, roleName: 'Video Editor', workModule: 'post_design', isEnabled: true }];
        }
        return [];
      });
      prisma.workAccessRequest.findMany.mockResolvedValue([]);

      // Customer 1 employee gets post_design
      prisma.employee.findFirst.mockResolvedValue({
        id: 101,
        designation: { name: 'Video Editor' },
      });
      const permsCustomer1 = await service.getEmployeeEffectivePermissions(1, { employeeId: 101 });
      expect(permsCustomer1.workPermissions).toContain('post_design');

      // Customer 2 employee does NOT get post_design override from customer 1
      const permsCustomer2 = await service.getEmployeeEffectivePermissions(2, { employeeId: 101 });
      expect(permsCustomer2.workPermissions).not.toContain('post_design');
    });
  });
});
