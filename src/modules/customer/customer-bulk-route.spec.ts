import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CustomerController, BulkDeleteCustomersDto } from './customer.controller';
import { CustomerService } from './customer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('customer bulk delete route contract', () => {
  it('registers POST and DELETE separately, never a GET mutation, with JWT protection', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerController)).toContain(JwtAuthGuard);
    const module = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [{ provide: CustomerService, useValue: {} }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    try {
      await app.init();
      const routes = app.getHttpAdapter().getInstance()._router.stack.filter((r: any) => r.route).map((r: any) => r.route);
      for (const path of ['/api/v1/customers/bulk-delete', '/api/v1/customers/bulk']) {
        expect(routes.some((r: any) => r.path === path && r.methods.post)).toBe(true);
        expect(routes.some((r: any) => r.path === path && r.methods.delete)).toBe(true);
        expect(routes.some((r: any) => r.path === path && r.methods.get)).toBe(false);
      }
    } finally { await app.close(); }
  });
  it('validates real JSON bodies without coercing malformed IDs', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: BulkDeleteCustomersDto };
    for (const body of [{}, { ids: [] }, { ids: [0] }, { ids: ['2'] }, { ids: [true] }, { ids: [1.5] }, { ids: [2], extra: true }]) {
      await expect(pipe.transform(body, metadata)).rejects.toThrow();
    }
    await expect(pipe.transform({ ids: [2, 3], cancelSubscriptions: false }, metadata)).resolves.toMatchObject({ ids: [2, 3] });
  });
  it('passes explicit cancellation and selected IDs to the existing deletion transaction', async () => {
    const service = { bulkRemove: jest.fn().mockResolvedValue({ deletedCount: 2, ids: [2, 3] }) };
    const controller = new CustomerController(service as any);
    const actor = { id: 1, accountType: 'ADMIN' };
    await expect(controller.bulkDelete(actor, { ids: [2, 3] })).resolves.toEqual({ deletedCount: 2, ids: [2, 3] });
    expect(service.bulkRemove).toHaveBeenLastCalledWith([2, 3], actor, false);
    await controller.bulkDeleteViaDelete(actor, { ids: [2], cancelSubscriptions: true });
    expect(service.bulkRemove).toHaveBeenLastCalledWith([2], actor, true);
  });
});
