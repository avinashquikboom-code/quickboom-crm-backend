import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
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

    const [total, active, newContacts, withVisits, phoneContacts, emailContacts, companyGroups] = await Promise.all([
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
      this.prisma.contact.count({ where: { ...baseWhere, OR: [{ phone: { not: '' } }, { mobile: { not: '' } }] } }),
      this.prisma.contact.count({ where: { ...baseWhere, email: { not: '' } } }),
      this.prisma.contact.groupBy({
        by: ['companyId'],
        where: { ...baseWhere, companyId: { not: null } },
      }),
    ]);

    return {
      total,
      active,
      new: newContacts,
      withFollowUps: withVisits,
      companies: companyGroups.length,
      phoneContacts,
      emailContacts,
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
        { company: { is: { name: { contains: s, mode: 'insensitive' } } } },
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

    if (isNaN(numId) || numId <= 0) {
      throw new NotFoundException(`Contact record #${id} not found`);
    }

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

  async delete(customerId: number | string | undefined, id: number | string, permanent = true) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const contact = await this.findOne(numCustomerId, numId);

    if (permanent) {
      await this.prisma.contact.delete({ where: { id: numId } });
      try {
        await this.prisma.auditLog.create({
          data: {
            customerId: numCustomerId,
            action: 'DELETE',
            module: 'CRM_CONTACTS',
            description: `Permanently deleted Contact #${numId} (${contact.firstName} ${contact.lastName || ''})`,
            status: 'SUCCESS',
            source: 'ADMIN_PANEL',
            entityType: 'Contact',
            entityId: String(numId),
            details: { contactId: numId, name: `${contact.firstName} ${contact.lastName || ''}`.trim() },
          },
        });
      } catch {
        // ignore
      }
      return { success: true, deleted: true, message: `Contact #${numId} permanently deleted.` };
    }

    return this.prisma.contact.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }

  async bulkDelete(customerId: number | string | undefined, ids: Array<number | string>, permanent = true) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Contact IDs array must not be empty.');
    }
    const numCustomerId = Number(customerId);
    const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((n) => !isNaN(n) && n > 0)));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('No valid contact IDs provided.');
    }

    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: uniqueIds }, customerId: numCustomerId },
      select: { id: true, firstName: true, lastName: true },
    });

    const foundIds = contacts.map((c) => c.id);
    const blocked: Array<{ id: number; reason: string }> = [];
    const missingIds = uniqueIds.filter((id) => !foundIds.includes(id));
    for (const mId of missingIds) {
      blocked.push({ id: mId, reason: 'Contact not found or belongs to another company.' });
    }

    if (foundIds.length > 0) {
      if (permanent) {
        await this.prisma.contact.deleteMany({ where: { id: { in: foundIds }, customerId: numCustomerId } });
      } else {
        await this.prisma.contact.updateMany({
          where: { id: { in: foundIds }, customerId: numCustomerId },
          data: { deletedAt: new Date() },
        });
      }

      try {
        await this.prisma.auditLog.create({
          data: {
            customerId: numCustomerId,
            action: 'DELETE',
            module: 'CRM_CONTACTS',
            description: `Bulk deleted ${foundIds.length} contacts`,
            status: 'SUCCESS',
            source: 'ADMIN_PANEL',
            details: { requested: uniqueIds.length, deletedCount: foundIds.length, deletedIds: foundIds },
          },
        });
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      requested: uniqueIds.length,
      deleted: foundIds.length,
      blocked: blocked.length,
      failed: 0,
      deletedIds: foundIds,
      blockedDetails: blocked,
      message: `Permanently deleted ${foundIds.length} contacts.` + (blocked.length ? ` (${blocked.length} skipped)` : ''),
    };
  }
}
