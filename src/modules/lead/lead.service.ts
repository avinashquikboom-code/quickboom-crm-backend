import { convertWonLead, deleteCustomersForLeads } from '../customer/customer-lifecycle.util';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CrmLeadStatus, RecordCreatedFrom } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserAdmin } from '../../common/utils/account.util';
import { CreateLeadDto, LeadQueryDto, UpdateLeadDto, UpdateLeadStageDto } from './dto/lead.dto';

export interface LeadStageConfig {
  id: number;
  key: string;
  name: string;
  sortOrder: number;
  color: string;
  bgColor: string;
  borderColor: string;
  isActive: boolean;
  isDefault: boolean;
}

export const CRM_LEAD_STAGES: LeadStageConfig[] = [
  { id: 1, key: 'NEW', name: 'New', sortOrder: 1, color: '#0284C7', bgColor: '#E0F2FE', borderColor: '#BAE6FD', isActive: true, isDefault: true },
  { id: 2, key: 'CONTACTED', name: 'Contacted', sortOrder: 2, color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A', isActive: true, isDefault: false },
  { id: 3, key: 'DETAILS_SEND', name: 'Details send', sortOrder: 3, color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#C7D2FE', isActive: true, isDefault: false },
  { id: 4, key: 'FOLLOW_UP', name: 'Follow-up', sortOrder: 4, color: '#7C3AED', bgColor: '#F5F3FF', borderColor: '#DDD6FE', isActive: true, isDefault: false },
  { id: 5, key: 'VISIT_SCHEDULED', name: 'Visit Scheduled', sortOrder: 5, color: '#0891B2', bgColor: '#ECFEFF', borderColor: '#A5F3FC', isActive: true, isDefault: false },
  { id: 6, key: 'VISIT_DONE', name: 'Visit Done', sortOrder: 6, color: '#0D9488', bgColor: '#F0FDFA', borderColor: '#99F6E4', isActive: true, isDefault: false },
  { id: 7, key: 'PROPOSAL_SENT', name: 'Proposal Sent', sortOrder: 7, color: '#2563EB', bgColor: '#EFF6FF', borderColor: '#BFDBFE', isActive: true, isDefault: false },
  { id: 8, key: 'NEGOTIATION', name: 'Negotiation', sortOrder: 8, color: '#F59E0B', bgColor: '#FFFBEB', borderColor: '#FDE68A', isActive: true, isDefault: false },
  { id: 9, key: 'FINAL_CALL', name: 'Final Call', sortOrder: 9, color: '#EA580C', bgColor: '#FFF7ED', borderColor: '#FFEDD5', isActive: true, isDefault: false },
  { id: 10, key: 'WON', name: 'Won', sortOrder: 10, color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0', isActive: true, isDefault: false },
  { id: 11, key: 'LOST', name: 'Lost', sortOrder: 11, color: '#DC2626', bgColor: '#FFE4E6', borderColor: '#FECDD3', isActive: true, isDefault: false },
];

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
    if (!isUserAdmin(user) && lead.createdById !== Number(user.id) && lead.assignedToId !== Number(user?.employee?.id) && lead.assignedToId !== null) {
      throw new ForbiddenException('Lead must be created by, assigned to you, or unassigned');
    }
  }

  resolveStage(identifier: string | number | undefined | null): LeadStageConfig {
    if (typeof identifier === 'number') {
      const byId = CRM_LEAD_STAGES.find((s) => s.id === identifier);
      if (byId) return byId;
    }
    const cleanKey = String(identifier || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    // Canonical key lookup
    const directMatch = CRM_LEAD_STAGES.find((s) => s.key === cleanKey);
    if (directMatch) return directMatch;

    // Common aliases & backwards compatibility
    if (cleanKey === 'DETAILS_SENT' || cleanKey === 'COMPANY_DETAILS_SENT') return CRM_LEAD_STAGES[2]; // DETAILS_SEND
    if (cleanKey === 'VISIT' || cleanKey === 'VISIT_PENDING') return CRM_LEAD_STAGES[4]; // VISIT_SCHEDULED
    if (cleanKey === 'VISIT_COMPLETED') return CRM_LEAD_STAGES[5]; // VISIT_DONE
    if (cleanKey === 'PROPOSAL') return CRM_LEAD_STAGES[6]; // PROPOSAL_SENT
    if (cleanKey === 'FINAL_DISCUSSION') return CRM_LEAD_STAGES[8]; // FINAL_CALL
    if (cleanKey === 'CONVERTED' || cleanKey === 'CLOSED_WON' || cleanKey === 'DEAL_WON') return CRM_LEAD_STAGES[9]; // WON
    if (cleanKey === 'CANCELLED' || cleanKey === 'CLOSED_LOST' || cleanKey === 'DEAL_LOST') return CRM_LEAD_STAGES[10]; // LOST
    if (cleanKey === 'QUALIFIED') return CRM_LEAD_STAGES[3]; // FOLLOW_UP

    return CRM_LEAD_STAGES[0]; // Default: NEW
  }

  getStages(user?: any): LeadStageConfig[] {
    if (user !== undefined) this.scope(user);
    return CRM_LEAD_STAGES;
  }

  private mapLeadWithStage<T extends { status?: any; [key: string]: any }>(lead: T) {
    const stage = this.resolveStage(lead.status);
    return {
      ...lead,
      stageId: stage.id,
      stage,
    };
  }

  async create(dto: CreateLeadDto, user: any, createdFrom: RecordCreatedFrom) {
    this.scope(user);
    const companyName = dto.companyName.trim();
    if (!companyName) throw new BadRequestException("Company name is required");
    if (
      !isUserAdmin(user) &&
      dto.assignedToId &&
      dto.assignedToId !== user?.employee?.id
    )
      throw new ForbiddenException("Cannot assign a Lead to another employee");
    const assignedToId = isUserAdmin(user)
      ? dto.assignedToId
      : user?.employee?.id;
    if (
      assignedToId &&
      !(await this.prisma.employee.findFirst({
        where: { id: assignedToId, status: "ACTIVE" },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Active assigned employee not found");
    }
    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            companyName,
            firstName: dto.firstName?.trim(),
            lastName: dto.lastName?.trim(),
            phone: dto.phone?.trim(),
            email: dto.email?.trim().toLowerCase(),
            website: dto.website?.trim(),
            address: dto.address?.trim(),
            city: dto.city?.trim(),
            state: dto.state?.trim(),
            country: dto.country?.trim(),
            pincode: dto.pincode?.trim(),
            category: dto.category?.trim(),
            googlePlaceId: dto.googlePlaceId?.trim() || null,
            source: dto.source?.trim() || "MANUAL",
            createdFrom,
            status: dto.status || CrmLeadStatus.NEW,
            notes: dto.notes?.trim(),
            assignedToId,
            createdById: Number(user.id),
            deletedAt: null,
          },
        });
        await convertWonLead(tx, lead);
        return lead;
      });
      this.logger.debug(
        `[MANUAL_LEAD_CREATE_DEBUG] ${JSON.stringify({ createdLeadId: lead.id, assignedToId: lead.assignedToId, createdById: lead.createdById, status: lead.status, source: lead.source, createdFrom: lead.createdFrom, deletedAt: lead.deletedAt, createdAt: lead.createdAt })}`,
      );
      return this.mapLeadWithStage(lead);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "A Lead already exists for this Google Place",
        );
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

  async updateStage(id: number, dto: UpdateLeadStageDto, user: any) {
    const existing = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`Lead with ID ${id} not found`);
    this.assertCanRead(existing, user);

    const identifiers = [dto.stageId, dto.status, dto.stage].filter(
      (value) => value !== undefined && value !== null,
    );
    const matches = identifiers.map((value) =>
      CRM_LEAD_STAGES.find((stage) =>
        typeof value === "number"
          ? stage.id === value
          : stage.key === String(value).trim().toUpperCase(),
      ),
    );
    if (
      !matches.length ||
      matches.some((stage) => !stage || !stage.isActive) ||
      matches.some((stage) => stage.key !== matches[0].key)
    ) {
      throw new BadRequestException(
        "Provide a valid, active pipeline stage with matching stageId and status key",
      );
    }
    const targetStage = matches[0];
    const runInTx = this.prisma.$transaction
      ? (fn: (tx: any) => Promise<any>) => this.prisma.$transaction(fn)
      : (fn: (tx: any) => Promise<any>) => fn(this.prisma);

    const updated = await runInTx(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          status: targetStage.key as CrmLeadStatus,
          notes: dto.notes
            ? existing.notes
              ? `${existing.notes}\n${dto.notes.trim()}`
              : dto.notes.trim()
            : existing.notes,
        },
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
      });
      await convertWonLead(tx, updated);
      return updated;
    });

    this.logger.debug(
      `[LEAD_STAGE_UPDATE] leadId=${id} oldStatus=${existing.status} newStatus=${updated.status} stageId=${targetStage.id}`,
    );
    return this.mapLeadWithStage(updated);
  }

  async update(id: number, dto: UpdateLeadDto, user: any) {
    const existing = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`Lead with ID ${id} not found`);
    this.assertCanRead(existing, user);

    const data: Prisma.LeadUpdateInput = {};
    if (dto.companyName !== undefined) {
      const trimmed = dto.companyName.trim();
      if (!trimmed) throw new BadRequestException('Company/Business name cannot be empty');
      data.companyName = trimmed;
    }
    if (dto.firstName !== undefined)
      data.firstName = dto.firstName?.trim() || null;
    if (dto.lastName !== undefined)
      data.lastName = dto.lastName?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.email !== undefined)
      data.email = dto.email?.trim().toLowerCase() || null;
    if (dto.website !== undefined) data.website = dto.website?.trim() || null;
    if (dto.address !== undefined) data.address = dto.address?.trim() || null;
    if (dto.city !== undefined) data.city = dto.city?.trim() || null;
    if (dto.state !== undefined) data.state = dto.state?.trim() || null;
    if (dto.country !== undefined) data.country = dto.country?.trim() || null;
    if (dto.pincode !== undefined) data.pincode = dto.pincode?.trim() || null;
    if (dto.category !== undefined)
      data.category = dto.category?.trim() || null;
    if (dto.source !== undefined)
      data.source = dto.source?.trim() || existing.source;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    if (dto.status || dto.stageId || dto.stage) {
      const targetStage = this.resolveStage(
        dto.stageId ?? dto.status ?? dto.stage,
      );
      data.status = targetStage.key as CrmLeadStatus;
    }

    if (dto.assignedToId !== undefined) {
      if (!isUserAdmin(user) && dto.assignedToId !== user.employee?.id) {
        throw new ForbiddenException(
          "Cannot assign a Lead to another employee",
        );
      }
      if (
        dto.assignedToId &&
        !(await this.prisma.employee.findFirst({
          where: { id: dto.assignedToId, status: "ACTIVE" },
          select: { id: true },
        }))
      ) {
        throw new BadRequestException("Active assigned employee not found");
      }
      data.assignedTo = dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : { disconnect: true };
    }

    const runInTx = this.prisma.$transaction
      ? (fn: (tx: any) => Promise<any>) => this.prisma.$transaction(fn)
      : (fn: (tx: any) => Promise<any>) => fn(this.prisma);

    const updated = await runInTx(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data,
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
      });
      await convertWonLead(tx, updated);
      return updated;
    });

    return this.mapLeadWithStage(updated);
  }

  async remove(id: number, user: any) {
    this.scope(user);
    const existing = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`Lead with ID ${id} not found`);
    this.assertCanRead(existing, user);

    const now = new Date();
    const runInTx = this.prisma.$transaction
      ? (fn: (tx: any) => Promise<any>) => this.prisma.$transaction(fn)
      : (fn: (tx: any) => Promise<any>) => fn(this.prisma);

    await runInTx(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: { deletedAt: now },
      });
      await deleteCustomersForLeads(tx, [id], now);
    });

    this.logger.debug(`[LEAD_DELETE] leadId=${id} deletedBy=${user.id}`);
    return { success: true, message: 'Lead deleted successfully', id };
  }

  async removeMany(ids: number[], user: any) {
    this.scope(user);
    if (!Array.isArray(ids) || !ids.length) {
      throw new BadRequestException('At least one Lead ID must be provided');
    }
    const validIds = ids.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    if (!validIds.length) {
      throw new BadRequestException('Invalid Lead IDs');
    }

    const where: Prisma.LeadWhereInput = {
      AND: [
        { id: { in: validIds } },
        { deletedAt: null },
        this.scope(user),
      ],
    };

    if (!isUserAdmin(user)) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : [where.AND]),
        {
          OR: [
            { createdById: Number(user.id) },
            ...(user?.employee?.id ? [{ assignedToId: Number(user.employee.id) }] : []),
            { assignedToId: null },
          ],
        },
      ];
    }

    const now = new Date();
    const runInTx = this.prisma.$transaction
      ? (fn: (tx: any) => Promise<any>) => this.prisma.$transaction(fn)
      : (fn: (tx: any) => Promise<any>) => fn(this.prisma);

    const result = await runInTx(async (tx) => {
      const res = await tx.lead.updateMany({
        where,
        data: { deletedAt: now },
      });
      await deleteCustomersForLeads(tx, validIds, now);
      return res;
    });

    this.logger.debug(`[LEAD_BULK_DELETE] requested=${validIds.length} deleted=${result.count} deletedBy=${user.id}`);
    return {
      success: true,
      message: `Successfully deleted ${result.count} lead${result.count === 1 ? '' : 's'}`,
      count: result.count,
    };
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
          data: { importedLeadId: existing.id, isImported: true, status: 'LEAD_IMPORTED' },
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
      if (!isUserAdmin(user) && explicitEmpId > 0 && explicitEmpId !== Number(user?.employee?.id)) {
        throw new ForbiddenException('Cannot assign a Lead to another employee');
      }
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
        data: { importedLeadId: lead.id, isImported: true, status: 'LEAD_IMPORTED' },
      });

      return { lead: this.mapLeadWithStage(lead), capture: updated, alreadyImported: false };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A Lead was created for this place concurrently. Retry to link the existing Lead.');
      }
      throw error;
    });
  }

  async importSelectedCaptures(ids: number[], user: any, createdFrom: RecordCreatedFrom) {
    return this.importMultipleCaptures({ ids }, user, createdFrom);
  }

  async importMultipleCaptures(
    dto: { jobId?: string; placeIds?: (string | number)[]; ids?: (string | number)[]; assignedToId?: number; employeeId?: number },
    user: any,
    createdFrom: RecordCreatedFrom,
  ) {
    this.scope(user);
    let targetIds: number[] = [];
    const rawIds = dto?.ids || dto?.placeIds;
    if (Array.isArray(rawIds) && rawIds.length > 0) {
      targetIds = rawIds.map((p) => Number(p)).filter((n) => !isNaN(n) && n > 0);
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

    const uniqueIds = Array.from(new Set(targetIds));

    const imported: Array<{ captureId: number; leadId: number; businessName?: string }> = [];
    const alreadyImported: Array<{ captureId: number; leadId: number; businessName?: string }> = [];
    const skipped: Array<{ captureId: number; reason: string }> = [];
    const failed: Array<{ captureId: number; reason: string }> = [];
    const records: Array<{
      sourceRecordId: string;
      googlePlaceId: string | null;
      businessName: string;
      imported: boolean;
      duplicate: boolean;
      leadId: number | null;
      duplicateMatchReason?: string;
    }> = [];

    for (const placeId of uniqueIds) {
      try {
        const res = await this.importCapture(placeId, user, createdFrom, dto);
        const isDup = Boolean(res.alreadyImported);
        const entry = { captureId: placeId, leadId: res.lead.id };
        if (isDup) {
          alreadyImported.push(entry);
        } else {
          imported.push(entry);
        }
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
        const reason = err?.message || 'Import failed';
        const entry = { captureId: placeId, reason };
        if (err instanceof BadRequestException || err instanceof NotFoundException) {
          skipped.push(entry);
        } else {
          failed.push(entry);
        }
        records.push({
          sourceRecordId: String(placeId),
          googlePlaceId: null,
          businessName: '',
          imported: false,
          duplicate: false,
          leadId: null,
          duplicateMatchReason: reason,
        });
      }
    }

    const payload = {
      imported,
      alreadyImported,
      skipped,
      failed,
      records,
      importedCount: imported.length,
      alreadyImportedCount: alreadyImported.length,
      duplicateCount: alreadyImported.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      totalCount: uniqueIds.length,
    };

    return {
      success: true,
      message: `Imported ${imported.length} leads (${alreadyImported.length} already imported, ${skipped.length} skipped, ${failed.length} failed)`,
      ...payload,
      data: payload,
    };
  }
}
