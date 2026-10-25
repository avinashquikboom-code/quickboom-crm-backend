import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../app.module';
import { DataCaptureModule } from './data-capture.module';
import { DataCaptureController } from './data-capture.controller';
import { DataCaptureService } from './data-capture.service';
import { LeadModule } from '../lead/lead.module';
import { LeadService } from '../lead/lead.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { WorkspaceAccessGuard } from '../../common/guards/workspace-access.guard';

describe('Data Capture Lead import route registration', () => {
  it('wires the real controller and Lead service through the application modules', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toContain(DataCaptureModule);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DataCaptureModule)).toContain(DataCaptureController);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, DataCaptureModule)).toContain(LeadModule);
  });

  it('mounts the existing create-lead path and import-lead compatibility path as POST routes', async () => {
    // Initialize only the production controller with isolated services; no real database or jobs.
    const module = await Test.createTestingModule({
      controllers: [DataCaptureController],
      providers: [
        { provide: DataCaptureService, useValue: {} },
        { provide: LeadService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(CustomerGuard).useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceAccessGuard).useValue({ canActivate: () => true }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    try {
      await app.init();
      const server = app.getHttpAdapter().getInstance();
      const routes = server._router.stack.filter((layer: any) => layer.route).map((layer: any) => layer.route);
      for (const path of ['/api/v1/data-capture/:id/create-lead', '/api/v1/data-capture/:id/import-lead', '/api/v1/data-capture/import-to-leads']) {
        expect(routes.some((route: any) => route.path === path && route.methods.post)).toBe(true);
      }
    } finally { await app.close(); }
  });
});


describe('existing bulk import endpoint selected-ID contract', () => {
  it('uses the selected-ID service and preserves the legacy job import contract', async () => {
    const results = { imported: [{ captureId: 3, leadId: 31 }], alreadyImported: [], skipped: [], failed: [] };
    const leads = { importSelectedCaptures: jest.fn().mockResolvedValue(results), importMultipleCaptures: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new DataCaptureController({} as any, leads as any);
    const user = { id: 2, accountType: 'ADMIN' };
    expect(await controller.importToLeads(user, {}, { ids: [3] })).toEqual({ success: true, data: results });
    expect(leads.importSelectedCaptures).toHaveBeenCalledWith([3], user, 'ADMIN_PANEL');
    await controller.importToLeads(user, {}, { jobId: 'existing-job' });
    expect(leads.importMultipleCaptures).toHaveBeenCalledWith({ jobId: 'existing-job' }, user, 'ADMIN_PANEL');
    // Saved-record imports use the same placeIds contract as the extraction client.
    for (const placeIds of [[3], [3, 4]]) {
      await controller.importToLeads(user, {}, { placeIds });
      expect(leads.importMultipleCaptures).toHaveBeenLastCalledWith({ placeIds }, user, 'ADMIN_PANEL');
    }
    for (const ids of [[0], [-1], [1.5], ['3'], '3']) {
      await expect(controller.importToLeads(user, {}, { ids })).rejects.toThrow();
    }
    expect(leads.importSelectedCaptures).toHaveBeenCalledTimes(1);
  });
});
