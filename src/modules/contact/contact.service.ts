import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, CheckDuplicateContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, dto: CreateContactDto) {
    const numCustomerId = Number(customerId);
    return this.prisma.contact.create({
      data: {
        customerId: numCustomerId,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        type: dto.type,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone || dto.mobile,
        mobile: dto.mobile || dto.phone,
        alternateMobile: dto.alternateMobile,
        designation: dto.designation,
        website: dto.website,
        source: dto.source || 'DIRECT',
        status: dto.status || 'ACTIVE',
        tags: dto.tags || [],
        notes: dto.notes,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
      },
      include: {
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async getMetrics(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const [total, active, newContacts, withVisits] = await Promise.all([
      this.prisma.contact.count({ where: { customerId: numCustomerId, deletedAt: null } }),
      this.prisma.contact.count({ where: { customerId: numCustomerId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.contact.count({
        where: {
          customerId: numCustomerId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          deletedAt: null,
        },
      }),
      this.prisma.contact.count({
        where: {
          customerId: numCustomerId,
          visits: { some: { status: 'SCHEDULED' } },
          deletedAt: null,
        },
      }),
    ]);

    return {
      total,
      active,
      new: newContacts,
      withFollowUps: withVisits,
    };
  }

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateContactDto) {
    const numCustomerId = Number(customerId);
    const cleanEmail = (dto.email || '').toLowerCase().trim();
    const normPhone = (dto.phone || '').replace(/\D/g, '');

    const candidates = await this.prisma.contact.findMany({
      where: { customerId: numCustomerId, deletedAt: null },
      include: { company: true },
    });

    for (const c of candidates) {
      const cEmail = (c.email || '').toLowerCase().trim();
      const cPhone = (c.phone || c.mobile || '').replace(/\D/g, '');

      const isEmailMatch = cleanEmail.length >= 5 && cEmail === cleanEmail;
      const isPhoneMatch = normPhone.length >= 7 && cPhone.length >= 7 && normPhone === cPhone;

      if (isEmailMatch || isPhoneMatch) {
        return {
          isDuplicate: true,
          matchReason: isEmailMatch ? 'Email address match' : 'Phone number match',
          existingContact: c,
        };
      }
    }

    return { isDuplicate: false, matchReason: null, existingContact: null };
  }

  async findAll(
    customerId: number | string,
    query: { page?: number; limit?: number; search?: string; type?: string; companyId?: string; status?: string; assignedToId?: string },
  ) {
    const numCustomerId = Number(customerId);
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId, deletedAt: null };
    if (query.type && query.type !== 'ALL') where.type = query.type;
    if (query.status && query.status !== 'ALL') where.status = query.status;
    if (query.companyId && query.companyId !== 'ALL') where.companyId = Number(query.companyId);
    if (query.assignedToId && query.assignedToId !== 'ALL') where.assignedToId = Number(query.assignedToId);

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { mobile: { contains: query.search, mode: 'insensitive' } },
        { designation: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          deals: { where: { deletedAt: null } },
          visits: { take: 2, orderBy: { date: 'desc' } },
        },
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
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        communications: { orderBy: { timestamp: 'desc' } },
        deals: {
          where: { deletedAt: null },
          include: { stage: true, pipeline: true },
          orderBy: { createdAt: 'desc' },
        },
        visits: {
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }
    return contact;
  }

  async update(customerId: number | string, id: number | string, dto: UpdateContactDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.contact.update({
      where: { id: numId },
      data: {
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        type: dto.type,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone || dto.mobile,
        mobile: dto.mobile || dto.phone,
        alternateMobile: dto.alternateMobile,
        designation: dto.designation,
        website: dto.website,
        source: dto.source,
        status: dto.status,
        tags: dto.tags,
        notes: dto.notes,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
      },
      include: { company: true },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.contact.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
