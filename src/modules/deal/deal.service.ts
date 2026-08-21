import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto } from './dto/deal.dto';

@Injectable()
export class DealService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, dto: CreateDealDto) {
    const numCustomerId = Number(customerId);
    return this.prisma.deal.create({
      data: {
        ...dto,
        pipelineId: Number(dto.pipelineId),
        stageId: Number(dto.stageId),
        contactId: dto.contactId ? Number(dto.contactId) : undefined,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        customerId: numCustomerId,
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

  async findAll(customerId: number | string, query: { pipelineId?: number | string; stageId?: number | string }) {
    const numCustomerId = Number(customerId);
    const where: any = { customerId: numCustomerId, deletedAt: null };
    if (query.pipelineId) where.pipelineId = Number(query.pipelineId);
    if (query.stageId) where.stageId = Number(query.stageId);

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

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const deal = await this.prisma.deal.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
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

  async update(customerId: number | string, id: number | string, dto: UpdateDealDto) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.deal.update({
      where: { id: numId },
      data: {
        ...dto,
        pipelineId: dto.pipelineId ? Number(dto.pipelineId) : undefined,
        stageId: dto.stageId ? Number(dto.stageId) : undefined,
        contactId: dto.contactId ? Number(dto.contactId) : undefined,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        expectedClosing: dto.expectedClosing ? new Date(dto.expectedClosing) : undefined,
      } as any,
      include: { stage: true, pipeline: true },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.deal.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
