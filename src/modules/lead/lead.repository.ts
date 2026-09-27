import { Injectable, Logger } from '@nestjs/common';
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
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/role.util';

@Injectable()
export class LeadRepository {
  private readonly logger = new Logger(LeadRepository.name);

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
    const rawFirstName = leadData.firstName !== undefined && leadData.firstName !== null ? String(leadData.firstName).trim() : '';
    const rawLastName = leadData.lastName !== undefined && leadData.lastName !== null ? String(leadData.lastName).trim() : '';
    const isFakeName = (s: string) => ['business', 'lead', 'owner', 'unknown', 'direct', 'prospect'].includes(s.toLowerCase());
    let resolvedFirstName: string | null = isFakeName(rawFirstName) ? '' : rawFirstName;
    let resolvedLastName: string | null = isFakeName(rawLastName) ? '' : rawLastName;
    const resolvedPhone = leadData.phone ? String(leadData.phone).trim() : undefined;
    const resolvedEmail = leadData.email ? String(leadData.email).trim().toLowerCase() : undefined;

    let resolvedBusinessName =
      (leadData.companyName && leadData.companyName !== 'Business Lead' && leadData.companyName !== 'Direct Lead' && leadData.companyName !== 'New Lead' ? leadData.companyName : null) ||
      (leadData.businessName && leadData.businessName !== 'Business Lead' && leadData.businessName !== 'Direct Lead' && leadData.businessName !== 'New Lead' ? leadData.businessName : null) ||
      (typeof leadData.displayName === 'object' ? leadData.displayName?.text : leadData.displayName) ||
      ((dto as any).businessName && (dto as any).businessName !== 'Business Lead' && (dto as any).businessName !== 'Direct Lead' && (dto as any).businessName !== 'New Lead' ? (dto as any).businessName : null) ||
      ((dto as any).companyName && (dto as any).companyName !== 'Business Lead' && (dto as any).companyName !== 'Direct Lead' && (dto as any).companyName !== 'New Lead' ? (dto as any).companyName : null) ||
      (typeof (dto as any).displayName === 'object' ? (dto as any).displayName?.text : (dto as any).displayName) ||
      (leadData.title && leadData.title !== 'Business Lead' && leadData.title !== 'Direct Lead' && leadData.title !== 'New Lead' ? leadData.title : null) ||
      (name && !String(name).startsWith('places/') && name !== 'Business Lead' && name !== 'Direct Lead' && name !== 'New Lead' ? name : null) ||
      (full_name && !String(full_name).startsWith('places/') && full_name !== 'Business Lead' && full_name !== 'Direct Lead' && full_name !== 'New Lead' ? full_name : null);

    if (!resolvedBusinessName && (leadData.googlePlaceId || leadData.sourceRecordId || leadData.captureRequestId)) {
      try {
        const numSrc = Number(leadData.sourceRecordId);
        let matchPlace: any = null;
        if (leadData.googlePlaceId && !leadData.googlePlaceId.startsWith('custom_')) {
          matchPlace = await this.prisma.dataCapturePlace.findFirst({
            where: { customerId: numCustomerId, googlePlaceId: leadData.googlePlaceId, deletedAt: null },
          });
        }
        if (!matchPlace && leadData.sourceRecordId && !leadData.sourceRecordId.startsWith('custom_')) {
          matchPlace = await this.prisma.dataCapturePlace.findFirst({
            where: {
              customerId: numCustomerId,
              deletedAt: null,
              OR: [
                ...(!isNaN(numSrc) && numSrc > 0 ? [{ id: numSrc }] : []),
                { googlePlaceId: leadData.sourceRecordId },
                { sourceRecordId: leadData.sourceRecordId },
              ],
            },
          });
        }
        if (!matchPlace && leadData.captureRequestId) {
          const parsedJobId = leadData.captureRequestId.includes('_custom_')
            ? leadData.captureRequestId.split('_custom_')[0]
            : (leadData.captureRequestId.match(/^(job-[a-zA-Z0-9_\-]+)/)?.[1] || leadData.captureRequestId);
          const idxMatch = leadData.captureRequestId.match(/_custom_(\d+)/);
          const targetIdx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
          const jobPlaces = await this.prisma.dataCapturePlace.findMany({
            where: { customerId: numCustomerId, jobId: parsedJobId, deletedAt: null },
            orderBy: { id: 'asc' },
          });
          if (jobPlaces.length > 0) {
            matchPlace = jobPlaces[targetIdx] || jobPlaces[0];
          }
        }
        if (matchPlace?.businessName && matchPlace.businessName !== 'Business Lead' && matchPlace.businessName !== 'Direct Lead' && matchPlace.businessName !== 'New Lead' && matchPlace.businessName !== 'Unnamed Business') {
          resolvedBusinessName = matchPlace.businessName.trim();
          if (!leadData.sourceRecordId) leadData.sourceRecordId = matchPlace.sourceRecordId || String(matchPlace.id);
          if (!leadData.googlePlaceId && matchPlace.googlePlaceId && !matchPlace.googlePlaceId.startsWith('custom_')) leadData.googlePlaceId = matchPlace.googlePlaceId;
        }
      } catch (_) {}
    }

