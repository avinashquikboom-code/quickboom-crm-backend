import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto } from './dto/deal.dto';

@Injectable()
export class DealService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: string, dto: CreateDealDto) {
    return this.prisma.deal.create({
      data: {
        ...dto,
        customerId,
        expectedClosing: dto.expectedClosing ? new Date(dto.expectedClosing) : null,
      },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        company: true,
      },
    });
  }

  async findAll(customerId: string, query: { pipelineId?: string; stageId?: string }) {
    const where: any = { customerId, deletedAt: null };
    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.stageId) where.stageId = query.stageId;

    return this.prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        company: true,
      },
    });
  }

  async findOne(customerId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, customerId, deletedAt: null },
      include: {
        pipeline: { include: { stages: { orderBy: { order: 'asc' } } } },
        stage: true,
        contact: true,
        company: true,
        quotations: true,
      },
    });

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`);
    }
    return deal;
  }

  async update(customerId: string, id: string, dto: UpdateDealDto) {
    await this.findOne(customerId, id);
    return this.prisma.deal.update({
      where: { id },
      data: {
        ...dto,
        expectedClosing: dto.expectedClosing ? new Date(dto.expectedClosing) : undefined,
      },
      include: { stage: true, pipeline: true },
    });
  }

  async delete(customerId: string, id: string) {
    await this.findOne(customerId, id);
    return this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
