import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, CheckDuplicateContactDto } from './dto/contact.dto';
import { isUserSuperAdmin } from '../../common/utils/role.util';

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
    const isSuperAdmin = isUserSuperAdmin(user);
    // Explicit customerId override: SUPER_ADMIN may pass a target customer via query/header
    const numCustomerId = Number(customerId || user?.customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    // Build the base where clause:
    // - SUPER_ADMIN with no explicit target => no customerId filter (platform-wide view)
    // - SUPER_ADMIN with explicit target => scoped to that customer
    // - Non-SUPER_ADMIN => strictly scoped to their own customerId
    const baseWhere: any = { deletedAt: null };

    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        baseWhere.customerId = numCustomerId;
      }
      // else: no filter — SUPER_ADMIN sees all
    } else {
      // Non-SUPER_ADMIN: customerId is mandatory
      if (!hasExplicitCustomer) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
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
    const isSuperAdmin = isUserSuperAdmin(user);
    // SUPER_ADMIN may optionally scope to a specific customer via query param / header
    // (CustomerGuard resolves that into request.customerId; falls back to undefined for global view)
    const numCustomerId = Number(customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    // Build tenant-scoped where clause:
    // - SUPER_ADMIN, no explicit customerId => see ALL contacts (no filter)
    // - SUPER_ADMIN, explicit customerId   => scoped to that customer
    // - Normal user                        => strictly scoped to their customerId (never undefined)
    const where: any = { deletedAt: null };

    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        where.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      // Non-SUPER_ADMIN: derive customerId from user claim if not in request
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
      if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      where.customerId = effectiveCustomerId;
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
