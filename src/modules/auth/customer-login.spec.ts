import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('customer password login', () => {
  it.each(['customer@example.com', '+919876543210'])(
    'authenticates the linked CUSTOMER account by %s',
    async (identifier) => {
      const passwordHash = await bcrypt.hash('123456', 4);
      const user = { id: 9, accountType: 'CUSTOMER', passwordHash };
      const service: any = Object.create(AuthService.prototype);
      service.prisma = { user: { findMany: jest.fn().mockResolvedValue([user]) } };
      service.createSessionResponse = jest.fn().mockResolvedValue({ success: true });

      await expect(service.login(identifier, '123456', 'CUSTOMER')).resolves.toEqual({ success: true });
      expect(service.createSessionResponse).toHaveBeenCalledWith(user);
    },
  );

  it('rejects ambiguous identifiers and accounts with a different role', async () => {
    const service: any = Object.create(AuthService.prototype);
    service.prisma = { user: { findMany: jest.fn().mockResolvedValue([
      { id: 1, accountType: 'CUSTOMER', passwordHash: 'unused' },
      { id: 2, accountType: 'CUSTOMER', passwordHash: 'unused' },
    ]) } };
    service.createSessionResponse = jest.fn();
    await expect(service.login('same@example.com', '123456', 'CUSTOMER')).rejects.toThrow(UnauthorizedException);

    service.prisma.user.findMany.mockResolvedValue([
      { id: 3, accountType: 'EMPLOYEE', passwordHash: 'unused' },
    ]);
    await expect(service.login('employee@example.com', '123456', 'CUSTOMER')).rejects.toThrow(UnauthorizedException);
    expect(service.createSessionResponse).not.toHaveBeenCalled();
  });

  it('changes a linked customer password and revokes refresh tokens', async () => {
    const oldHash = await bcrypt.hash('123456', 4);
    const tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service: any = Object.create(AuthService.prototype);
    service.prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          accountType: 'CUSTOMER',
          isActive: true,
          deletedAt: null,
          passwordHash: oldHash,
          customerAccount: { deletedAt: null },
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    await service.changeCustomerPassword(9, {
      currentPassword: '123456',
      newPassword: 'NewPassword1',
    });
    const newHash = tx.user.update.mock.calls[0][0].data.passwordHash;
    expect(await bcrypt.compare('NewPassword1', newHash)).toBe(true);
    expect(await bcrypt.compare('123456', newHash)).toBe(false);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 9, isRevoked: false },
      data: { isRevoked: true },
    });
  });
});
