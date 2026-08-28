import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, CheckDuplicateContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string | undefined, dto: CreateContactDto) {
    let numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCustomer = await this.prisma.customer.findFirst({ where: { isActive: true, deletedAt: null } });
      numCustomerId = defaultCustomer?.id || 1;
    }

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

  async getMetrics(customerId: number | string | undefined, user?: any) {
    const numCustomerId = Number(customerId || user?.customerId);
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const baseWhere: any = { deletedAt: null };
    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        baseWhere.customerId = numCustomerId;
      } else {
        baseWhere.customerId = 0;
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      baseWhere.customerId = numCustomerId;
    }

    const [total, active, newContacts, withVisits] = await Promise.all([
      this.prisma.contact.count({ where: { ...baseWhere } }),
      this.prisma.contact.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.contact.count({
        where: {
          ...baseWhere,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.contact.count({
        where: {
          ...baseWhere,
          visits: { some: { status: 'SCHEDULED' } },
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

  async checkDuplicate(customerId: number | string | undefined, dto: CheckDuplicateContactDto) {
    const numCustomerId = Number(customerId);
    const cleanEmail = (dto.email || '').toLowerCase().trim();
    const normPhone = (dto.phone || '').replace(/\D/g, '');

    const where: any = { deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const candidates = await this.prisma.contact.findMany({
      where,
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
    customerId: number | string | undefined,
    query: { page?: number; limit?: number; search?: string; type?: string; companyId?: string; status?: string; assignedToId?: string },
    user?: any,
  ) {
    const numCustomerId = Number(customerId || user?.customerId);
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      } else {
        where.customerId = 0; // Strict tenant isolation: prevent leakage
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    if (query.type && query.type.toUpperCase() !== 'ALL') where.type = query.type as any;
    if (query.status && query.status.toUpperCase() !== 'ALL') where.status = query.status;
    if (query.companyId && query.companyId.toUpperCase() !== 'ALL' && !isNaN(Number(query.companyId))) {
      where.companyId = Number(query.companyId);
    }
    if (query.assignedToId && query.assignedToId.toUpperCase() !== 'ALL' && !isNaN(Number(query.assignedToId))) {
      where.assignedToId = Number(query.assignedToId);
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { mobile: { contains: s, mode: 'insensitive' } },
        { designation: { contains: s, mode: 'insensitive' } },
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
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const contact = await this.prisma.contact.findFirst({
      where,
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

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateContactDto) {
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

  async delete(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.contact.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
