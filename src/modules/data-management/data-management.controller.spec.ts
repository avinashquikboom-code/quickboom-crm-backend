import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DataManagementController } from './data-management.controller';

describe('DataManagementController customer delete-all routes', () => {
  it('registers the count and delete-all paths with their intended HTTP methods', () => {
    const basePath = Reflect.getMetadata(PATH_METADATA, DataManagementController);
    expect(basePath).toBe('admin/data-management');

    const countHandler = DataManagementController.prototype.getActiveCustomerCount;
    expect(Reflect.getMetadata(PATH_METADATA, countHandler)).toBe('customers/count');
    expect(Reflect.getMetadata(METHOD_METADATA, countHandler)).toBe(RequestMethod.GET);

    const deleteHandler = DataManagementController.prototype.deleteAllCustomers;
    expect(Reflect.getMetadata(PATH_METADATA, deleteHandler)).toBe('customers/delete-all');
    expect(Reflect.getMetadata(METHOD_METADATA, deleteHandler)).toBe(RequestMethod.DELETE);
  });

  it('delegates using the authenticated actor and required confirmation', async () => {
    const dataManagement = {} as any;
    const customers = {
      countActiveCustomersForSuperAdmin: jest.fn().mockResolvedValue({ totalCustomers: 4 }),
      deleteAllForSuperAdmin: jest.fn().mockResolvedValue({ success: true, deletedCount: 4 }),
    };
    const controller = new DataManagementController(dataManagement, customers as any);
    const actor = { id: 1, role: 'SUPER_ADMIN' };

    await expect(controller.getActiveCustomerCount(actor)).resolves.toEqual({ totalCustomers: 4 });
    await expect(controller.deleteAllCustomers(actor, { confirmation: 'DELETE ALL CUSTOMERS' })).resolves.toEqual({
      success: true,
      deletedCount: 4,
    });
    expect(customers.deleteAllForSuperAdmin).toHaveBeenCalledWith(actor, 'DELETE ALL CUSTOMERS');
  });
});
