import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

describe('admin notification history deletion', () => {
  const deleteMany = jest.fn();
  const service = new NotificationService({ notification: { deleteMany } } as any, {} as any);
  const controller = new NotificationController(service, {} as any, {} as any);

  beforeEach(() => deleteMany.mockReset());

  it('limits tenant administrators to their own offer notifications', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    await controller.deleteAdminHistory('12', 7, { role: 'TENANT_ADMIN' });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 12, type: 'ADMIN_OFFER', customerId: 7 } });
  });

  it('rejects non-administrators before deleting', () => {
    expect(() => controller.deleteAdminHistory('12', 7, { role: 'EMPLOYEE' })).toThrow(ForbiddenException);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('reports records outside the allowed scope as not found', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    await expect(controller.deleteAdminHistory('12', 7, { role: 'TENANT_ADMIN' })).rejects.toThrow(NotFoundException);
  });
});
