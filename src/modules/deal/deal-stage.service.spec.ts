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

  it('scopes stage lookup to the current tenant', async () => {
    prisma.pipelineStage.findFirst.mockResolvedValue(null);
    await expect(service.deleteStage(9, 4)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.pipelineStage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4, pipeline: { customerId: 9, deletedAt: null } },
    }));
  });

  it('rejects a duplicate stage name in the same pipeline', async () => {
    prisma.pipeline.findFirst.mockResolvedValue({ id: 1, stages: [{ id: 2, name: 'Won', order: 1 }] });
    prisma.pipelineStage.findMany.mockResolvedValue([{ id: 2, name: 'Won' }]);
    await expect(service.createStage(9, { name: ' won ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
  });
});