    if (resolvedFirstName === 'Business' && (resolvedLastName === 'Lead' || resolvedLastName === 'Owner' || resolvedLastName === 'Prospect' || !resolvedLastName)) {
      resolvedFirstName = null;
      resolvedLastName = null;
    }
    if (resolvedFirstName && resolvedBusinessName && resolvedFirstName.toLowerCase() === resolvedBusinessName.toLowerCase()) {
      resolvedFirstName = null;
    }
    if (resolvedLastName && resolvedBusinessName && resolvedLastName.toLowerCase() === resolvedBusinessName.toLowerCase()) {
      resolvedLastName = null;
    }

    const contactPerson = (resolvedFirstName || resolvedLastName ? `${resolvedFirstName || ''} ${resolvedLastName || ''}`.trim() : null);
    const validContact = contactPerson && contactPerson !== 'Business Lead' && contactPerson !== 'Business Owner' && contactPerson !== 'Unknown Business' ? contactPerson : null;

    const resolvedTitle =
      (leadData.title && leadData.title !== 'Business Lead' && leadData.title !== 'Direct Lead' && leadData.title !== 'New Lead' ? leadData.title : null) ||
      resolvedBusinessName ||
      validContact ||
      '';

    const finalCompanyName =
      resolvedBusinessName ||
      (leadData.companyName && leadData.companyName !== 'Business Lead' && leadData.companyName !== 'Direct Lead' && leadData.companyName !== 'New Lead' ? leadData.companyName : null) ||
      null;

    const createData: any = {
      ...leadData,
      title: resolvedTitle,
      companyName: finalCompanyName,
      city: resolvedCity,
      pincode: resolvedPincode,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      assignedToId: dto.assignedToId
        ? Number(dto.assignedToId)
        : (employeeId && numCreatedById ? numCreatedById : (numCreatedById || undefined)),
      status,
      stageId,
      customerId: numCustomerId,
      createdById: numCreatedById,
      employeeId: employeeId ? Number(employeeId) : undefined,
    };
    delete createData.businessName;
    delete createData.displayName;
    delete createData.placeName;
    delete createData.establishmentName;
    delete createData.organizationName;
    delete createData.formattedName;
    delete createData.name;
    delete createData.full_name;
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

