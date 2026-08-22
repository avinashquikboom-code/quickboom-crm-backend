import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CheckDuplicateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, dto: CreateCompanyDto) {
    const numCustomerId = Number(customerId);
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
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        contacts: true,
        deals: true,
      },
    });
  }

  async getMetrics(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const [total, active, newCompanies, withDeals] = await Promise.all([
      this.prisma.company.count({ where: { customerId: numCustomerId, deletedAt: null } }),
      this.prisma.company.count({ where: { customerId: numCustomerId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.company.count({
        where: {
          customerId: numCustomerId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          deletedAt: null,
        },
      }),
      this.prisma.company.count({
        where: {
          customerId: numCustomerId,
          deals: { some: { isWon: false, isLost: false, deletedAt: null } },
          deletedAt: null,
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

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateCompanyDto) {
    const numCustomerId = Number(customerId);
    const placeId = (dto.googlePlaceId || '').trim();
    const cleanName = (dto.name || '').toLowerCase().trim();
    const normPhone = (dto.phone || '').replace(/\D/g, '');
    const cleanEmail = (dto.email || '').toLowerCase().trim();

    if (placeId) {
      const match = await this.prisma.company.findFirst({
        where: { customerId: numCustomerId, googlePlaceId: placeId, deletedAt: null },
      });
      if (match) {
        return { isDuplicate: true, matchReason: 'Google Place ID match', existingCompany: match };
      }
    }

    const companies = await this.prisma.company.findMany({
      where: { customerId: numCustomerId, deletedAt: null },
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
    customerId: number | string,
    query: { page?: number; limit?: number; search?: string; industry?: string; status?: string; assignedToId?: string },
  ) {
    const numCustomerId = Number(customerId);
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId, deletedAt: null };
    if (query.industry && query.industry !== 'ALL') where.industry = query.industry;
    if (query.status && query.status !== 'ALL') where.status = query.status;
    if (query.assignedToId && query.assignedToId !== 'ALL') where.assignedToId = Number(query.assignedToId);

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { industry: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          contacts: { where: { deletedAt: null } },
          deals: { where: { deletedAt: null } },
          visits: { where: { date: { gte: new Date() } }, take: 3 },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const company = await this.prisma.company.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
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

  async update(customerId: number | string, id: number | string, dto: UpdateCompanyDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.company.update({
      where: { id: numId },
      data: {
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
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.company.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
