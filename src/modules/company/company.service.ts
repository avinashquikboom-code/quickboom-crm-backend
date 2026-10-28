import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CheckDuplicateCompanyDto } from './dto/company.dto';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string | undefined, dto: CreateCompanyDto) {
    let numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCustomer = await this.prisma.customer.findFirst({ where: { isActive: true, deletedAt: null } });
      numCustomerId = defaultCustomer?.id || 1;
    }

    return this.prisma.company.create({
      data: {
        customerId: numCustomerId,
        name: dto.name,
        domain: dto.domain || (dto.website ? dto.website.replace(/^https?:\/\//, '') : undefined),
        website: dto.website,
        industry: dto.industry,
        category: dto.category,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country || 'India',
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        googlePlaceId: dto.googlePlaceId,
        rating: dto.rating,
        reviewCount: dto.reviewCount,
        source: dto.source || 'MANUAL',
        status: dto.status || 'ACTIVE',
        notes: dto.notes,
      },
      include: {
        contacts: true,
        deals: true,
      },
    });
  }

  async getMetrics(customerId: number | string | undefined, user?: any) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = Number(customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    const baseWhere: any = { deletedAt: null };
    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        baseWhere.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
      if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      baseWhere.customerId = effectiveCustomerId;
    }

    const [total, active, newCompanies, withDeals] = await Promise.all([
      this.prisma.company.count({ where: { ...baseWhere } }),
      this.prisma.company.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.company.count({
        where: {
          ...baseWhere,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.company.count({
        where: {
          ...baseWhere,
          deals: { some: { isWon: false, isLost: false, deletedAt: null } },
        },
      }),
    ]);

    return {
      total,
      active,
      new: newCompanies,
      withOpenDeals: withDeals,
    };
  }

  async checkDuplicate(customerId: number | string | undefined, dto: CheckDuplicateCompanyDto) {
    const numCustomerId = Number(customerId);
    const placeId = (dto.googlePlaceId || '').trim();
    const cleanName = (dto.name || '').toLowerCase().trim();
    const normPhone = (dto.phone || '').replace(/\D/g, '');
    const cleanEmail = (dto.email || '').toLowerCase().trim();

    const where: any = { deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    if (placeId) {
      const match = await this.prisma.company.findFirst({
        where: { ...where, googlePlaceId: placeId },
      });
      if (match) {
        return { isDuplicate: true, matchReason: 'Google Place ID match', existingCompany: match };
      }
    }

    const companies = await this.prisma.company.findMany({
      where,
    });

    for (const comp of companies) {
      const compName = comp.name.toLowerCase().trim();
      const compPhone = (comp.phone || '').replace(/\D/g, '');
      const compEmail = (comp.email || '').toLowerCase().trim();

      const isNameMatch = cleanName.length >= 3 && compName === cleanName;
      const isPhoneMatch = normPhone.length >= 7 && compPhone.length >= 7 && normPhone === compPhone;
      const isEmailMatch = cleanEmail.length >= 5 && compEmail === cleanEmail;

      if (isNameMatch || isPhoneMatch || isEmailMatch) {
        return {
          isDuplicate: true,
          matchReason: isNameMatch ? 'Company name match' : isPhoneMatch ? 'Phone match' : 'Email match',
          existingCompany: comp,
        };
      }
    }

    return { isDuplicate: false, matchReason: null, existingCompany: null };
  }

  async findAll(
    customerId: number | string | undefined,
    query: { page?: number; limit?: number; search?: string; industry?: string; status?: string },
    user?: any,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = Number(customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        where.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
      if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      where.customerId = effectiveCustomerId;
    }

    if (query.industry && query.industry.toUpperCase() !== 'ALL') where.industry = query.industry;
    if (query.status && query.status.toUpperCase() !== 'ALL') where.status = query.status;

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
        { industry: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contacts: { where: { deletedAt: null } },
          deals: { where: { deletedAt: null } },
          visits: { where: { date: { gte: new Date() } }, take: 3 },
        },
      }),
      this.prisma.company.count({ where }),
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
      throw new NotFoundException(`Company record #${id} not found`);
    }

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const company = await this.prisma.company.findFirst({
      where,
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
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

    if (!company) {
      throw new NotFoundException(`Company with ID ${id} not found`);
    }

    return company;
  }

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateCompanyDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.company.update({
      where: { id: numId },
      data: {
        name: dto.name,
        domain: dto.domain,
        website: dto.website,
        industry: dto.industry,
        category: dto.category,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        googlePlaceId: dto.googlePlaceId,
        rating: dto.rating,
        reviewCount: dto.reviewCount,
        source: dto.source,
        status: dto.status,
        notes: dto.notes,
      },
      include: {
        contacts: true,
        deals: true,
      },
    });
  }

  async delete(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.company.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
