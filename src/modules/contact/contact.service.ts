import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, dto: CreateContactDto) {
    const numCustomerId = Number(customerId);
    return this.prisma.contact.create({
      data: {
        ...dto,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        customerId: numCustomerId,
      },
      include: { company: true },
    });
  }

  async findAll(customerId: number | string, query: { page?: number; limit?: number; search?: string; type?: string }) {
    const numCustomerId = Number(customerId);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { company: true },
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const contact = await this.prisma.contact.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
      include: {
        company: true,
        communications: { orderBy: { timestamp: 'desc' } },
        deals: true,
        invoices: true,
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }
    return contact;
  }

  async update(customerId: number | string, id: number | string, dto: UpdateContactDto) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.contact.update({
      where: { id: numId },
      data: {
        ...dto,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
      } as any,
      include: { company: true },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.contact.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
