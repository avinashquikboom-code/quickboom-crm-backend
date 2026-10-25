import 'reflect-metadata';
import { ForbiddenException, BadRequestException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { TeamController } from './team.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('team deletion routes', () => {
  it('registers GET dependencies and DELETE team under the existing teams prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TeamController)).toBe('teams');
    expect(Reflect.getMetadata(PATH_METADATA, TeamController.prototype.getDependencies)).toBe(':id/dependencies');
    expect(Reflect.getMetadata(METHOD_METADATA, TeamController.prototype.getDependencies)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, TeamController.prototype.remove)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(GUARDS_METADATA, TeamController)).toContain(JwtAuthGuard);
  });

  it('rejects non-admin dependency and delete requests before calling the service', async () => {
    const service = { remove: jest.fn(), getDependencies: jest.fn() };
    const controller = new TeamController(service as any);
    const employee = { id: 10, accountType: 'EMPLOYEE' };
    await expect(controller.getDependencies('4', employee, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove('4', employee, undefined, undefined, 'true')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.remove).not.toHaveBeenCalled();
    expect(service.getDependencies).not.toHaveBeenCalled();
  });

  it('preserves explicit soft deletion and rejects invalid deletion flags', async () => {
    const service = { remove: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new TeamController(service as any);
    const admin = { id: 1, accountType: 'SUPER_ADMIN' };
    await controller.remove('4', admin, undefined, undefined, 'false');
    expect(service.remove).toHaveBeenCalledWith(undefined, '4', false, undefined);
    await expect(controller.remove('4', admin, undefined, undefined, 'invalid')).rejects.toBeInstanceOf(BadRequestException);
  });
});