    // Process and sanitize social media
    let resolvedSocialMedia = leadData.socialMedia;
    if (typeof resolvedSocialMedia === 'string' && resolvedSocialMedia.trim().startsWith('{')) {
      try {
        resolvedSocialMedia = JSON.parse(resolvedSocialMedia);
      } catch (_) {}
    }
    const incomingSocial = typeof resolvedSocialMedia === 'object' && resolvedSocialMedia !== null ? resolvedSocialMedia : {};
    const mergedSocial: Record<string, any> = {
      ...incomingSocial,
      ...(leadData.instagram ? { instagram: String(leadData.instagram).trim() } : {}),
      ...(leadData.facebook ? { facebook: String(leadData.facebook).trim() } : {}),
      ...(leadData.linkedin ? { linkedin: String(leadData.linkedin).trim() } : {}),
      ...(leadData.youtube ? { youtube: String(leadData.youtube).trim() } : {}),
      ...(leadData.twitter ? { twitter: String(leadData.twitter).trim() } : {}),
      ...(leadData.x ? { twitter: String(leadData.x).trim() } : {}),
      ...(leadData.tiktok ? { tiktok: String(leadData.tiktok).trim() } : {}),
      ...(leadData.pinterest ? { pinterest: String(leadData.pinterest).trim() } : {}),
      ...(leadData.website ? { website: String(leadData.website).trim() } : {}),
    };
    if (typeof resolvedSocialMedia === 'string' && resolvedSocialMedia.trim().length > 0 && !resolvedSocialMedia.trim().startsWith('{')) {
      const trimmed = resolvedSocialMedia.trim();
      if (trimmed.includes('instagram.com')) mergedSocial.instagram = trimmed;
      else if (trimmed.includes('facebook.com')) mergedSocial.facebook = trimmed;
      else if (trimmed.includes('linkedin.com')) mergedSocial.linkedin = trimmed;
      else if (trimmed.includes('youtube.com')) mergedSocial.youtube = trimmed;
      else if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) mergedSocial.twitter = trimmed;
      else if (trimmed.includes('tiktok.com')) mergedSocial.tiktok = trimmed;
      else if (trimmed.includes('pinterest.com')) mergedSocial.pinterest = trimmed;
      else mergedSocial.website = trimmed;
    }
    Object.keys(mergedSocial).forEach((k) => {
      if (!mergedSocial[k] || mergedSocial[k] === 'N/A' || mergedSocial[k] === 'null') {
        delete mergedSocial[k];
      }
    });

    if (Object.keys(mergedSocial).length > 0) {
      createData.socialMedia = mergedSocial;
    } else {
      delete createData.socialMedia;
    }
    delete createData.instagram;
    delete createData.facebook;
    delete createData.linkedin;
    delete createData.youtube;
    delete createData.twitter;
    delete createData.x;
    delete createData.tiktok;
    delete createData.pinterest;
    delete createData.photos;
    delete createData.googlePhotos;
    delete createData.images;

    // Safe trace logging for Google Discovery import debugging
    if (createData.source && (String(createData.source).toUpperCase().includes('GOOGLE') || String(createData.source).toUpperCase().includes('DISCOVERY'))) {
      this.logger.log(
        `[LEAD REPOSITORY TRACE] prisma.lead.create() data:\n` +
        `title: ${createData.title}\n` +
        `companyName: ${createData.companyName}\n` +
        `firstName: ${createData.firstName}\n` +
        `lastName: ${createData.lastName}\n` +
        `phone: ${createData.phone || 'N/A'}\n` +
        `email: ${createData.email || 'N/A'}\n` +
        `googlePlaceId: ${createData.googlePlaceId || 'N/A'}\n` +
        `sourceRecordId: ${createData.sourceRecordId || 'N/A'}\n` +
        `captureRequestId: ${createData.captureRequestId || 'N/A'}\n` +
        `rating: ${createData.rating ?? 'N/A'}\n` +
        `reviewCount: ${createData.reviewCount ?? 'N/A'}`,
      );
    }

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

    // Sync social profiles into lead_social_profiles table if present
    if (Object.keys(mergedSocial).length > 0 && client.leadSocialProfile) {
      const spPlatforms: Array<{ platform: string; url: string }> = [];
      if (mergedSocial.instagram) spPlatforms.push({ platform: 'INSTAGRAM', url: mergedSocial.instagram });
      if (mergedSocial.facebook) spPlatforms.push({ platform: 'FACEBOOK', url: mergedSocial.facebook });
      if (mergedSocial.youtube) spPlatforms.push({ platform: 'YOUTUBE', url: mergedSocial.youtube });
      if (mergedSocial.linkedin) spPlatforms.push({ platform: 'LINKEDIN', url: mergedSocial.linkedin });
      if (mergedSocial.twitter) spPlatforms.push({ platform: 'TWITTER', url: mergedSocial.twitter });
      if (mergedSocial.tiktok) spPlatforms.push({ platform: 'TIKTOK', url: mergedSocial.tiktok });
      if (mergedSocial.pinterest) spPlatforms.push({ platform: 'PINTEREST', url: mergedSocial.pinterest });
      if (mergedSocial.website) spPlatforms.push({ platform: 'WEBSITE', url: mergedSocial.website });

      for (const sp of spPlatforms) {
        try {
          await client.leadSocialProfile.upsert({
            where: {
              leadId_platform: {
                leadId: lead.id,
                platform: sp.platform,
              },
            },
            create: {
              leadId: lead.id,
              platform: sp.platform,
              url: sp.url,
            },
            update: {
              url: sp.url,
            },
          });
        } catch (_) {}
      }
    }

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
    const isAdmin = isUserAdmin(user);
    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        baseWhere.customerId = numCustomerId;
      } else {
        baseWhere.customerId = 0;
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      baseWhere.customerId = numCustomerId;
    }

    // Employee RBAC Isolation: Non-admin employees only see leads strictly assigned to them via employeeId
    if (user && !isAdmin) {
      const empId = user.employee?.id;
      if (empId) {
        // Strict: only leads where employeeId = this employee's record ID
        baseWhere.employeeId = empId;
      } else {
        // Employee user but no employee record found — return nothing (safety net)
        baseWhere.id = -1;
      }
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
    options: { page?: number; limit?: number; search?: string; status?: string; stageId?: string | number; assignedToId?: string | number; createdFrom?: string },
    user?: any,
  ) {
    const numCustomerId = Number(customerId ?? user?.customerId);
    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdmin = isUserAdmin(user);

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

    const andConditions: any[] = [];

    // Employee RBAC Isolation: Non-admin employees only see leads strictly assigned to them via employeeId
    if (user && !isAdmin) {
      const empId = user.employee?.id;
      this.logger.log(
        `[LEAD_VISIBILITY_DEBUG] findAll authenticatedUserId=${user.id} employeeId=${empId ?? 'none'} ` +
        `companyId=${numCustomerId} filter=employeeId_only`,
      );
      if (empId) {
        // Strict: only leads where employeeId = this employee's record ID
        andConditions.push({ employeeId: empId });
      } else {
        // Employee user but no employee record — return nothing
        andConditions.push({ id: -1 });
      }
    }

    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    if (options.stageId && options.stageId !== 'ALL' && !isNaN(Number(options.stageId))) {
      const sId = Number(options.stageId);
      const stageRecord = await this.prisma.leadStage.findFirst({
        where: { id: sId, deletedAt: null },
      });
      if (stageRecord?.key) {
        const normKey = normalizeLeadStatus(stageRecord.key);
        if (ALL_LEAD_STATUSES.includes(normKey)) {
          andConditions.push({
            OR: [
              { stageId: sId },
              { AND: [{ stageId: null }, { status: normKey as LeadStatus }] },
            ],
          });
        } else {
          where.stageId = sId;
        }
      } else {
        where.stageId = sId;
      }
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

    if (options.createdFrom && options.createdFrom.trim() && options.createdFrom.toUpperCase() !== 'ALL') {
      where.createdFrom = options.createdFrom.trim().toUpperCase();
    }

    if (options.search && options.search.trim()) {
      const s = options.search.trim();
      andConditions.push({
        OR: [
          { title: { contains: s, mode: 'insensitive' } },
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
          { companyName: { contains: s, mode: 'insensitive' } },
          { city: { contains: s, mode: 'insensitive' } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    let data: any[] = [];
    let total = 0;

    try {
      [data, total] = await Promise.all([
        this.prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            stage: true,
            assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            employee: { select: { id: true, firstName: true, lastName: true } },
            convertedByEmployee: { select: { id: true, firstName: true, lastName: true } },
            socialProfiles: true,
          },
        }),
        this.prisma.lead.count({ where }),
      ]);
    } catch (queryErr: any) {
      this.logger.warn(`findAll with full include failed: ${queryErr?.message || queryErr}. Attempting fallback...`);
      try {
        [data, total] = await Promise.all([
          this.prisma.lead.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
              stage: true,
              assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
              createdBy: { select: { id: true, firstName: true, lastName: true } },
              employee: { select: { id: true, firstName: true, lastName: true } },
              convertedByEmployee: { select: { id: true, firstName: true, lastName: true } },
            },
          }),
          this.prisma.lead.count({ where }),
        ]);
      } catch (fallbackErr: any) {
        this.logger.error(`findAll fallback query failed: ${fallbackErr?.message || fallbackErr}`);
        throw fallbackErr;
      }
    }

    // Safe diagnostic log (Section 9)
    this.logger.log(
      `[LEADS_FIND_ALL_DIAGNOSTIC] requestedEmployee=${user?.employee?.id ?? user?.employee?.employeeCode ?? user?.id ?? 'N/A'} companyId=${numCustomerId} role=${user?.role ?? 'N/A'} isAdmin=${isAdmin} totalResults=${total}`,
    );

    if (Array.isArray(data) && data.length > 0) {
      await this.resolveMissingLeadBusinessNames(data);
    }

    return {
      data: Array.isArray(data) ? data.map((l) => this.enrichLeadRecord(l)) : [],
      meta: {
        total: Number(total) || 0,
        page,
        limit,
        totalPages: Math.max(Math.ceil((Number(total) || 0) / limit), 1),
      },
    };
  }

  public async resolveMissingLeadBusinessNames(leads: any[]): Promise<void> {
    const isFake = (s: any) =>
      !s ||
      typeof s !== 'string' ||
      ['business lead', 'direct lead', 'new lead', 'unnamed business', 'unknown business', 'placeholder lead', 'test lead', 'placeholder customer', 'test customer', '.'].includes(s.trim().toLowerCase());

    const candidateLeads = leads.filter((l) => {
      const hasValidCompany = !isFake(l.companyName);
      const hasValidBiz = !isFake(l.businessName);
      return !hasValidCompany || !hasValidBiz || isFake(l.title);
    });

    // [LEAD_NAME_RESOLUTION_DEBUG] Log processing summary
    if (candidateLeads.length > 0) {
      this.logger.log(
        `[LEAD_NAME_RESOLUTION_DEBUG] Processing ${candidateLeads.length}/${leads.length} leads that need business name resolution. Sample:`,
      );
      for (let i = 0; i < Math.min(3, candidateLeads.length); i++) {
        const l = candidateLeads[i];
        this.logger.log(
          `  Lead ${l.id}: companyName="${l.companyName}" businessName="${l.businessName}" title="${l.title}" googlePlaceId="${l.googlePlaceId}" sourceRecordId="${l.sourceRecordId}"`,
        );
      }
    }

    if (candidateLeads.length === 0) return;

    for (const lead of candidateLeads) {
      try {
        let matchingPlace: any = null;
        let matchMethod = '';

        // 1. By importedLeadId in DataCapturePlace
        matchingPlace = await this.prisma.dataCapturePlace.findFirst({
          where: {
            customerId: lead.customerId,
            importedLeadId: lead.id,
            deletedAt: null,
          },
          select: { businessName: true, phone: true, email: true, website: true, address: true, googlePlaceId: true },
        });
        if (matchingPlace) matchMethod = 'importedLeadId';

        // 2. By googlePlaceId
        if (!matchingPlace && lead.googlePlaceId && !lead.googlePlaceId.startsWith('custom_')) {
          matchingPlace = await this.prisma.dataCapturePlace.findFirst({
            where: {
              customerId: lead.customerId,
              googlePlaceId: lead.googlePlaceId,
              deletedAt: null,
            },
            select: { businessName: true, phone: true, email: true, website: true, address: true, googlePlaceId: true },
          });
          if (matchingPlace) matchMethod = 'googlePlaceId';
        }

        // 3. By sourceRecordId
        if (!matchingPlace && lead.sourceRecordId && !lead.sourceRecordId.startsWith('custom_')) {
          const numSrc = Number(lead.sourceRecordId);
          matchingPlace = await this.prisma.dataCapturePlace.findFirst({
            where: {
              customerId: lead.customerId,
              deletedAt: null,
              OR: [
                ...(!isNaN(numSrc) && numSrc > 0 ? [{ id: numSrc }] : []),
                { sourceRecordId: lead.sourceRecordId },
                { googlePlaceId: lead.sourceRecordId },
              ],
            },
            select: { businessName: true, phone: true, email: true, website: true, address: true, googlePlaceId: true },
          });
          if (matchingPlace) matchMethod = 'sourceRecordId';
        }

        // 4. By captureRequestId job ID
        if (!matchingPlace && lead.captureRequestId) {
          const jobIdMatch = lead.captureRequestId.match(/^(job-[a-zA-Z0-9]+)/);
          if (jobIdMatch) {
            const parsedJobId = jobIdMatch[1];
            matchingPlace = await this.prisma.dataCapturePlace.findFirst({
              where: {
                customerId: lead.customerId,
                jobId: parsedJobId,
                deletedAt: null,
              },
              select: { businessName: true, phone: true, email: true, website: true, address: true, googlePlaceId: true },
            });
            if (matchingPlace) matchMethod = 'captureRequestId';
          }
        }

        // [LEAD_NAME_RESOLUTION_MATCH_DEBUG] Log match results
        if (matchingPlace) {
          this.logger.log(
            `[LEAD_NAME_RESOLUTION_MATCH] Lead ${lead.id} matched via ${matchMethod}: place.businessName="${matchingPlace.businessName}"`,
          );
        } else {
          this.logger.warn(
            `[LEAD_NAME_RESOLUTION_NO_MATCH] Lead ${lead.id} (googlePlaceId="${lead.googlePlaceId}" sourceRecordId="${lead.sourceRecordId}") had no matching DataCapturePlace`,
          );
        }

        if (matchingPlace && matchingPlace.businessName && !isFake(matchingPlace.businessName)) {
          const resolvedName = matchingPlace.businessName.trim();
          lead.companyName = resolvedName;
          lead.businessName = resolvedName;
          lead.name = resolvedName;
          if (isFake(lead.title)) {
            lead.title = resolvedName;
          }
          if (!lead.phone && matchingPlace.phone) lead.phone = matchingPlace.phone;
          if (!lead.website && matchingPlace.website) lead.website = matchingPlace.website;
          if (!lead.email && matchingPlace.email) lead.email = matchingPlace.email;
          if (!lead.address && matchingPlace.address) lead.address = matchingPlace.address;

          if (matchingPlace.source && matchingPlace.source !== 'GOOGLE_DISCOVERY') {
            lead.source = matchingPlace.source;
          } else if (matchingPlace.googlePlaceId && (lead.source === 'GOOGLE_DISCOVERY' || !lead.source)) {
            lead.source = 'GOOGLE_PLACES';
          }

          if (!lead.createdFrom) {
            lead.createdFrom = 'MOBILE_APP';
          }

          // Auto-heal employee assignment if missing
          if (!lead.assignedToId || !lead.employeeId || !lead.assignedTo) {
            try {
              const activeEmp = await this.prisma.employee.findFirst({
                where: {
                  ...(lead.customerId ? { customerId: lead.customerId } : {}),
                  status: 'ACTIVE',
                },
                select: { id: true, userId: true, firstName: true, lastName: true },
              });
              if (activeEmp) {
                if (!lead.employeeId) lead.employeeId = activeEmp.id;
                if (!lead.assignedToId && activeEmp.userId) lead.assignedToId = activeEmp.userId;
                if (!lead.assignedTo && activeEmp.userId) {
                  lead.assignedTo = { id: activeEmp.userId, firstName: activeEmp.firstName, lastName: activeEmp.lastName, email: '' };
                }
                if (!lead.employee) {
                  lead.employee = { id: activeEmp.id, firstName: activeEmp.firstName, lastName: activeEmp.lastName };
                }
              }
            } catch (_) {}
          }
          
          this.logger.log(`[LEAD_NAME_RESOLUTION_UPDATED] Lead ${lead.id} companyName updated to "${resolvedName}"`);

          // Asynchronously update in PostgreSQL so database has real companyName
          this.prisma.lead.update({
            where: { id: lead.id },
            data: {
              companyName: resolvedName,
              ...(isFake(lead.title) ? { title: resolvedName } : {}),
              ...(!lead.phone && matchingPlace.phone ? { phone: matchingPlace.phone } : {}),
              ...(!lead.website && matchingPlace.website ? { website: matchingPlace.website } : {}),
              ...(!lead.email && matchingPlace.email ? { email: matchingPlace.email } : {}),
              ...(!lead.address && matchingPlace.address ? { address: matchingPlace.address } : {}),
              ...(lead.source ? { source: lead.source } : {}),
              ...(lead.createdFrom ? { createdFrom: lead.createdFrom as any } : {}),
              ...(lead.assignedToId ? { assignedToId: lead.assignedToId } : {}),
              ...(lead.employeeId ? { employeeId: lead.employeeId } : {}),
            },
          }).then(() => {
            this.logger.log(`[LEAD_NAME_RESOLUTION_DB_UPDATED] Lead ${lead.id} persisted to database`);
          }).catch((err: any) => {
            this.logger.error(`[LEAD_NAME_RESOLUTION_DB_ERROR] Failed to persist Lead ${lead.id}: ${err?.message || err}`);
          });
        } else if (matchingPlace && !matchingPlace.businessName) {
          this.logger.warn(`[LEAD_NAME_RESOLUTION_EMPTY_PLACE] Lead ${lead.id} matched DataCapturePlace but it has empty businessName`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to resolve DataCapturePlace for lead #${lead.id}: ${err?.message || err}`);
      }
    }
  }

  public enrichLeadRecord(lead: any): any {
    if (!lead) return lead;
    const isFake = (s: any) =>
      !s ||
      typeof s !== 'string' ||
      ['business lead', 'direct lead', 'new lead', 'unnamed business', 'unknown business', 'placeholder lead', 'test lead', 'placeholder customer', 'test customer', '.'].includes(s.trim().toLowerCase());

    const cleanCompany = !isFake(lead.companyName) ? lead.companyName.trim() : null;
    const cleanBiz = !isFake(lead.businessName) ? lead.businessName.trim() : null;
    const cleanTitle = !isFake(lead.title) ? lead.title.trim() : null;

    const resolvedBiz = cleanCompany || cleanBiz || cleanTitle || null;
    
    // [LEAD_ENRICH_DEBUG] Log field resolution for diagnosis
    if (!resolvedBiz || resolvedBiz.length === 0) {
      this.logger.warn(
        `[LEAD_ENRICH_DEBUG] Lead ${lead.id} has no resolved business name after enrichment. Raw: companyName="${lead.companyName}" title="${lead.title}" isFakeTitle=${isFake(lead.title)}`,
      );
    }

    let upcomingCommission: number | null = null;
    if (Array.isArray(lead.commissions) && lead.commissions.length > 0) {
      const eligible = lead.commissions.filter(
        (c: any) => c.status === 'PENDING' || c.status === 'APPROVED',
      );
      if (eligible.length > 0) {
        upcomingCommission = eligible.reduce(
          (sum: number, c: any) => sum + Number(c.commissionAmount || 0),
          0,
        );
      }
    }

    const isFakeContact = (s: any) =>
      !s ||
      typeof s !== 'string' ||
      ['business', 'lead', 'owner', 'unknown', 'direct', 'prospect', 'customer', '.'].includes(s.trim().toLowerCase());

    const resolvedFirstName = isFakeContact(lead.firstName) ? '' : lead.firstName;
    const resolvedLastName = isFakeContact(lead.lastName) ? '' : lead.lastName;

    // Map social media / profiles strictly separating website (Part 11, 12, 18)
    const mappedSocial: any = (lead.socialMedia && typeof lead.socialMedia === 'object') ? { ...lead.socialMedia } : {};
    if (Array.isArray(lead.socialProfiles) && lead.socialProfiles.length > 0) {
      for (const sp of lead.socialProfiles) {
        const plat = String(sp.platform || '').toLowerCase();
        if (plat.includes('instagram')) mappedSocial.instagram = sp.url;
        else if (plat.includes('facebook')) mappedSocial.facebook = sp.url;
        else if (plat.includes('youtube')) mappedSocial.youtube = sp.url;
        else if (plat.includes('linkedin')) mappedSocial.linkedin = sp.url;
        else if (plat.includes('twitter') || plat === 'x') mappedSocial.twitter = sp.url;
        else if (plat.includes('tiktok')) mappedSocial.tiktok = sp.url;
        else if (plat.includes('pinterest')) mappedSocial.pinterest = sp.url;
      }
    }
    delete mappedSocial.website;
    const finalSocialMedia = Object.keys(mappedSocial).length > 0 ? mappedSocial : null;

    return {
      ...lead,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      companyName: resolvedBiz,
      businessName: resolvedBiz,
      title: (!isFake(lead.title) ? lead.title.trim() : (resolvedBiz || lead.title || '')),
      name: resolvedBiz,
      socialMedia: finalSocialMedia,
      upcomingCommission: upcomingCommission ?? lead.upcomingCommission ?? null,
      // Normalized ownership fields for easy frontend consumption
      assignedToName: lead.assignedTo
        ? `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim() || null
        : null,
      createdByName: lead.createdBy
        ? `${lead.createdBy.firstName || ''} ${lead.createdBy.lastName || ''}`.trim() || null
        : null,
      employeeName: lead.employee
        ? `${lead.employee.firstName || ''} ${lead.employee.lastName || ''}`.trim() || null
        : null,
      convertedByEmployeeName: lead.convertedByEmployee
        ? `${lead.convertedByEmployee.firstName || ''} ${lead.convertedByEmployee.lastName || ''}`.trim() || null
        : null,
      wonByEmployeeId: lead.convertedByEmployeeId || null,
      wonBy: lead.convertedByEmployee
        ? {
            id: lead.convertedByEmployee.id,
            name: `${lead.convertedByEmployee.firstName || ''} ${lead.convertedByEmployee.lastName || ''}`.trim() || null,
            firstName: lead.convertedByEmployee.firstName,
            lastName: lead.convertedByEmployee.lastName,
          }
        : null,
      wonByName: lead.convertedByEmployee
        ? `${lead.convertedByEmployee.firstName || ''} ${lead.convertedByEmployee.lastName || ''}`.trim() || null
        : null,
      wonAt: lead.convertedAt || null,
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

    try {
      const result = await this.prisma.lead.findFirst({
        where,
        include: {
          customer: true,
          stage: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          convertedByEmployee: { select: { id: true, firstName: true, lastName: true } },
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
          socialProfiles: true,
          convertedCustomer: {
            select: { id: true, name: true, companyName: true, email: true, phone: true, isActive: true },
          },
          commissions: {
            select: { id: true, commissionAmount: true, status: true, commissionType: true, paidAt: true, createdAt: true },
          },
        },
      });
      if (result) {
        await this.resolveMissingLeadBusinessNames([result]);
      }
      return this.enrichLeadRecord(result);
    } catch (err: any) {
      this.logger.warn(`findOne with full include failed: ${err?.message || err}. Attempting fallback...`);
      const fallbackResult = await this.prisma.lead.findFirst({
        where,
        include: {
          customer: true,
          stage: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          convertedByEmployee: { select: { id: true, firstName: true, lastName: true } },
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
          convertedCustomer: {
            select: { id: true, name: true, companyName: true, email: true, phone: true, isActive: true },
          },
          commissions: {
            select: { id: true, commissionAmount: true, status: true, commissionType: true, paidAt: true, createdAt: true },
          },
          socialProfiles: true,
        },
      });
      if (fallbackResult) {
        await this.resolveMissingLeadBusinessNames([fallbackResult]);
      }
      return this.enrichLeadRecord(fallbackResult);
    }
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
    // createdFrom is strictly immutable after creation
    delete updateData.createdFrom;

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
      leadData.twitter !== undefined ||
      leadData.x !== undefined ||
      leadData.tiktok !== undefined ||
      leadData.pinterest !== undefined
    ) {
      const existing = await this.prisma.lead.findUnique({
        where: { id: numId },
        select: { socialMedia: true },
      });
      const current = (existing?.socialMedia as Record<string, any>) || {};
      let incoming = typeof leadData.socialMedia === 'object' && leadData.socialMedia !== null ? leadData.socialMedia : {};
      if (typeof leadData.socialMedia === 'string' && leadData.socialMedia.trim().startsWith('{')) {
        try {
          incoming = JSON.parse(leadData.socialMedia);
        } catch (_) {}
      }
      const merged: Record<string, any> = {
        ...current,
        ...incoming,
        ...(leadData.instagram !== undefined ? { instagram: leadData.instagram ? String(leadData.instagram).trim() : '' } : {}),
        ...(leadData.facebook !== undefined ? { facebook: leadData.facebook ? String(leadData.facebook).trim() : '' } : {}),
        ...(leadData.linkedin !== undefined ? { linkedin: leadData.linkedin ? String(leadData.linkedin).trim() : '' } : {}),
        ...(leadData.youtube !== undefined ? { youtube: leadData.youtube ? String(leadData.youtube).trim() : '' } : {}),
        ...(leadData.twitter !== undefined ? { twitter: leadData.twitter ? String(leadData.twitter).trim() : '' } : {}),
        ...(leadData.x !== undefined ? { twitter: leadData.x ? String(leadData.x).trim() : '' } : {}),
        ...(leadData.tiktok !== undefined ? { tiktok: leadData.tiktok ? String(leadData.tiktok).trim() : '' } : {}),
        ...(leadData.pinterest !== undefined ? { pinterest: leadData.pinterest ? String(leadData.pinterest).trim() : '' } : {}),
        ...(leadData.website !== undefined ? { website: leadData.website ? String(leadData.website).trim() : '' } : {}),
      };
      if (typeof leadData.socialMedia === 'string' && leadData.socialMedia.trim().length > 0 && !leadData.socialMedia.trim().startsWith('{')) {
        const trimmed = leadData.socialMedia.trim();
        if (trimmed.includes('instagram.com')) merged.instagram = trimmed;
        else if (trimmed.includes('facebook.com')) merged.facebook = trimmed;
        else if (trimmed.includes('linkedin.com')) merged.linkedin = trimmed;
        else if (trimmed.includes('youtube.com')) merged.youtube = trimmed;
        else if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) merged.twitter = trimmed;
        else if (trimmed.includes('tiktok.com')) merged.tiktok = trimmed;
        else if (trimmed.includes('pinterest.com')) merged.pinterest = trimmed;
        else merged.website = trimmed;
      }
      Object.keys(merged).forEach((k) => {
        if (!merged[k] || merged[k] === 'N/A' || merged[k] === 'null') {
          delete merged[k];
        }
      });
      updateData.socialMedia = Object.keys(merged).length > 0 ? merged : null;

      // Sync updated social profiles to lead_social_profiles
      if (this.prisma.leadSocialProfile) {
        const spPlatforms: Array<{ platform: string; url: string }> = [];
        if (merged.instagram) spPlatforms.push({ platform: 'INSTAGRAM', url: merged.instagram });
        if (merged.facebook) spPlatforms.push({ platform: 'FACEBOOK', url: merged.facebook });
        if (merged.youtube) spPlatforms.push({ platform: 'YOUTUBE', url: merged.youtube });
        if (merged.linkedin) spPlatforms.push({ platform: 'LINKEDIN', url: merged.linkedin });
        if (merged.twitter) spPlatforms.push({ platform: 'TWITTER', url: merged.twitter });
        if (merged.tiktok) spPlatforms.push({ platform: 'TIKTOK', url: merged.tiktok });
        if (merged.pinterest) spPlatforms.push({ platform: 'PINTEREST', url: merged.pinterest });
        if (merged.website) spPlatforms.push({ platform: 'WEBSITE', url: merged.website });

        for (const sp of spPlatforms) {
          try {
            await this.prisma.leadSocialProfile.upsert({
              where: {
                leadId_platform: {
                  leadId: numId,
                  platform: sp.platform,
                },
              },
              create: {
                leadId: numId,
                platform: sp.platform,
                url: sp.url,
              },
              update: {
                url: sp.url,
              },
            });
          } catch (_) {}
        }
      }
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
    const where: any = { id: numId };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }
    return this.prisma.lead.updateMany({
      where,
      data: { deletedAt: new Date() },
    });
  }

  async bulkSoftDelete(ids: number[], customerId?: number | string) {
    if (!ids || ids.length === 0) return { count: 0 };
    const numCustomerId = Number(customerId);
    const where: any = {
      id: { in: ids },
      deletedAt: null,
    };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }
    return this.prisma.lead.updateMany({
      where,
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

  async findStages(customerId?: number | string, includeInactive = true, user?: any) {
    const numCustomerId = Number(customerId ?? user?.customerId);
    const hasCustomer = !isNaN(numCustomerId) && numCustomerId > 0;
    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdmin = isUserAdmin(user);

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

    const leadWhere: any = {
      deletedAt: null,
      ...(hasCustomer ? { customerId: numCustomerId } : {}),
    };

    // Employee RBAC Isolation: When user is an employee, scope lead count strictly to assigned leads (employeeId only)
    if (user && !isAdmin) {
      const empId = user.employee?.id;
      if (empId) {
        leadWhere.employeeId = empId;
      } else {
        // Employee user but no employee record — show 0 leads per stage
        leadWhere.id = -1;
      }
    }

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
              where: leadWhere,
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

  async addImage(
    leadId: number,
    data: { url: string; key?: string; caption?: string; isPrimary?: boolean },
  ) {
    const existingCount = typeof this.prisma.leadImage?.count === 'function'
      ? await this.prisma.leadImage.count({ where: { leadId } })
      : 0;
    const shouldBePrimary = data.isPrimary ?? (existingCount === 0);

    if (shouldBePrimary && existingCount > 0 && typeof this.prisma.leadImage?.updateMany === 'function') {
      await this.prisma.leadImage.updateMany({
        where: { leadId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.leadImage.create({
      data: {
        leadId,
        url: data.url,
        key: data.key,
        caption: data.caption,
        isPrimary: shouldBePrimary,
      },
    });
  }

  async findImageById(leadId: number, imageId: number) {
    return this.prisma.leadImage.findFirst({
      where: { id: imageId, leadId },
    });
  }

  async findImagesByLeadId(leadId: number) {
    return this.prisma.leadImage.findMany({
      where: { leadId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async setPrimaryImage(leadId: number, imageId: number) {
    if (typeof this.prisma.leadImage?.updateMany === 'function') {
      await this.prisma.leadImage.updateMany({
        where: { leadId },
        data: { isPrimary: false },
      });
    }
    return this.prisma.leadImage.update({
      where: { id: imageId },
      data: { isPrimary: true },
    });
  }

  async deleteImage(leadId: number, imageId: number) {
    const imgToDelete = await this.prisma.leadImage.findFirst({
      where: { id: imageId, leadId },
    });
    const result = await this.prisma.leadImage.deleteMany({
      where: { id: imageId, leadId },
    });

    // If the deleted image was primary, set the next most recent image as primary
    if (imgToDelete?.isPrimary) {
      const nextPrimary = await this.prisma.leadImage.findFirst({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
      });
      if (nextPrimary) {
        await this.prisma.leadImage.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
    }

    return result;
  }
}
