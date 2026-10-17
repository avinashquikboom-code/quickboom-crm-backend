import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CrmLeadStatus, RecordCreatedFrom } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserAdmin } from '../../common/utils/account.util';
import { CreateLeadDto, LeadQueryDto } from './dto/lead.dto';

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: any): Prisma.LeadWhereInput {
    if (isUserAdmin(user)) return {};
    if (!user?.employee?.id || user.employee.status !== 'ACTIVE') throw new ForbiddenException('Active employee profile required');
    return { OR: [{ createdById: Number(user.id) }, { assignedToId: Number(user.employee.id) }] };
  }

  private assertCanRead(lead: { createdById: number; assignedToId: number | null }, user: any) {
    this.scope(user);
    if (!isUserAdmin(user) && lead.createdById !== Number(user.id) && lead.assignedToId !== Number(user.employee.id)) {
      throw new ForbiddenException('Lead must be created by or assigned to you');
    }
  }

  async create(dto: CreateLeadDto, user: any, createdFrom: RecordCreatedFrom) {
    this.scope(user);
    const companyName = dto.companyName.trim();
    if (!companyName) throw new BadRequestException('Company name is required');
    if (!isUserAdmin(user) && dto.assignedToId && dto.assignedToId !== user.employee.id) throw new ForbiddenException('Cannot assign a Lead to another employee');
    const assignedToId = isUserAdmin(user) ? dto.assignedToId : user.employee.id;
    if (assignedToId && !await this.prisma.employee.findFirst({ where: { id: assignedToId, status: 'ACTIVE' }, select: { id: true } })) {
      throw new BadRequestException('Active assigned employee not found');
    }
    try {
      const lead = await this.prisma.lead.create({ data: {
        companyName, firstName: dto.firstName?.trim(), lastName: dto.lastName?.trim(),
        phone: dto.phone?.trim(), email: dto.email?.trim().toLowerCase(), website: dto.website?.trim(),
        address: dto.address?.trim(), city: dto.city?.trim(), state: dto.state?.trim(), country: dto.country?.trim(),
        pincode: dto.pincode?.trim(), category: dto.category?.trim(), googlePlaceId: dto.googlePlaceId?.trim() || null,
        source: dto.source?.trim() || 'MANUAL', createdFrom, status: dto.status || CrmLeadStatus.NEW,
        notes: dto.notes?.trim(), assignedToId, createdById: Number(user.id), deletedAt: null,
      } });
      this.logger.debug(`[MANUAL_LEAD_CREATE_DEBUG] ${JSON.stringify({ createdLeadId: lead.id, assignedToId: lead.assignedToId, createdById: lead.createdById, status: lead.status, source: lead.source, createdFrom: lead.createdFrom, deletedAt: lead.deletedAt, createdAt: lead.createdAt })}`);
      return lead;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A Lead already exists for this Google Place');
      throw error;
    }
  }

  async findAll(query: LeadQueryDto, user: any) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: Prisma.LeadWhereInput = { AND: [{ deletedAt: null }, this.scope(user)] };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.createdFrom) where.createdFrom = query.createdFrom;
    if (query.search?.trim()) {
      where.OR = ['companyName', 'firstName', 'lastName', 'phone', 'email'].map((field) => ({ [field]: { contains: query.search.trim(), mode: 'insensitive' } }));
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.lead.count({ where }),
    ]);
    this.logger.debug(`[LEAD_LIST_DEBUG] ${JSON.stringify({ userId: user.id, employeeId: user.employee?.id, page, limit, filtered: Boolean(query.search || query.status || query.source || query.createdFrom), total, returnedIds: data.map((lead) => lead.id) })}`);
    return { data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async findOne(id: number, user: any) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertCanRead(lead, user);
    return lead;
  }

  async importCapture(id: number, user: any, createdFrom: RecordCreatedFrom) {
    this.scope(user);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DataCapturePlace" WHERE id = ${id} FOR UPDATE`;
      const capture = await tx.dataCapturePlace.findFirst({ where: { id, deletedAt: null } });
      if (!capture) throw new NotFoundException('Data Capture record not found');
      if (String(capture.status).trim().toUpperCase() === 'REJECTED') throw new BadRequestException('Rejected records cannot be imported');
      if (capture.importedLeadId) {
        const lead = await tx.lead.findFirst({ where: { id: capture.importedLeadId, deletedAt: null } });
        if (!lead) throw new ConflictException('The linked Lead is unavailable; review this record before importing');
        this.assertCanRead(lead, user);
        return { lead, capture, alreadyImported: true };
      }
      if (String(capture.status).trim().toUpperCase() !== 'VALIDATED') throw new BadRequestException('Validate the record before importing it');
      if (capture.isImported) throw new ConflictException('This record has an unverified previous import; review it before retrying');
      const googlePlaceId = capture.googlePlaceId?.trim() || null;
      if (googlePlaceId) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${googlePlaceId}, 0))`;
      const existing = googlePlaceId ? await tx.lead.findUnique({ where: { googlePlaceId } }) : null;
      if (existing?.deletedAt) throw new ConflictException('A deleted Lead already exists for this Google Place; review it before importing');
      if (existing) this.assertCanRead(existing, user);
      const raw = capture.rawData && typeof capture.rawData === 'object' && !Array.isArray(capture.rawData) ? capture.rawData as Record<string, unknown> : {};
      const text = (field: string) => typeof raw[field] === 'string' ? (raw[field] as string).trim() || null : null;
      const components = Array.isArray(raw.addressComponents) ? raw.addressComponents : [];
      const addressPart = (type: string): string | null => {
        const component = components.find((item) => item && typeof item === 'object' && !Array.isArray(item) &&
          Array.isArray((item as Record<string, unknown>).types) && ((item as Record<string, unknown>).types as unknown[]).includes(type)) as Record<string, unknown> | undefined;
        const value = component?.longText || component?.shortText;
        return typeof value === 'string' ? value.trim() || null : null;
      };
      const lead = existing || await tx.lead.create({ data: {
        companyName: capture.businessName, firstName: text('firstName') || text('first_name'), lastName: text('lastName') || text('last_name'), phone: capture.phone, email: capture.email, website: capture.website,
        address: capture.address, city: text('city') || addressPart('locality') || addressPart('administrative_area_level_2'),
        state: text('state') || addressPart('administrative_area_level_1'), country: text('country') || addressPart('country'),
        pincode: text('pincode') || addressPart('postal_code'),
        category: capture.category, googlePlaceId, latitude: capture.latitude, longitude: capture.longitude,
        source: 'DATA_CAPTURE', createdFrom, status: CrmLeadStatus.NEW, notes: capture.notes,
        createdById: Number(user.id), assignedToId: isUserAdmin(user) ? null : Number(user.employee.id), deletedAt: null,
      } });
      const updated = await tx.dataCapturePlace.update({ where: { id }, data: { importedLeadId: lead.id, isImported: true, status: 'LEAD_CREATED' } });
      return { lead, capture: updated, alreadyImported: Boolean(existing) };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A Lead was created for this place concurrently. Retry to link the existing Lead.');
      }
      throw error;
    });
  }
}
