import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CheckDuplicateDto,
  ConvertLeadDto,
  CreateLeadDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  StartWorkDto,
  UpdateLeadDto,
  normalizeLeadStatus,
} from './dto/lead.dto';
import { LeadStatus, Prisma } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class LeadRepository {
  constructor(private prisma: PrismaService) {}

  async create(
    customerId: number | string,
    createdById: number | string,
    dto: CreateLeadDto,
    employeeId?: number | null,
    prismaClient?: any,
  ) {
    const client = prismaClient || this.prisma;
    const numCustomerId = Number(customerId);
    const numCreatedById = Number(createdById);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);
    let status: LeadStatus = LeadStatus.NEW;
    let stageId = dto.stageId ? Number(dto.stageId) : undefined;

    if (stageId && client.leadStage) {
      const stage = await client.leadStage.findUnique({
        where: { id: stageId },
      });
      if (stage) {
        const normKey = normalizeLeadStatus(stage.key);
        if (ALL_LEAD_STATUSES.includes(normKey)) {
          status = normKey as LeadStatus;
        } else if (dto.status) {
          const normDto = normalizeLeadStatus(dto.status);
          if (ALL_LEAD_STATUSES.includes(normDto)) {
            status = normDto as LeadStatus;
          }
        }
      }
    } else if (dto.status) {
      const norm = normalizeLeadStatus(dto.status);
      if (ALL_LEAD_STATUSES.includes(norm)) {
        status = norm as LeadStatus;
      }
    }

    if (!stageId && client.leadStage) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        try {
          await this.ensureDefaultStagesForCustomer(numCustomerId);
        } catch (_) {}
      }
      const matchStage = await client.leadStage.findFirst({
        where: {
          key: status,
          deletedAt: null,
          OR: [
            ...(!isNaN(numCustomerId) && numCustomerId > 0 ? [{ customerId: numCustomerId }] : []),
            { customerId: null },
          ],
        },
        orderBy: { customerId: 'desc' },
      });
      if (matchStage) stageId = matchStage.id;
    }

    const {
      notes,
      location,
      first_name,
      last_name,
      name,
      full_name,
      mobile,
      mobileNumber,
      phoneNumber,
      phone_number,
      contactNumber,
      user_phone,
      user_phone_number,
      emailAddress,
      email_address,
      user_email,
      postalCode,
      zipCode,
      pinCode,
      pin_code,
      stage: rawStageArg,
      stage_name: rawStageNameArg,
      lead_stage: rawLeadStageArg,
      user_column_data: rawUserColArg,
      column_data: rawColDataArg,
      form_data: rawFormDataArg,
      fields: rawFieldsArg,
      google_key: rawGoogleKeyArg,
      lead_id: rawLeadIdArg,
      place_id: rawPlaceIdArg,
      lead_data: rawLeadDataArg,
      google_lead: rawGoogleLeadArg,
      data: rawNestedDataArg,
      ...leadData
    } = dto as any;
    const resolvedCity = (leadData.city || location || '').trim() || null;
    const rawPin = leadData.pincode ?? postalCode ?? zipCode ?? pinCode ?? pin_code;
    const resolvedPincode = rawPin && String(rawPin).trim() !== 'N/A' && String(rawPin).trim() !== 'null' ? String(rawPin).trim() : null;
    const resolvedFirstName = leadData.firstName !== undefined && leadData.firstName !== null ? String(leadData.firstName).trim() : '';
    const resolvedLastName = leadData.lastName !== undefined && leadData.lastName !== null ? String(leadData.lastName).trim() : '';
    const resolvedPhone = leadData.phone ? String(leadData.phone).trim() : undefined;
    const resolvedEmail = leadData.email ? String(leadData.email).trim().toLowerCase() : undefined;

    const createData: any = {
      ...leadData,
      city: resolvedCity,
      pincode: resolvedPincode,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
      status,
      stageId,
      customerId: numCustomerId,
      createdById: numCreatedById,
      employeeId: employeeId ? Number(employeeId) : undefined,
    };
    if (resolvedPhone) {
      createData.phone = resolvedPhone;
    } else {
      delete createData.phone;
    }
    if (resolvedEmail) {
      createData.email = resolvedEmail;
    } else {
      delete createData.email;
    }
    delete createData.sourceUrl;

    const lead = await client.lead.create({
      data: createData,
      include: {
        stage: true,
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (notes) {
      await client.leadNote.create({
        data: {
          leadId: lead.id,
          userId: numCreatedById,
          content: notes,
        },
      });
    }

    // Record initial status history
    await client.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        fromStatus: null,
        toStatus: status,
        changedById: numCreatedById,
        notes: `Lead created via ${dto.source || 'WEBSITE'}`,
      },
    });

    return lead;
  }

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateDto) {
    const numCustomerId = Number(customerId);
    const placeId = (dto.googlePlaceId || '').trim();
    const normPhone = (dto.phone || '').replace(/\D/g, '');
    const cleanCompany = (dto.companyName || '').toLowerCase().trim();
    const cleanWebsite = (dto.website || '').toLowerCase().trim().replace(/^https?:\/\//, '');
    const cleanEmail = (dto.email || '').toLowerCase().trim();

    if (placeId) {
      const placeMatch = await this.prisma.lead.findFirst({
        where: { customerId: numCustomerId, googlePlaceId: placeId, deletedAt: null },
        select: {
          id: true,
          title: true,
          companyName: true,
          firstName: true,
          lastName: true,
          phone: true,
          website: true,
          googlePlaceId: true,
          status: true,
          createdAt: true,
        },
      });
      if (placeMatch) {
        return {
          isDuplicate: true,
          matchReason: 'Google Place ID match',
          existingLead: placeMatch,
        };
      }
    }

    const orClauses: Prisma.LeadWhereInput[] = [];

    if (placeId) {
      orClauses.push({ googlePlaceId: placeId });
    }
    if (normPhone.length >= 10) {
      orClauses.push({ phone: { contains: normPhone.slice(-10) } });
      if (dto.phone && dto.phone.trim()) {
        orClauses.push({ phone: dto.phone.trim() });
      }
    }
    if (cleanEmail.length >= 5 && cleanEmail.includes('@')) {
      orClauses.push({ email: { equals: cleanEmail, mode: 'insensitive' } });
    }
    if (cleanWebsite.length >= 4) {
      orClauses.push({ website: { contains: cleanWebsite, mode: 'insensitive' } });
    }

    if (orClauses.length === 0) {
      return { isDuplicate: false, matchReason: null, existingLead: null };
    }

    const candidates = await this.prisma.lead.findMany({
      where: {
        customerId: numCustomerId,
        deletedAt: null,
        OR: orClauses,
      },
      take: 20,
      select: {
        id: true,
        title: true,
        companyName: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        website: true,
        googlePlaceId: true,
        status: true,
        createdAt: true,
      },
    });

    for (const lead of candidates) {
      const leadPhone = (lead.phone || '').replace(/\D/g, '');
      const leadWebsite = (lead.website || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const leadEmail = (lead.email || '').toLowerCase().trim();

      const isPlaceMatch = Boolean(placeId && lead.googlePlaceId && lead.googlePlaceId === placeId);
      const isPhoneMatch = Boolean(
        normPhone.length >= 10 &&
        leadPhone.length >= 10 &&
        normPhone.slice(-10) === leadPhone.slice(-10),
      );
      const isEmailMatch = Boolean(
        cleanEmail.length >= 5 &&
        cleanEmail.includes('@') &&
        leadEmail &&
        leadEmail === cleanEmail,
      );
      const isWebsiteMatch = Boolean(
        cleanWebsite.length >= 4 &&
        leadWebsite &&
        (leadWebsite === cleanWebsite || leadWebsite.includes(cleanWebsite) || cleanWebsite.includes(leadWebsite)),
      );

      if (isPlaceMatch || isPhoneMatch || isEmailMatch || isWebsiteMatch) {
        return {
          isDuplicate: true,
          matchReason: isPlaceMatch
            ? 'Google Place ID match'
            : isPhoneMatch
            ? 'Phone number match'
            : isEmailMatch
            ? 'Email address match'
            : 'Website match',
          existingLead: lead,
        };
      }
    }

    return {
      isDuplicate: false,
      matchReason: null,
      existingLead: null,
    };
  }

  async getSummaryMetrics(customerId: number | string | undefined, user?: any) {
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

    const [total, newCount, contacted, qualified, converted, lost] = await Promise.all([
      this.prisma.lead.count({ where: { ...baseWhere } }),
      this.prisma.lead.count({ where: { ...baseWhere, status: 'NEW' } }),
      this.prisma.lead.count({ where: { ...baseWhere, status: 'CONTACTED' } }),
      this.prisma.lead.count({ where: { ...baseWhere, status: 'QUALIFIED' } }),
      this.prisma.lead.count({
        where: {
          ...baseWhere,
          status: { in: [LeadStatus.CONVERTED, LeadStatus.WON] },
        },
      }),
      this.prisma.lead.count({ where: { ...baseWhere, status: 'LOST' } }),
    ]);

    return {
      total,
      new: newCount,
      contacted,
      qualified,
      converted,
      lost,
    };
  }

  async convertLead(customerId: number | string, leadId: number | string, userId: number | string, dto: ConvertLeadDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);

    const lead = await this.prisma.lead.findFirst({
      where: { id: numLeadId, customerId: numCustomerId, deletedAt: null },
    });

    if (!lead) {
      throw new Error(`Lead with ID ${leadId} not found`);
    }

    if (lead.status === LeadStatus.CONVERTED || lead.status === LeadStatus.WON) {
      return {
        alreadyConverted: true,
        message: 'Lead is already converted',
        lead,
      };
    }

    const companyName = (dto.companyName || lead.companyName || lead.title || 'Client Company').trim();

    // 1. Find or create Company
    let company = await this.prisma.company.findFirst({
      where: { customerId: numCustomerId, name: { equals: companyName, mode: 'insensitive' }, deletedAt: null },
    });

    if (!company) {
      company = await this.prisma.company.create({
        data: {
          customerId: numCustomerId,
          name: companyName,
          domain: lead.website ? lead.website.replace(/^https?:\/\//, '') : undefined,
          phone: lead.phone,
          email: lead.email,
          address: lead.address,
          city: lead.city,
          country: lead.country,
        },
      });
    }

    // 2. Find or create Contact
    let contact = await this.prisma.contact.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [
          lead.email ? { email: lead.email } : undefined,
          lead.phone ? { phone: lead.phone } : undefined,
        ].filter(Boolean) as any,
        deletedAt: null,
      },
    });

    if (!contact) {
      contact = await this.prisma.contact.create({
        data: {
          customerId: numCustomerId,
          companyId: company.id,
          firstName: lead.firstName || 'Primary',
          lastName: lead.lastName || 'Contact',
          email: lead.email,
          phone: lead.phone,
          type: 'CUSTOMER',
          notes: `Converted from Lead #${lead.id} (${lead.title})`,
        },
      });
    }

    // 3. Create Deal in Default Pipeline
    let pipeline: any = await this.prisma.pipeline.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      include: { stages: { orderBy: { order: 'asc' } } },
    });

    if (!pipeline) {
      pipeline = await this.prisma.pipeline.create({
        data: {
          customerId: numCustomerId,
          name: 'Sales Pipeline',
          stages: {
            create: [
              { name: 'Lead Qualified', order: 1, probability: 25 },
              { name: 'Proposal', order: 2, probability: 50 },
              { name: 'Negotiation', order: 3, probability: 75 },
              { name: 'Won', order: 4, probability: 100 },
            ],
          },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    }

    const defaultStageId = pipeline.stages[0]?.id;
    const dealTitle = (dto.dealTitle || `${companyName} - Enterprise Deal`).trim();
    const dealValue = dto.dealValue !== undefined ? Number(dto.dealValue) : (lead.value || 0);

    let deal: any = null;
    if (defaultStageId) {
      deal = await this.prisma.deal.create({
        data: {
          customerId: numCustomerId,
          pipelineId: pipeline.id,
          stageId: defaultStageId,
          companyId: company.id,
          contactId: contact.id,
          title: dealTitle,
          amount: dealValue,
          probability: 75,
        },
      });
    }

    // 4. Update Lead to CONVERTED
    const updatedLead = await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        status: LeadStatus.CONVERTED,
        convertedAt: new Date(),
        convertedToCompanyId: company.id,
        convertedToContactId: contact.id,
        convertedToDealId: deal ? deal.id : undefined,
      },
    });

    // 5. Log status history & timeline
    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numLeadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.CONVERTED,
        changedById: numUserId,
        notes: dto.notes || `Lead successfully converted to Customer/Company "${company.name}" (Deal: "${dealTitle}" - ₹${dealValue.toLocaleString('en-IN')})`,
      },
    });

    await this.logTimeline(
      numLeadId,
      'LEAD_CONVERTED',
      `Lead converted to Customer Account "${company.name}" & Deal "${dealTitle}"`,
      {
        companyId: company.id,
        companyName: company.name,
        contactId: contact.id,
        dealId: deal?.id,
        dealValue,
        notes: dto.notes,
      },
    );

    return {
      success: true,
      message: 'Lead converted successfully.',
      lead: updatedLead,
      company,
      contact,
      deal,
    };
  }

  async findAll(
    customerId: number | string | undefined,
    options: { page?: number; limit?: number; search?: string; status?: string; stageId?: string | number; assignedToId?: string | number },
    user?: any,
  ) {
    const numCustomerId = Number(customerId ?? user?.customerId);
    const isSuperAdmin = isUserSuperAdmin(user);

    const page = Math.max(Number(options.page) || 1, 1);
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      } else {
        where.customerId = 0;
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    if (options.stageId && options.stageId !== 'ALL' && !isNaN(Number(options.stageId))) {
      where.stageId = Number(options.stageId);
    } else if (options.status && options.status.toUpperCase() !== 'ALL') {
      const statusStr = String(options.status).trim();
      if (!isNaN(Number(statusStr))) {
        where.stageId = Number(statusStr);
      } else {
        const normStatus = normalizeLeadStatus(statusStr);
        if (ALL_LEAD_STATUSES.includes(normStatus)) {
          where.status = normStatus as LeadStatus;
        } else {
          // Custom stage key or label
          const matchStage = await this.prisma.leadStage.findFirst({
            where: {
              OR: [
                { key: statusStr },
                { name: { equals: statusStr, mode: 'insensitive' } },
              ],
              deletedAt: null,
              ...(where.customerId ? { customerId: where.customerId } : {}),
            },
          });
          if (matchStage) {
            where.stageId = matchStage.id;
          } else {
            where.stage = { name: { equals: statusStr, mode: 'insensitive' } };
          }
        }
      }
    }

    if (options.assignedToId && options.assignedToId !== 'ALL' && !isNaN(Number(options.assignedToId))) {
      where.assignedToId = Number(options.assignedToId);
    }

    if (options.search && options.search.trim()) {
      const s = options.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { companyName: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          stage: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          images: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    if (isNaN(numId) || numId <= 0) {
      return null;
    }

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    return this.prisma.lead.findFirst({
      where,
      include: {
        customer: true,
        stage: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        timeline: { orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        reminders: { orderBy: { remindAt: 'asc' } },
        visits: { orderBy: { createdAt: 'desc' } },
        quotations: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        },
        images: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async update(customerId: number | string, id: number | string, dto: UpdateLeadDto & { employeeId?: number | null }) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const {
      notes,
      location,
      first_name,
      last_name,
      name,
      mobile,
      mobileNumber,
      phoneNumber,
      contactNumber,
      emailAddress,
      postalCode,
      zipCode,
      pinCode,
      pin_code,
      ...leadData
    } = dto as any;
    const updateData: any = {
      ...leadData,
      assignedToId: dto.assignedToId !== undefined
        ? (dto.assignedToId ? Number(dto.assignedToId) : null)
        : undefined,
      ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
    };

    if (leadData.city !== undefined || location !== undefined) {
      const c = (leadData.city || location || '').trim();
      updateData.city = c ? c : null;
    }
    if (leadData.pincode !== undefined || postalCode !== undefined || zipCode !== undefined || pinCode !== undefined || pin_code !== undefined) {
      const pinRaw = leadData.pincode ?? postalCode ?? zipCode ?? pinCode ?? pin_code;
      const p = pinRaw ? String(pinRaw).trim() : '';
      updateData.pincode = (p && p !== 'N/A' && p !== 'null' && p !== 'undefined') ? p : null;
    }
    if (updateData.workNotes === undefined && notes !== undefined) {
      const n = notes ? String(notes).trim() : '';
      updateData.workNotes = (n && n !== 'N/A' && n !== 'null' && n !== 'undefined') ? n : null;
    }
    if (leadData.firstName !== undefined) {
      const fn = leadData.firstName ? String(leadData.firstName).trim() : '';
      if (fn) {
        updateData.firstName = fn;
      } else {
        delete updateData.firstName;
      }
    }
    if (leadData.lastName !== undefined) {
      const ln = leadData.lastName ? String(leadData.lastName).trim() : '';
      if (ln) {
        updateData.lastName = ln;
      } else {
        delete updateData.lastName;
      }
    }
    if (leadData.phone !== undefined) {
      const ph = leadData.phone ? String(leadData.phone).trim() : '';
      if (ph && ph !== 'N/A' && ph !== 'null' && ph !== 'undefined') {
        updateData.phone = ph;
      } else {
        delete updateData.phone;
      }
    }
    if (leadData.email !== undefined) {
      const em = leadData.email ? String(leadData.email).trim().toLowerCase() : '';
      if (em && em !== 'null' && em !== 'undefined') {
        updateData.email = em;
      } else {
        delete updateData.email;
      }
    }

    if (
      leadData.socialMedia !== undefined ||
      leadData.instagram !== undefined ||
      leadData.facebook !== undefined ||
      leadData.linkedin !== undefined ||
      leadData.youtube !== undefined ||
      leadData.twitter !== undefined
    ) {
      const existing = await this.prisma.lead.findUnique({
        where: { id: numId },
        select: { socialMedia: true },
      });
      const current = (existing?.socialMedia as Record<string, any>) || {};
      const incoming = typeof leadData.socialMedia === 'object' && leadData.socialMedia !== null ? leadData.socialMedia : {};
      const merged = {
        ...current,
        ...incoming,
        ...(leadData.instagram !== undefined ? { instagram: leadData.instagram ? String(leadData.instagram).trim() : '' } : {}),
        ...(leadData.facebook !== undefined ? { facebook: leadData.facebook ? String(leadData.facebook).trim() : '' } : {}),
        ...(leadData.linkedin !== undefined ? { linkedin: leadData.linkedin ? String(leadData.linkedin).trim() : '' } : {}),
        ...(leadData.youtube !== undefined ? { youtube: leadData.youtube ? String(leadData.youtube).trim() : '' } : {}),
        ...(leadData.twitter !== undefined ? { twitter: leadData.twitter ? String(leadData.twitter).trim() : '' } : {}),
        ...(leadData.website !== undefined ? { website: leadData.website ? String(leadData.website).trim() : '' } : {}),
      };
      Object.keys(merged).forEach((k) => {
        if (!merged[k] || merged[k] === 'N/A' || merged[k] === 'null') {
          delete merged[k];
        }
      });
      updateData.socialMedia = merged;
    }

    if (leadData.latitude !== undefined) {
      updateData.latitude = leadData.latitude !== null && !isNaN(Number(leadData.latitude)) ? Number(leadData.latitude) : null;
    }
    if (leadData.longitude !== undefined) {
      updateData.longitude = leadData.longitude !== null && !isNaN(Number(leadData.longitude)) ? Number(leadData.longitude) : null;
    }
    if (leadData.country !== undefined) {
      const c = leadData.country ? String(leadData.country).trim() : '';
      updateData.country = c && c !== 'N/A' && c !== 'null' ? c : null;
    }
    if (leadData.address !== undefined) {
      const a = leadData.address ? String(leadData.address).trim() : '';
      updateData.address = a && a !== 'N/A' && a !== 'null' ? a : null;
    }
    if (leadData.website !== undefined) {
      const w = leadData.website ? String(leadData.website).trim() : '';
      updateData.website = w && w !== 'N/A' && w !== 'null' ? w : null;
    }

    return this.prisma.lead.updateMany({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
      data: updateData,
    });
  }

  async updateStatus(
    customerId: number | string,
    id: number | string,
    fromStatus: LeadStatus | null,
    toStatus: LeadStatus,
    userId: number | string,
    notes?: string,
    stageId?: number,
    fromStageIdParam?: number | null,
    stageName?: string,
  ) {
    const numId = Number(id);
    const numCustomerId = Number(customerId);
    const numUserId = Number(userId);
    const updateWhere: any = { id: numId };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      updateWhere.customerId = numCustomerId;
    }

    let resolvedStageId = stageId ? Number(stageId) : undefined;
    if (!resolvedStageId && this.prisma.leadStage) {
      const matchStage = await this.prisma.leadStage.findFirst({
        where: {
          key: toStatus,
          deletedAt: null,
          OR: [
            ...(!isNaN(numCustomerId) && numCustomerId > 0 ? [{ customerId: numCustomerId }] : []),
            { customerId: null },
          ],
        },
        orderBy: { customerId: 'desc' },
      });
      if (matchStage) resolvedStageId = matchStage.id;
    }

    // Resolve fromStageId from param or from the current lead before update
    let fromStageId: number | null = fromStageIdParam !== undefined ? fromStageIdParam : null;
    if (fromStageId === null && fromStatus && this.prisma.leadStage) {
      const currentLead = await (this.prisma.lead.findUnique
        ? this.prisma.lead.findUnique({ where: { id: numId }, select: { stageId: true } })
        : this.prisma.lead.findFirst({ where: { id: numId } }));
      if (currentLead?.stageId) {
        fromStageId = currentLead.stageId;
      } else {
        const fromStage = await this.prisma.leadStage.findFirst({
          where: {
            key: fromStatus,
            deletedAt: null,
            OR: [
              ...(!isNaN(numCustomerId) && numCustomerId > 0 ? [{ customerId: numCustomerId }] : []),
              { customerId: null },
            ],
          },
          orderBy: { customerId: 'desc' },
        });
        if (fromStage) fromStageId = fromStage.id;
      }
    }

    const updateData: any = { status: toStatus };
    if (resolvedStageId) {
      updateData.stageId = resolvedStageId;
    }

    await this.prisma.lead.updateMany({
      where: updateWhere,
      data: updateData,
    });

    // Record full history with stage IDs so UI can resolve stage names from API
    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numId,
        fromStatus,
        toStatus,
        fromStageId: fromStageId ?? null,
        toStageId: resolvedStageId ?? null,
        changedById: numUserId,
        notes: notes || `Stage transitioned from ${fromStatus || 'N/A'} to ${stageName || toStatus}`,
      } as any,
    });

    await this.logTimeline(
      numId,
      'STATUS_CHANGED',
      `Stage updated to ${stageName || toStatus}${notes ? ` (${notes})` : ''}`,
      { fromStatus, toStatus, fromStageId, toStageId: resolvedStageId },
    );
  }

  async softDelete(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    return this.prisma.lead.updateMany({
      where: { id: numId, customerId: numCustomerId },
      data: { deletedAt: new Date() },
    });
  }

  async addNote(leadId: number | string, userId: number | string, content: string) {
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    return this.prisma.leadNote.create({
      data: { leadId: numLeadId, userId: numUserId, content },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async logTimeline(leadId: number | string, action: string, description: string, metadata?: any) {
    const numLeadId = Number(leadId);
    return this.prisma.leadActivityTimeline.create({
      data: { leadId: numLeadId, action, description, metadata },
    });
  }

  async logFollowUp(customerId: number | string, leadId: number | string, userId: number | string, dto: LogFollowUpDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({ where: { id: numLeadId } });
    if (!lead) return null;

    const nextDate = dto.nextFollowUpDate ? new Date(dto.nextFollowUpDate) : null;

    await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        status: LeadStatus.FOLLOW_UP,
        nextFollowUpDate: nextDate,
        nextFollowUpTime: dto.nextFollowUpTime,
      },
    });

    if (lead.status !== LeadStatus.FOLLOW_UP) {
      await this.prisma.leadStatusHistory.create({
        data: {
          leadId: numLeadId,
          fromStatus: lead.status,
          toStatus: LeadStatus.FOLLOW_UP,
          changedById: numUserId,
          notes: `Follow-up call logged: ${dto.outcome}`,
        },
      });
    }

    await this.logTimeline(
      numLeadId,
      'FOLLOW_UP_CALL',
      `Follow-up Call: Outcome: "${dto.outcome}"${dto.notes ? ` - ${dto.notes}` : ''}`,
      {
        outcome: dto.outcome,
        notes: dto.notes,
        nextFollowUpDate: dto.nextFollowUpDate,
        nextFollowUpTime: dto.nextFollowUpTime,
      },
    );

    return this.findOne(numCustomerId, numLeadId);
  }

  async manageVisit(customerId: number | string, leadId: number | string, userId: number | string, dto: ManageVisitDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({
      where: { id: numLeadId },
    });
    if (!lead) return null;

    // Find employee linked to user, or fallback
    const employee = await this.prisma.employee.findFirst({
      where: { customerId: numCustomerId, userId: numUserId },
    });

    if (dto.action === 'SCHEDULE') {
      const visitDate = dto.date ? new Date(dto.date) : new Date();
      const fallbackEmpId = employee?.id || (await this.getOrCreateFallbackEmployee(numCustomerId, numUserId));
      const createdVisit = await this.prisma.visit.create({
        data: {
          customerId: numCustomerId,
          leadId: numLeadId,
          employeeId: fallbackEmpId,
          customerName: lead.companyName || `${lead.firstName} ${lead.lastName}`,
          purpose: dto.purpose || 'Client Meeting & Demo',
          date: visitDate,
          time: dto.time || '11:00 AM',
          location: dto.location || lead.address || 'Client Site',
          status: 'SCHEDULED',
          notes: dto.notes,
        },
      });

      await this.logTimeline(
        numLeadId,
        'VISIT_SCHEDULED',
        `Field Visit Scheduled for ${dto.date || 'today'} at ${dto.time || '11:00 AM'} - ${dto.purpose || 'Client Demo'}`,
        { visitId: createdVisit.id, location: dto.location },
      );
    } else if (dto.action === 'START') {
      const visit = await this.prisma.visit.findFirst({
        where: { leadId: numLeadId, status: 'SCHEDULED' },
        orderBy: { createdAt: 'desc' },
      });

      if (visit) {
        await this.prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            latitude: dto.latitude,
            longitude: dto.longitude,
          },
        });
      }

      await this.logTimeline(
        numLeadId,
        'VISIT_STARTED',
        `Field Visit Started. GPS Coordinates: (${dto.latitude?.toFixed(4) || 'N/A'}, ${dto.longitude?.toFixed(4) || 'N/A'})`,
        { latitude: dto.latitude, longitude: dto.longitude },
      );
    } else if (dto.action === 'COMPLETE') {
      const visit = await this.prisma.visit.findFirst({
        where: { leadId: numLeadId, status: { in: ['IN_PROGRESS', 'SCHEDULED'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (visit) {
        await this.prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            notes: dto.notes || dto.summary,
          },
        });
      }

      await this.updateStatus(
        numCustomerId,
        numLeadId,
        lead.status,
        LeadStatus.VISIT,
        numUserId,
        `Visit completed: ${dto.summary || 'Successful discussion'}`,
      );

      await this.logTimeline(
        numLeadId,
        'VISIT_COMPLETED',
        `Field Visit Completed. Summary: ${dto.summary || 'Demo completed'} | Customer Response: ${dto.customerResponse || 'Positive'}`,
        { summary: dto.summary, customerResponse: dto.customerResponse, notes: dto.notes },
      );
    }

    return this.findOne(numCustomerId, numLeadId);
  }

  async createProposal(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateProposalDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({ where: { id: numLeadId } });
    if (!lead) return null;

    const propNo = dto.proposalNo || `PROP-${Date.now().toString().slice(-6)}`;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : new Date(Date.now() + 30 * 86400000);

    const quotation = await this.prisma.quotation.create({
      data: {
        customerId: numCustomerId,
        leadId: numLeadId,
        quotationNo: propNo,
        status: 'SENT',
        subTotal: dto.subTotal,
        taxAmount: dto.taxAmount,
        discount: dto.discount || 0,
        totalAmount: dto.totalAmount,
        validUntil,
        notes: dto.notes,
      },
    });

    // Update lead value
    await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        value: dto.totalAmount,
        status: LeadStatus.PROPOSAL,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numLeadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.PROPOSAL,
        changedById: numUserId,
        notes: `Commercial proposal ${propNo} for ₹${dto.totalAmount.toLocaleString('en-IN')} sent.`,
      },
    });

    await this.logTimeline(
      numLeadId,
      'PROPOSAL_SENT',
      `Proposal #${propNo} Sent. Total: ₹${dto.totalAmount.toLocaleString('en-IN')} (Tax: ₹${dto.taxAmount.toLocaleString('en-IN')})`,
      { proposalNo: propNo, totalAmount: dto.totalAmount, quotationId: quotation.id },
    );

    return this.findOne(numCustomerId, numLeadId);
  }

  async recordFinalCall(customerId: number | string, leadId: number | string, userId: number | string, dto: FinalCallDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({ where: { id: numLeadId } });
    if (!lead) return null;

    const isAccepted = dto.customerResponse.toLowerCase().includes('accept');
    const targetStatus = isAccepted ? LeadStatus.PAYMENT : LeadStatus.FINAL_CALL;

    await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        status: targetStatus,
        nextFollowUpDate: dto.expectedClosingDate ? new Date(dto.expectedClosingDate) : undefined,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numLeadId,
        fromStatus: lead.status,
        toStatus: targetStatus,
        changedById: numUserId,
        notes: `Final negotiation call: ${dto.customerResponse}`,
      },
    });

    await this.logTimeline(
      numLeadId,
      'FINAL_CALL',
      `Final Call Logged. Response: "${dto.customerResponse}"${dto.negotiationNotes ? ` | Notes: ${dto.negotiationNotes}` : ''}`,
      {
        customerResponse: dto.customerResponse,
        negotiationNotes: dto.negotiationNotes,
        expectedClosingDate: dto.expectedClosingDate,
        proposalAmount: dto.proposalAmount,
      },
    );

    return this.findOne(numCustomerId, numLeadId);
  }

  async recordPayment(customerId: number | string, leadId: number | string, userId: number | string, dto: RecordPaymentDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({ where: { id: numLeadId } });
    if (!lead) return null;

    await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        paidAmount: dto.paidAmount,
        paymentStatus: dto.status,
        paymentMethod: dto.paymentMethod,
        paymentRef: dto.transactionRef,
        status: LeadStatus.PAYMENT,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numLeadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.PAYMENT,
        changedById: numUserId,
        notes: `Payment recorded: ₹${dto.paidAmount.toLocaleString('en-IN')} (${dto.paymentMethod}, Ref: ${dto.transactionRef || 'N/A'}) - Status: ${dto.status}`,
      },
    });

    await this.logTimeline(
      numLeadId,
      'PAYMENT_RECEIVED',
      `Payment Received: ₹${dto.paidAmount.toLocaleString('en-IN')} of ₹${dto.totalAmount.toLocaleString('en-IN')} via ${dto.paymentMethod}. Status: ${dto.status}`,
      {
        paidAmount: dto.paidAmount,
        totalAmount: dto.totalAmount,
        paymentMethod: dto.paymentMethod,
        transactionRef: dto.transactionRef,
        status: dto.status,
      },
    );

    return this.findOne(numCustomerId, numLeadId);
  }

  async startWork(customerId: number | string, leadId: number | string, userId: number | string, dto: StartWorkDto) {
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);
    const numUserId = Number(userId);
    const lead = await this.prisma.lead.findUnique({ where: { id: numLeadId } });
    if (!lead) return null;

    const startDate = dto.workStartDate ? new Date(dto.workStartDate) : new Date();

    await this.prisma.lead.update({
      where: { id: numLeadId },
      data: {
        status: LeadStatus.WORK_STARTED,
        workStartDate: startDate,
        assignedTeam: dto.assignedTeam,
        workNotes: dto.notes,
      },
    });

    await this.prisma.leadStatusHistory.create({
      data: {
        leadId: numLeadId,
        fromStatus: lead.status,
        toStatus: LeadStatus.WORK_STARTED,
        changedById: numUserId,
        notes: `Work officially started. Assigned Team: ${dto.assignedTeam || 'Default Team'}`,
      },
    });

    await this.logTimeline(
      numLeadId,
      'WORK_STARTED',
      `Work Started on ${dto.workStartDate}. Assigned Team: "${dto.assignedTeam || 'Execution Team'}"${dto.notes ? ` - ${dto.notes}` : ''}`,
      {
        workStartDate: dto.workStartDate,
        assignedTeam: dto.assignedTeam,
        notes: dto.notes,
      },
    );

    return this.findOne(numCustomerId, numLeadId);
  }

  private async getOrCreateFallbackEmployee(customerId: number, userId: number): Promise<number> {
    const existing = await this.prisma.employee.findFirst({ where: { customerId, status: 'ACTIVE' } });
    if (existing) return existing.id;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const fallback = await this.prisma.employee.create({
      data: {
        customerId,
        userId: user?.id,
        employeeCode: `EMP-${String(customerId).padStart(3, '0')}-${String(userId).padStart(3, '0')}`,
        firstName: user?.firstName || 'Customer',
        lastName: user?.lastName || 'Staff',
        email: user?.email || `employee_${customerId}_${userId}@customer.local`,
      },
    });
    return fallback.id;
  }

  async findStages(customerId?: number | string, includeInactive = true) {
    const numCustomerId = Number(customerId);
    const hasCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    let targetCustomerId: number | null = null;
    if (hasCustomer) {
      const customerCount = typeof this.prisma.leadStage?.count === 'function'
        ? await this.prisma.leadStage.count({
            where: { customerId: numCustomerId, deletedAt: null },
          })
        : 0;
      if (customerCount > 0) {
        targetCustomerId = numCustomerId;
      }
    }

    const where: any = {
      customerId: targetCustomerId,
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
    };

    return this.prisma.leadStage.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        emailTemplate: {
          select: { id: true, name: true, key: true, subject: true },
        },
        whatsappTemplate: {
          select: { id: true, name: true, templateName: true, language: true, status: true, body: true },
        },
        _count: {
          select: {
            leads: {
              where: {
                deletedAt: null,
                ...(hasCustomer ? { customerId: numCustomerId } : {}),
              },
            },
          },
        },
      },
    });
  }

  async findStageById(id: number | string) {
    return this.prisma.leadStage.findFirst({
      where: { id: Number(id), deletedAt: null },
      include: {
        emailTemplate: {
          select: { id: true, name: true, key: true, subject: true },
        },
        whatsappTemplate: {
          select: { id: true, name: true, templateName: true, language: true, status: true, body: true },
        },
        _count: {
          select: {
            leads: { where: { deletedAt: null } },
          },
        },
      },
    });
  }

  async createStage(customerId: number | string | undefined, data: any) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    const key = data.name.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return this.prisma.leadStage.create({
      data: {
        name: data.name.trim(),
        key,
        color: data.color || '#0284C7',
        bgColor: data.bgColor || '#E0F2FE',
        borderColor: data.borderColor || '#BAE6FD',
        sortOrder: data.sortOrder !== undefined ? Number(data.sortOrder) : 0,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        customerId: numCustomerId,
        emailEnabled: data.emailEnabled !== undefined ? Boolean(data.emailEnabled) : true,
        emailTemplateId: data.emailTemplateId !== undefined ? (data.emailTemplateId ? Number(data.emailTemplateId) : null) : null,
        whatsappEnabled: data.whatsappEnabled !== undefined ? Boolean(data.whatsappEnabled) : true,
        whatsappTemplateId: data.whatsappTemplateId !== undefined ? (data.whatsappTemplateId ? Number(data.whatsappTemplateId) : null) : null,
      },
      include: {
        emailTemplate: { select: { id: true, name: true, key: true } },
        whatsappTemplate: { select: { id: true, name: true, templateName: true, language: true, status: true } },
      },
    });
  }

  async updateStage(id: number | string, data: any) {
    const updateData: any = {};
    if (data.name !== undefined) {
      updateData.name = data.name.trim();
      updateData.key = data.name.trim().toUpperCase().replace(/[\s-]+/g, '_');
    }
    if (data.color !== undefined) updateData.color = data.color;
    if (data.bgColor !== undefined) updateData.bgColor = data.bgColor;
    if (data.borderColor !== undefined) updateData.borderColor = data.borderColor;
    if (data.sortOrder !== undefined) updateData.sortOrder = Number(data.sortOrder);
    if (data.isActive !== undefined) updateData.isActive = Boolean(data.isActive);
    if (data.emailEnabled !== undefined) updateData.emailEnabled = Boolean(data.emailEnabled);
    if (data.emailTemplateId !== undefined) {
      updateData.emailTemplateId = data.emailTemplateId ? Number(data.emailTemplateId) : null;
    }
    if (data.whatsappEnabled !== undefined) updateData.whatsappEnabled = Boolean(data.whatsappEnabled);
    if (data.whatsappTemplateId !== undefined) {
      updateData.whatsappTemplateId = data.whatsappTemplateId ? Number(data.whatsappTemplateId) : null;
    }

    return this.prisma.leadStage.update({
      where: { id: Number(id) },
      data: updateData,
      include: {
        emailTemplate: { select: { id: true, name: true, key: true } },
        whatsappTemplate: { select: { id: true, name: true, templateName: true, language: true, status: true } },
      },
    });
  }

  async deleteStage(id: number | string) {
    return this.prisma.leadStage.update({
      where: { id: Number(id) },
      data: { deletedAt: new Date() },
    });
  }

  async countLeadsForStage(stageId: number | string, statusKey?: string) {
    const numStageId = Number(stageId);
    const where: any = {
      deletedAt: null,
      OR: [
        { stageId: numStageId },
        ...(statusKey ? [{ status: statusKey as any }] : []),
      ],
    };
    return this.prisma.lead.count({ where });
  }

  /**
   * Reorder stages — bulk update sortOrder in a single transaction.
   * Validates that every stage ID belongs to the given customer before updating.
   */
  async reorderStages(
    customerId: number | string | undefined,
    stages: { id: number; sortOrder: number }[],
  ) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    // Validate ownership: all stage IDs must belong to this customer
    if (numCustomerId) {
      const stageIds = stages.map((s) => Number(s.id));
      const owned = await this.prisma.leadStage.findMany({
        where: {
          id: { in: stageIds },
          deletedAt: null,
          OR: [{ customerId: numCustomerId }, { customerId: null }],
        },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((s) => s.id));
      const invalid = stageIds.filter((id) => !ownedIds.has(id));
      if (invalid.length > 0) {
        throw new Error(`Stage IDs [${invalid.join(', ')}] do not belong to this workspace.`);
      }
    }

    // Validate no duplicate sortOrder values
    const orders = stages.map((s) => s.sortOrder);
    if (new Set(orders).size !== orders.length) {
      throw new Error('Duplicate sortOrder values are not allowed.');
    }

    // Bulk update in transaction
    return this.prisma.$transaction(
      stages.map((s) =>
        this.prisma.leadStage.update({
          where: { id: Number(s.id) },
          data: { sortOrder: Number(s.sortOrder) },
        }),
      ),
    );
  }

  /**
   * Seed the 12 default lead stages for a customer if they don't already have any.
   * Idempotent — safe to call multiple times.
   */
  async ensureDefaultStagesForCustomer(customerId: number | null) {
    const DEFAULT_STAGES = [
      { key: 'NEW',              name: 'New',              sortOrder: 1,  color: '#0284C7', bgColor: '#E0F2FE', borderColor: '#BAE6FD' },
      { key: 'CONTACTED',       name: 'Contacted',        sortOrder: 2,  color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A' },
      { key: 'CALL_BACK',       name: 'Call Back',        sortOrder: 3,  color: '#8B5CF6', bgColor: '#F3E8FF', borderColor: '#E9D5FF' },
      { key: 'DETAILS_SENT',    name: 'Details Sent',     sortOrder: 4,  color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#E0E7FF' },
      { key: 'FOLLOW_UP',       name: 'Follow-Up',        sortOrder: 5,  color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC' },
      { key: 'VISIT_SCHEDULED', name: 'Visit Scheduled',  sortOrder: 6,  color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA' },
      { key: 'VISIT_DONE',      name: 'Visit Done',       sortOrder: 7,  color: '#0891B2', bgColor: '#E0F7FA', borderColor: '#B2EBF2' },
      { key: 'PROPOSAL_SENT',   name: 'Proposal Sent',    sortOrder: 8,  color: '#7C3AED', bgColor: '#EDE9FE', borderColor: '#DDD6FE' },
      { key: 'NEGOTIATION',     name: 'Negotiation',      sortOrder: 9,  color: '#B45309', bgColor: '#FFFBEB', borderColor: '#FDE68A' },
      { key: 'FINAL_CALL',      name: 'Final Call',       sortOrder: 10, color: '#C2410C', bgColor: '#FFF7ED', borderColor: '#FED7AA' },
      { key: 'WON',             name: 'Won',              sortOrder: 11, color: '#15803D', bgColor: '#DCFCE7', borderColor: '#BBF7D0' },
      { key: 'LOST',            name: 'Lost',             sortOrder: 12, color: '#DC2626', bgColor: '#FFF1F2', borderColor: '#FECDD3' },
    ];

    const existingCount = typeof this.prisma.leadStage?.count === 'function'
      ? await this.prisma.leadStage.count({
          where: { customerId, deletedAt: null },
        })
      : 0;

    if (existingCount > 0) return; // Already has stages — don't overwrite
    if (typeof this.prisma.leadStage?.upsert !== 'function') return;

    // Load available default templates to associate
    const [metaTemplates, emailTemplates] = await Promise.all([
      typeof this.prisma.metaTemplate?.findMany === 'function'
        ? this.prisma.metaTemplate.findMany({ where: { deletedAt: null } }).catch(() => [])
        : [],
      typeof this.prisma.emailTemplate?.findMany === 'function'
        ? this.prisma.emailTemplate.findMany({ where: { deletedAt: null } }).catch(() => [])
        : [],
    ]);

    for (const stage of DEFAULT_STAGES) {
      const matchedMeta = (metaTemplates as any[]).find((m) => m.key === stage.key);
      const matchedEmail = (emailTemplates as any[]).find((e) =>
        e.key.includes(stage.key) || stage.key.includes(e.key.replace('QUIKBOOM_', ''))
      );

      await this.prisma.leadStage.upsert({
        where: {
          customerId_key: { customerId: customerId as any, key: stage.key },
        },
        update: {}, // Don't overwrite existing
        create: {
          customerId,
          name: stage.name,
          key: stage.key,
          sortOrder: stage.sortOrder,
          color: stage.color,
          bgColor: stage.bgColor,
          borderColor: stage.borderColor,
          isActive: true,
          isSystem: true,
          emailEnabled: true,
          emailTemplateId: matchedEmail?.id ?? null,
          whatsappEnabled: true,
          whatsappTemplateId: matchedMeta?.id ?? null,
        },
      });
    }
  }

  async addImage(leadId: number, data: { url: string; key?: string; caption?: string }) {
    return this.prisma.leadImage.create({
      data: {
        leadId,
        url: data.url,
        key: data.key,
        caption: data.caption,
      },
    });
  }

  async findImageById(leadId: number, imageId: number) {
    return this.prisma.leadImage.findFirst({
      where: { id: imageId, leadId },
    });
  }

  async deleteImage(leadId: number, imageId: number) {
    return this.prisma.leadImage.deleteMany({
      where: { id: imageId, leadId },
    });
  }
}
