import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataCaptureController } from './data-capture.controller';
import { DataCaptureService } from './data-capture.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY, RequiredPermission } from '../../common/decorators/permissions.decorator';

describe('DataCaptureController RBAC & Permissions Enforcement', () => {
  let controller: DataCaptureController;
  let permissionsGuard: PermissionsGuard;
  let reflector: Reflector;
  let dataCaptureService: Partial<DataCaptureService>;

  beforeEach(async () => {
    reflector = new Reflector();
    permissionsGuard = new PermissionsGuard(reflector);

    dataCaptureService = {
      listPlaces: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getUsageSummary: jest.fn().mockResolvedValue({ totalExtractions: 0 }),
      getCustomerJobs: jest.fn().mockResolvedValue([]),
      extractPlaces: jest.fn().mockResolvedValue({ jobId: 'job-1', captured: 5 }),
      createPlace: jest.fn().mockResolvedValue({ id: 1, businessName: 'Acme Corp' }),
      updatePlace: jest.fn().mockResolvedValue({ id: 1, businessName: 'Acme Updated' }),
      validatePlace: jest.fn().mockResolvedValue({ id: 1, status: 'VALIDATED' }),
      rejectPlace: jest.fn().mockResolvedValue({ id: 1, status: 'REJECTED' }),
      deletePlace: jest.fn().mockResolvedValue({ success: true }),
      handleBulkAction: jest.fn().mockResolvedValue({ success: true, count: 2 }),
      importToLeads: jest.fn().mockResolvedValue({ importedCount: 2 }),
      createLeadFromPlace: jest.fn().mockResolvedValue({ leadId: 99 }),
      checkDuplicates: jest.fn().mockResolvedValue({ hasDuplicates: false }),
      getPlaceById: jest.fn().mockResolvedValue({ id: 1, businessName: 'Acme' }),
      getJobById: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
    };

    controller = new DataCaptureController(dataCaptureService as DataCaptureService);
  });

  function createMockContext(user: any, handler: Function): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => DataCaptureController,
    } as unknown as ExecutionContext;
  }

  describe('1. Endpoint Permission Decorators Verification', () => {
    it('decorates listPlaces with DATA_CAPTURE:VIEW', () => {
      const perms = reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, controller.listPlaces);
      expect(perms).toEqual([{ module: 'DATA_CAPTURE', action: 'VIEW' }]);
    });

    it('decorates extractPlaces with DATA_CAPTURE:CREATE', () => {
      const perms = reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, controller.extractPlaces);
      expect(perms).toEqual([{ module: 'DATA_CAPTURE', action: 'CREATE' }]);
    });

    it('decorates updatePlace with DATA_CAPTURE:EDIT', () => {
      const perms = reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, controller.updatePlace);
      expect(perms).toEqual([{ module: 'DATA_CAPTURE', action: 'EDIT' }]);
    });

    it('decorates deletePlace with DATA_CAPTURE:DELETE', () => {
      const perms = reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, controller.deletePlace);
      expect(perms).toEqual([{ module: 'DATA_CAPTURE', action: 'DELETE' }]);
    });
  });

  describe('2. PermissionsGuard Access Control for Data Capture', () => {
    const superAdminUser = {
      id: 1,
      role: 'SUPER_ADMIN',
      roles: ['SUPER_ADMIN'],
      permissions: [],
    };

    const viewOnlyUser = {
      id: 2,
      role: 'TELECALLER',
      roles: ['TELECALLER'],
      permissions: [{ module: 'DATA_CAPTURE', action: 'VIEW' }],
    };

    const createEditUser = {
      id: 3,
      role: 'SALES_EXECUTIVE',
      roles: ['SALES_EXECUTIVE'],
      permissions: [
        { module: 'DATA_CAPTURE', action: 'VIEW' },
        { module: 'DATA_CAPTURE', action: 'CREATE' },
        { module: 'DATA_CAPTURE', action: 'EDIT' },
      ],
    };

    const fullAccessUser = {
      id: 4,
      role: 'MANAGER',
      roles: ['MANAGER'],
      permissions: [
        { module: 'DATA_CAPTURE', action: 'VIEW' },
        { module: 'DATA_CAPTURE', action: 'CREATE' },
        { module: 'DATA_CAPTURE', action: 'EDIT' },
        { module: 'DATA_CAPTURE', action: 'DELETE' },
      ],
    };

    it('allows SUPER_ADMIN full access to all endpoints regardless of explicit permissions', () => {
      expect(permissionsGuard.canActivate(createMockContext(superAdminUser, controller.listPlaces))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(superAdminUser, controller.extractPlaces))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(superAdminUser, controller.updatePlace))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(superAdminUser, controller.deletePlace))).toBe(true);
    });

    it('allows View-only user to list places and view usage', () => {
      expect(permissionsGuard.canActivate(createMockContext(viewOnlyUser, controller.listPlaces))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(viewOnlyUser, controller.getUsageSummary))).toBe(true);
    });

    it('rejects View-only user with 403 when attempting to extract places', () => {
      const ctx = createMockContext(viewOnlyUser, controller.extractPlaces);
      expect(() => permissionsGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects View-only user with 403 when attempting to delete a place', () => {
      const ctx = createMockContext(viewOnlyUser, controller.deletePlace);
      expect(() => permissionsGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows user with CREATE and EDIT to extract and update places', () => {
      expect(permissionsGuard.canActivate(createMockContext(createEditUser, controller.extractPlaces))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(createEditUser, controller.updatePlace))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(createEditUser, controller.validatePlace))).toBe(true);
      expect(permissionsGuard.canActivate(createMockContext(createEditUser, controller.importToLeads))).toBe(true);
    });

    it('rejects user without DELETE permission when attempting deletePlace', () => {
      const ctx = createMockContext(createEditUser, controller.deletePlace);
      expect(() => permissionsGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects user without DELETE permission during bulk action with action=DELETE', async () => {
      await expect(
        controller.handleBulkAction('1', createEditUser, { ids: [1, 2], action: 'DELETE' as any }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows fullAccessUser with DELETE permission to delete records and perform bulk delete', async () => {
      expect(permissionsGuard.canActivate(createMockContext(fullAccessUser, controller.deletePlace))).toBe(true);
      const res = await controller.handleBulkAction('1', fullAccessUser, { ids: [1, 2], action: 'DELETE' as any });
      expect(res).toEqual({ success: true, count: 2 });
    });
  });
});
