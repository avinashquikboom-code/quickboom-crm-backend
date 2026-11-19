import { DesignationService } from './designation.service';

describe('DesignationService.getDesignationRoles reset behavior', () => {
  const makeService = (resetLog: unknown) => {
    const prisma = {
      auditLog: { findFirst: jest.fn().mockResolvedValue(resetLog) },
      designation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new DesignationService(prisma as any, {} as any);
    const seedStandard = jest.spyOn(service, 'seedInitialDesignationsIfEmpty').mockResolvedValue();
    const seedCustomer = jest.spyOn(service, 'ensureCustomerAppDesignation').mockResolvedValue({} as any);
    return { service, prisma, seedStandard, seedCustomer };
  };

  it('does not recreate default designations after a successful Designations reset', async () => {
    const { service, prisma, seedStandard, seedCustomer } = makeService({ id: 91 });

    await service.getDesignationRoles(12);

    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: 'DATA_RESET',
        status: 'SUCCESS',
        AND: expect.arrayContaining([
          { details: { path: ['modules'], array_contains: ['designations'] } },
          expect.objectContaining({ OR: expect.arrayContaining([{ customerId: 12 }]) }),
        ]),
      }),
    }));
    expect(seedStandard).not.toHaveBeenCalled();
    expect(seedCustomer).not.toHaveBeenCalled();
  });

  it('keeps initial default seeding for tenants without a Designations reset', async () => {
    const { service, seedStandard, seedCustomer } = makeService(null);

    await service.getDesignationRoles(12);

    expect(seedStandard).toHaveBeenCalledWith(12);
    expect(seedCustomer).toHaveBeenCalledWith(12);
  });

  it('fails closed and skips seeding if reset history cannot be checked', async () => {
    const { service, prisma, seedStandard, seedCustomer } = makeService(null);
    prisma.auditLog.findFirst.mockRejectedValue(new Error('audit database unavailable'));

    await service.getDesignationRoles(12);

    expect(seedStandard).not.toHaveBeenCalled();
    expect(seedCustomer).not.toHaveBeenCalled();
  });
});
