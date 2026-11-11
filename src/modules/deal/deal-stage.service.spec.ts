import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealService } from './deal.service';

describe('DealService stage management', () => {
  const prisma = {
    pipeline: { findFirst: jest.fn(), create: jest.fn() },
    pipelineStage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new DealService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('refuses to delete a stage that still has deals', async () => {
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 4, name: 'Proposal', _count: { deals: 2 } });
    await expect(service.deleteStage(9, 4)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
  });

  it('returns one deal stage for the current tenant', async () => {
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 5, name: 'New', _count: { deals: 0 } });
    await expect(service.getStage(9, 5)).resolves.toMatchObject({ id: 5, name: 'New' });
  });

  it('rejects an invalid deal stage id', async () => {
    await expect(service.getStage(9, 'stage-5')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes stage lookup to the current tenant', async () => {
    prisma.pipelineStage.findFirst.mockResolvedValue(null);
    await expect(service.deleteStage(9, 4)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.pipelineStage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4, pipeline: { customerId: 9, deletedAt: null } },
    }));
  });

  it('moves removed deals off the last stage and still deletes that stage', async () => {
    prisma.pipelineStage.findFirst
      .mockResolvedValueOnce({ id: 4, name: 'New', pipelineId: 3, _count: { deals: 0 } })
      .mockResolvedValueOnce(null);
    (prisma as any).deal = {
      count: jest.fn().mockResolvedValue(4),
      updateMany: jest.fn().mockResolvedValue({ count: 4 }),
    };
    prisma.pipelineStage.create.mockResolvedValue({ id: 90, name: '__removed_deals__' });

    await expect(service.deleteStage(9, 4)).resolves.toEqual({ deleted: true, id: 4 });

    expect((prisma as any).deal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 9, stageId: 4, deletedAt: { not: null } },
      data: { stageId: 90 },
    }));
    expect(prisma.pipelineStage.delete).toHaveBeenCalledWith({ where: { id: 4 } });
  });

  it('rejects a duplicate stage name in the same pipeline', async () => {
    prisma.pipeline.findFirst.mockResolvedValue({ id: 1, stages: [{ id: 2, name: 'Won', order: 1 }] });
    prisma.pipelineStage.findMany.mockResolvedValue([{ id: 2, name: 'Won' }]);
    await expect(service.createStage(9, { name: ' won ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
  });
});
