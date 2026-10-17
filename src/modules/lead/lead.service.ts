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
    return {
      OR: [
        { createdById: Number(user.id) },
        { assignedToId: Number(user.employee.id) },
        { assignedToId: null },
      ],
    };
  }

  private assertCanRead(lead: { createdById: number; assignedToId: number | null }, user: any) {
    this.scope(user);
    if (!isUserAdmin(user) && lead.createdById !== Number(user.id) && lead.assignedToId !== Number(user.employee.id) && lead.assignedToId !== null) {
      throw new ForbiddenException('Lead must be created by, assigned to you, or unassigned');
    }
  }

  private mapLeadWithStage<T extends { status?: any; [key: string]: any }>(lead: T) {
    const statusKey = (lead.status || 'NEW').toString();
    const stageName = statusKey === 'NEW' ? 'New' : statusKey.charAt(0) + statusKey.slice(1).toLowerCase().replace(/_/g, ' ');
    return {
      ...lead,
      stageId: 1,
      stage: {
        id: 1,
        key: statusKey,
        name: stageName,
        isDefault: statusKey === 'NEW',
        sortOrder: 1,
      },
    };
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
      return this.mapLeadWithStage(lead);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A Lead already exists for this Google Place');
      throw error;
    }
  }

  async findAll(query: LeadQueryDto, user: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const where: Prisma.LeadWhereInput = { AND: [{ deletedAt: null }, this.scope(user)] };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.createdFrom) where.createdFrom = query.createdFrom;
    if (query.search?.trim()) {
      where.OR = ['companyName', 'firstName', 'lastName', 'phone', 'email'].map((field) => ({ [field]: { contains: query.search.trim(), mode: 'insensitive' } }));
    }
    this.logger.debug(`[LEAD_LIST_WHERE] ${JSON.stringify(where)}`);
    const [rawList, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);
    const data = rawList.map((lead) => this.mapLeadWithStage(lead));
    this.logger.debug(`[LEAD_LIST_DEBUG] ${JSON.stringify({ userId: user.id, employeeId: user.employee?.id, page, limit, filtered: Boolean(query.search || query.status || query.source || query.createdFrom), total, returnedIds: data.map((lead) => lead.id) })}`);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pagination = { page, limit, total, totalPages };
    return { data, items: data, total, page, limit, totalPages, pagination, meta: pagination };
  }

  async findOne(id: number, user: any) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        dataCaptureRecords: {
          select: {
            id: true,
            businessName: true,
            status: true,
            isImported: true,
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertCanRead(lead, user);
    return this.mapLeadWithStage(lead);
  }

  async importCapture(
    id: number,
    user: any,
    createdFrom: RecordCreatedFrom,
    dto?: { assignedToId?: number; employeeId?: number },
  ) {
    this.scope(user);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DataCapturePlace" WHERE id = ${id} FOR UPDATE`;
      const capture = await tx.dataCapturePlace.findFirst({ where: { id, deletedAt: null } });
      if (!capture) throw new NotFoundException('Data Capture record not found');
      if (String(capture.status).trim().toUpperCase() === 'REJECTED') {
        throw new BadRequestException('Rejected records cannot be imported');
      }

      // Check if this record is already linked to an existing Lead
      if (capture.importedLeadId) {
        const lead = await tx.lead.findFirst({
          where: { id: capture.importedLeadId, deletedAt: null },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        });
        if (lead) {
          this.assertCanRead(lead, user);
          return { lead: this.mapLeadWithStage(lead), capture, alreadyImported: true };
        }
        throw new ConflictException('The linked Lead is unavailable; review this record before importing');
      }

      if (String(capture.status).trim().toUpperCase() !== 'VALIDATED') {
        throw new BadRequestException('Only validated records can be imported as a Lead');
      }
      if (capture.isImported) {
        throw new ConflictException('This record has an unverified previous import; review it before retrying');
      }

      const googlePlaceId = capture.googlePlaceId?.trim() || null;
      if (googlePlaceId) {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${googlePlaceId}, 0))`;
      }
      const existing = googlePlaceId
        ? await tx.lead.findUnique({
            where: { googlePlaceId },
            include: {
              assignedTo: {
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
              },
            },
          })
        : null;

      if (existing?.deletedAt) {
        throw new ConflictException('A deleted Lead already exists for this Google Place; review it before importing');
      }
      if (existing) {
        this.assertCanRead(existing, user);
        const updated = await tx.dataCapturePlace.update({
          where: { id },
          data: { importedLeadId: existing.id, isImported: true, status: 'LEAD_CREATED' },
        });
        return { lead: this.mapLeadWithStage(existing), capture: updated, alreadyImported: true };
      }

      const raw = capture.rawData && typeof capture.rawData === 'object' && !Array.isArray(capture.rawData) ? capture.rawData as Record<string, unknown> : {};
      const text = (field: string) => typeof raw[field] === 'string' ? (raw[field] as string).trim() || null : null;
      const components = Array.isArray(raw.addressComponents) ? raw.addressComponents : [];
      const addressPart = (type: string): string | null => {
        const component = components.find((item) => item && typeof item === 'object' && !Array.isArray(item) &&
          Array.isArray((item as Record<string, unknown>).types) && ((item as Record<string, unknown>).types as unknown[]).includes(type)) as Record<string, unknown> | undefined;
        const value = component?.longText || component?.shortText;
        return typeof value === 'string' ? value.trim() || null : null;
      };

      // Determine assignment
      let assignedToId: number | null = null;
      const explicitEmpId = Number(dto?.assignedToId || dto?.employeeId);
      if (!isNaN(explicitEmpId) && explicitEmpId > 0) {
        const emp = await tx.employee.findFirst({ where: { id: explicitEmpId, status: 'ACTIVE' }, select: { id: true } });
        if (emp) assignedToId = emp.id;
      } else if (!isUserAdmin(user) && user?.employee?.id) {
        assignedToId = Number(user.employee.id);
      }

      const lead = await tx.lead.create({
        data: {
          companyName: capture.businessName,
          firstName: text('firstName') || text('first_name'),
          lastName: text('lastName') || text('last_name'),
          phone: capture.phone,
          email: capture.email,
          website: capture.website,
          address: capture.address,
          city: text('city') || addressPart('locality') || addressPart('administrative_area_level_2'),
          state: text('state') || addressPart('administrative_area_level_1'),
          country: text('country') || addressPart('country'),
          pincode: text('pincode') || addressPart('postal_code'),
          category: capture.category,
          googlePlaceId,
          latitude: capture.latitude,
          longitude: capture.longitude,
          source: 'DATA_CAPTURE',
          createdFrom,
          status: CrmLeadStatus.NEW,
          notes: capture.notes,
          createdById: Number(user.id),
          assignedToId,
          deletedAt: null,
        },
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
        },
      });

      const updated = await tx.dataCapturePlace.update({
        where: { id },
        data: { importedLeadId: lead.id, isImported: true, status: 'LEAD_CREATED' },
      });

      return { lead: this.mapLeadWithStage(lead), capture: updated, alreadyImported: false };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A Lead was created for this place concurrently. Retry to link the existing Lead.');
      }
      throw error;
    });
  }

  async importMultipleCaptures(
    dto: { jobId?: string; placeIds?: (string | number)[]; assignedToId?: number; employeeId?: number },
    user: any,
    createdFrom: RecordCreatedFrom,
  ) {
    this.scope(user);
    let targetIds: number[] = [];
    if (Array.isArray(dto?.placeIds) && dto.placeIds.length > 0) {
      targetIds = dto.placeIds.map((p) => Number(p)).filter((n) => !isNaN(n) && n > 0);
    } else if (dto?.jobId) {
      const places = await this.prisma.dataCapturePlace.findMany({
        where: { jobId: dto.jobId, deletedAt: null },
        select: { id: true },
      });
      targetIds = places.map((p) => p.id);
    }
    if (targetIds.length === 0) {
      throw new BadRequestException('No place IDs or job ID provided for import');
    }

    const records: Array<{
      sourceRecordId: string;
      googlePlaceId: string | null;
      businessName: string;
      imported: boolean;
      duplicate: boolean;
      leadId: number | null;
      duplicateMatchReason?: string;
    }> = [];

    let importedCount = 0;
    let duplicateCount = 0;

    for (const placeId of targetIds) {
      try {
        const res = await this.importCapture(placeId, user, createdFrom, dto);
        const isDup = Boolean(res.alreadyImported);
        if (isDup) duplicateCount++;
        else importedCount++;

        records.push({
          sourceRecordId: String(placeId),
          googlePlaceId: res.lead.googlePlaceId ?? null,
          businessName: res.lead.companyName,
          imported: !isDup,
          duplicate: isDup,
          leadId: res.lead.id,
          duplicateMatchReason: isDup ? 'Lead already exists in CRM' : undefined,
        });
      } catch (err: any) {
        this.logger.warn(`Failed to import capture place ${placeId}: ${err?.message}`);
        records.push({
          sourceRecordId: String(placeId),
          googlePlaceId: null,
          businessName: '',
          imported: false,
          duplicate: true,
          leadId: null,
          duplicateMatchReason: err?.message || 'Import failed',
        });
      }
    }

    return {
      success: true,
      message: `Imported ${importedCount} leads (${duplicateCount} existing/duplicate)`,
      records,
      importedCount,
      duplicateCount,
      totalCount: records.length,
      data: {
        records,
        importedCount,
        duplicateCount,
        totalCount: records.length,
      },
    };
  }
}
