import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LeadStatus } from '@prisma/client';
import { LeadRepository } from './lead.repository';
import { NotificationService } from '../notification/notification.service';
import {
  CheckDuplicateDto,
  ConvertLeadDto,
  CreateLeadDto,
  CreateLeadNoteDto,
  CreateLeadStageDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  ReorderLeadStagesDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
  UpdateLeadStatusDto,
  SendLeadWhatsAppDto,
  SendLeadEmailDto,
  normalizeLeadStatus,
} from './dto/lead.dto';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import {
  EmailTemplateService,
  TELECALLER_STATUS_TO_TEMPLATE_KEY,
  PREDEFINED_SYSTEM_TEMPLATES,
  renderEmailTemplate,
  wrapInQuikboomEmailHtml,
} from '../email/email-template.service';
import {
  WhatsappService,
  STAGE_KEY_TO_WHATSAPP_KEY,
  friendlyWhatsAppErrorMessage,
  WHATSAPP_ERROR_CODES,
} from '../whatsapp/whatsapp.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { ContactExtractor } from '../../common/utils/contact-extractor.util';

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return 'none';
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return '****';
  return `****${clean.slice(-4)}`;
}

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly prisma: PrismaService,
    @Optional() private readonly planAccessService?: PlanAccessService,
    @Optional() private readonly leadLimitService?: LeadLimitService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private getNotificationService(): NotificationService | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(NotificationService, { strict: false });
    } catch {
      return null;
    }
  }

  async getSummaryMetrics(customerId: number | string | undefined, user?: any) {
    return this.leadRepository.getSummaryMetrics(customerId, user);
  }

  async convertLead(customerId: number | string, leadId: number | string, userId: number | string, dto: ConvertLeadDto) {
    return this.leadRepository.convertLead(customerId, leadId, userId, dto);
  }

  /**
   * Dedicated mapper to extract and normalize Google Discovery / Google Lead Ads payload structures
   */
  parseGoogleLeadPayload(payload: any): {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    city?: string;
    state?: string;
    googlePlaceId?: string;
    source?: string;
  } {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    const result: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      companyName?: string;
      city?: string;
      state?: string;
      googlePlaceId?: string;
      source?: string;
    } = {};

    // 1. Unpack nested containers if present (lead_data, google_lead, data, lead)
    const nested = payload.lead_data || payload.google_lead || payload.data || payload.lead || {};

    // 2. Unpack Google Lead Ads user_column_data / column_data / form_data / fields
    const colArray =
      payload.user_column_data ||
      payload.column_data ||
      payload.form_data ||
      payload.fields ||
      nested.user_column_data ||
      nested.column_data ||
      nested.form_data ||
      nested.fields;

    if (Array.isArray(colArray)) {
      for (const col of colArray) {
        if (!col || typeof col !== 'object') continue;
        const id = String(
          col.column_id ||
          col.column_name ||
          col.field_id ||
          col.key ||
          col.id ||
          col.name ||
          '',
        ).toUpperCase().trim();

        const val = col.string_value ?? col.value ?? col.val ?? '';
        const trimmedVal = typeof val === 'string' ? val.trim() : String(val || '').trim();
        if (!trimmedVal) continue;

        if (id === 'FIRST_NAME' || id === 'FIRSTNAME' || id === 'GIVEN_NAME') {
          if (!result.firstName) result.firstName = trimmedVal;
        } else if (id === 'LAST_NAME' || id === 'LASTNAME' || id === 'FAMILY_NAME') {
          if (!result.lastName) result.lastName = trimmedVal;
        } else if (id === 'FULL_NAME' || id === 'NAME' || id === 'CONTACT_NAME') {
          if (!result.firstName && !result.lastName) {
            const parts = trimmedVal.split(/\s+/);
            result.firstName = parts[0];
            result.lastName = parts.slice(1).join(' ') || parts[0];
          }
        } else if (id === 'EMAIL' || id === 'USER_EMAIL' || id === 'WORK_EMAIL' || id === 'EMAIL_ADDRESS') {
          if (!result.email) result.email = ContactExtractor.normalizeEmail(trimmedVal) || undefined;
        } else if (
          id === 'PHONE_NUMBER' ||
          id === 'PHONE' ||
          id === 'MOBILE' ||
          id === 'MOBILE_NUMBER' ||
          id === 'USER_PHONE' ||
          id === 'WORK_PHONE'
        ) {
          if (!result.phone) result.phone = ContactExtractor.normalizePhoneNumber(trimmedVal) || undefined;
        } else if (id === 'COMPANY_NAME' || id === 'COMPANY' || id === 'BUSINESS_NAME') {
          if (!result.companyName) result.companyName = trimmedVal;
        } else if (id === 'CITY' || id === 'LOCATION') {
          if (!result.city) result.city = trimmedVal;
        } else if (id === 'STATE' || id === 'REGION') {
          if (!result.state) result.state = trimmedVal;
        }
      }
    }

    // 3. Extract direct Google Discovery fields (including snake_case & nested)
    const directFirstName = payload.firstName || payload.first_name || nested.firstName || nested.first_name;
    const directLastName = payload.lastName || payload.last_name || nested.lastName || nested.last_name;
    const directFullName = payload.name || payload.full_name || nested.name || nested.full_name;
    const directEmail =
      payload.email ||
      payload.user_email ||
      payload.emailAddress ||
      payload.email_address ||
      nested.email ||
      nested.user_email;
    const directPhone =
      payload.phone ||
      payload.mobile ||
      payload.phoneNumber ||
      payload.phone_number ||
      payload.user_phone ||
      payload.user_phone_number ||
      payload.mobileNumber ||
      payload.contactNumber ||
      nested.phone ||
      nested.mobile ||
      nested.phoneNumber;
    const directCompany =
      payload.companyName ||
      payload.company_name ||
      payload.businessName ||
      payload.business_name ||
      nested.companyName ||
      nested.company_name;
    const directPlaceId =
      payload.googlePlaceId ||
      payload.placeId ||
      payload.place_id ||
      payload.lead_id ||
      nested.googlePlaceId ||
      nested.lead_id;

    if (!result.firstName && directFirstName) result.firstName = String(directFirstName).trim();
    if (!result.lastName && directLastName) result.lastName = String(directLastName).trim();
    if (!result.firstName && !result.lastName && directFullName) {
      const parts = String(directFullName).trim().split(/\s+/);
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ') || parts[0];
    }
    if (!result.email && directEmail) result.email = ContactExtractor.normalizeEmail(directEmail) || undefined;
    if (!result.phone && directPhone) result.phone = ContactExtractor.normalizePhoneNumber(directPhone) || undefined;
    if (!result.companyName && directCompany) result.companyName = String(directCompany).trim();
    if (!result.googlePlaceId && directPlaceId) result.googlePlaceId = String(directPlaceId).trim();

    return result;
  }

  private sanitizeLeadFields<T extends Record<string, any>>(dto: T): T {
    const isInvalid = (v: any) => {
      if (v === null || v === undefined) return true;
      if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return true;
        const u = t.toUpperCase();
        return u === 'N/A' || u === 'NA' || u === 'NONE' || u === 'NULL' || u === '-' || u === 'UNDEFINED';
      }
      return false;
    };

    const cleaned = { ...dto } as any;

    // 0. Extract from Google Discovery / Google Lead payload if present
    const isGooglePayload =
      (cleaned.source && String(cleaned.source).toUpperCase().includes('DISCOVERY')) ||
      (cleaned.source && String(cleaned.source).toUpperCase().includes('GOOGLE')) ||
      cleaned.user_column_data ||
      cleaned.column_data ||
      cleaned.form_data ||
      cleaned.fields ||
      cleaned.google_key ||
      cleaned.lead_id;

    if (isGooglePayload) {
      const googleData = this.parseGoogleLeadPayload(cleaned);
      if (googleData.firstName && !cleaned.firstName && !cleaned.first_name) cleaned.firstName = googleData.firstName;
      if (googleData.lastName && !cleaned.lastName && !cleaned.last_name) cleaned.lastName = googleData.lastName;
      if (googleData.email && !cleaned.email && !cleaned.emailAddress) cleaned.email = googleData.email;
      if (googleData.phone && !cleaned.phone && !cleaned.mobile) cleaned.phone = googleData.phone;
      if (googleData.companyName && !cleaned.companyName) cleaned.companyName = googleData.companyName;
      if (googleData.city && !cleaned.city) cleaned.city = googleData.city;
      if (googleData.state && !cleaned.state) cleaned.state = googleData.state;
      if (googleData.googlePlaceId && !cleaned.googlePlaceId) cleaned.googlePlaceId = googleData.googlePlaceId;
    }

    // Normalize source for Google Discovery
    if (
      (cleaned.source && String(cleaned.source).toUpperCase().includes('DISCOVERY')) ||
      cleaned.user_column_data ||
      cleaned.google_key ||
      cleaned.lead_id
    ) {
      if (!cleaned.source) {
        cleaned.source = 'Google Discovery';
      }
    }

    // 1. Resolve Contact Phone Aliases (mobile, mobileNumber, phoneNumber, phone_number, user_phone_number, contactNumber, phone)
    const rawPhone =
      cleaned.phone ??
      cleaned.mobile ??
      cleaned.mobileNumber ??
      cleaned.phoneNumber ??
      cleaned.phone_number ??
      cleaned.user_phone ??
      cleaned.user_phone_number ??
      cleaned.contactNumber;
    if (rawPhone !== undefined) {
      if (isInvalid(rawPhone)) {
        cleaned.phone = null;
      } else {
        const isGoogle =
          (cleaned.source && String(cleaned.source).toUpperCase().includes('DISCOVERY')) ||
          (cleaned.source && String(cleaned.source).toUpperCase().includes('GOOGLE')) ||
          cleaned.user_column_data ||
          cleaned.google_key ||
          cleaned.lead_id;
        if (isGoogle) {
          cleaned.phone = ContactExtractor.normalizePhoneNumber(rawPhone) || String(rawPhone).trim();
        } else {
          cleaned.phone = String(rawPhone).trim();
        }
      }
    }

    // 2. Resolve Contact Email Aliases (email, emailAddress, user_email, email_address)
    const rawEmail = cleaned.email ?? cleaned.emailAddress ?? cleaned.user_email ?? cleaned.email_address;
    if (rawEmail !== undefined) {
      if (isInvalid(rawEmail)) {
        cleaned.email = null;
      } else {
        cleaned.email = ContactExtractor.normalizeEmail(rawEmail);
      }
    }

    // Preserve captureRequestId and sourceRecordId if provided
    if (cleaned.captureRequestId) {
      cleaned.captureRequestId = String(cleaned.captureRequestId).trim();
    }
    if (cleaned.sourceRecordId) {
      cleaned.sourceRecordId = String(cleaned.sourceRecordId).trim();
    }

    // 3. Resolve Contact Name Aliases (firstName, first_name, lastName, last_name, name, full_name)
    let rawFirstName = cleaned.firstName ?? cleaned.first_name;
    let rawLastName = cleaned.lastName ?? cleaned.last_name;

    if (
      (!rawFirstName || isInvalid(rawFirstName)) &&
      (!rawLastName || isInvalid(rawLastName)) &&
      (cleaned.name || cleaned.full_name)
    ) {
      const parts = String(cleaned.name || cleaned.full_name).trim().split(/\s+/);
      if (parts.length > 0 && parts[0]) {
        rawFirstName = parts[0];
        rawLastName = parts.slice(1).join(' ') || parts[0];
      }
    }

    if (rawFirstName !== undefined) {
      cleaned.firstName = isInvalid(rawFirstName) ? '' : String(rawFirstName).trim();
    }
    if (rawLastName !== undefined) {
      cleaned.lastName = isInvalid(rawLastName) ? '' : String(rawLastName).trim();
    }

    // If firstName is still empty, derive fallback from title, companyName, email, or phone
    if (!cleaned.firstName && cleaned.title) {
      const parts = String(cleaned.title).trim().split(/\s+/);
      cleaned.firstName = parts[0] || 'Lead';
      if (!cleaned.lastName) {
        cleaned.lastName = parts.slice(1).join(' ') || cleaned.firstName;
      }
    } else if (!cleaned.firstName && cleaned.companyName) {
      const parts = String(cleaned.companyName).trim().split(/\s+/);
      cleaned.firstName = parts[0] || 'Lead';
      if (!cleaned.lastName) {
        cleaned.lastName = parts.slice(1).join(' ') || cleaned.firstName;
      }
    }

    // 4. Resolve Title if missing
    if (!cleaned.title || isInvalid(cleaned.title)) {
      const fullName = [cleaned.firstName, cleaned.lastName].filter(Boolean).join(' ').trim();
      cleaned.title = fullName || cleaned.companyName || cleaned.email || cleaned.phone || 'New Lead';
    }

    const optionalKeys = [
      'companyName',
      'website',
      'address',
      'city',
      'location',
      'state',
      'category',
      'googlePlaceId',
    ];

    for (const key of optionalKeys) {
      if (key in cleaned) {
        if (isInvalid(cleaned[key])) {
          cleaned[key] = null;
        } else if (typeof cleaned[key] === 'string') {
          cleaned[key] = cleaned[key].trim();
        }
      }
    }

    // Bi-directional fallback between city and location
    if (!cleaned.city && cleaned.location) {
      cleaned.city = cleaned.location;
    }
    if (!cleaned.location && cleaned.city) {
      cleaned.location = cleaned.city;
    }

    // Strip transient webhook / mapper fields so Prisma model does not receive unknown properties
    delete cleaned.lead_stage;
    delete cleaned.user_column_data;
    delete cleaned.column_data;
    delete cleaned.form_data;
    delete cleaned.fields;
    delete cleaned.google_key;
    delete cleaned.lead_id;
    delete cleaned.place_id;
    delete cleaned.lead_data;
    delete cleaned.google_lead;
    delete cleaned.user_email;
    delete cleaned.email_address;
    delete cleaned.emailAddress;
    delete cleaned.user_phone;
    delete cleaned.user_phone_number;
    delete cleaned.phone_number;
    delete cleaned.mobileNumber;
    delete cleaned.contactNumber;
    delete cleaned.first_name;
    delete cleaned.last_name;

    return cleaned;
  }

  private async validateBpoEmployeeAssignment(
    customerId: number | string,
    assignedToId?: number | string | null,
  ): Promise<{ assignedToId: number | null; employeeId: number | null } | undefined> {
    if (assignedToId === undefined) {
      return undefined;
    }

    if (assignedToId === null || assignedToId === '' || assignedToId === 0 || assignedToId === '0') {
      return { assignedToId: null, employeeId: null };
    }

    const targetId = Number(assignedToId);
    if (isNaN(targetId)) {
      throw new BadRequestException('Invalid employee ID provided for lead assignment');
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: targetId },
          { id: targetId },
        ],
        customerId: Number(customerId),
      },
      include: {
        department: true,
        designation: true,
        teamMembers: {
          include: { team: true },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Assigned employee does not exist in this workspace');
    }

    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot assign lead to an inactive employee');
    }

    const deptStr = `${employee.department?.name || ''} ${employee.department?.code || ''}`.toLowerCase();
    const desigStr = `${employee.designation?.name || ''} ${employee.designation?.code || ''}`.toLowerCase();
    const teamStr = (employee.teamMembers || [])
      .map((tm) => tm.team?.name || '')
      .join(' ')
      .toLowerCase();

    const isBpo =
      deptStr.includes('bpo') ||
      desigStr.includes('bpo') ||
      teamStr.includes('bpo');

    if (!isBpo) {
      throw new BadRequestException('Only BPO employees/representatives can be assigned to leads');
    }

    return {
      assignedToId: employee.userId || targetId,
      employeeId: employee.id,
    };
  }

  async createLead(customerId: number | string, userOrId: any, dto: CreateLeadDto) {
    this.logger.log('[NewLeadAutomation] 1. Create Lead request received');

    const rawInputEmail = dto.email || (dto as any).emailAddress || (dto as any).user_email || (dto as any).email_address;
    const hasRawEmail = Boolean(rawInputEmail && String(rawInputEmail).trim().length > 0 && !['contact@company.com', 'placeholder@company.com', 'example@company.com'].includes(String(rawInputEmail).trim().toLowerCase()));
    this.logger.log(`[NewLeadAutomation] 2. Email received:\n${hasRawEmail}`);

    const isGoogleLead =
      String(dto.source || '').toUpperCase().includes('GOOGLE') ||
      String(dto.source || '').toUpperCase().includes('DISCOVERY') ||
      String(dto.source || '') === 'GOOGLE_PLACES' ||
      Boolean(
        (dto as any).user_column_data ||
        (dto as any).column_data ||
        (dto as any).google_key ||
        (dto as any).lead_id,
      );
    const isGoogleDiscovery = isGoogleLead;

    if (isGoogleLead) {
      this.logger.log('[GoogleLead]\nNew Google lead received');
      this.logger.log('[GoogleDiscovery]\nNew lead received');
    } else {
      this.logger.log('[LeadCapture]\nRequest received');
    }

    const hasFirstName = Boolean(dto.firstName || (dto as any).first_name || (dto as any).name || (dto as any).full_name);
    const hasLastName = Boolean(dto.lastName || (dto as any).last_name || (dto as any).name || (dto as any).full_name);
    const hasEmail = hasRawEmail;
    const hasMobile = Boolean(
      dto.phone ||
      (dto as any).mobile ||
      (dto as any).mobileNumber ||
      (dto as any).phoneNumber ||
      (dto as any).phone_number ||
      (dto as any).user_phone ||
      (dto as any).user_phone_number ||
      (dto as any).contactNumber,
    );

    if (!isGoogleLead) {
      this.logger.log(`[LeadCapture]\nFirst name present: ${hasFirstName}\nLast name present: ${hasLastName}\nEmail present: ${hasEmail}\nMobile present: ${hasMobile}`);
    }

    const user = typeof userOrId === 'object' ? userOrId : { id: userOrId };
    const isSuperAdmin = isUserSuperAdmin(user);

    if (this.planAccessService && !isSuperAdmin) {
      await this.planAccessService.checkLeadLimit(customerId);
    }

    const userId = Number(user.id);

    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);
    const numCustomerId = Number(customerId);
    let resolvedStageId: number | undefined = dto.stageId ? Number(dto.stageId) : undefined;
    let resolvedStatus: LeadStatus = LeadStatus.NEW;

    const cleaned = this.sanitizeLeadFields(dto);

    if (isGoogleLead) {
      this.logger.log(
        `[GoogleDiscovery]\nFirst name present: ${Boolean(cleaned.firstName)}\nLast name present: ${Boolean(cleaned.lastName)}\nEmail present: ${Boolean(cleaned.email)}\nMobile present: ${Boolean(cleaned.phone)}`,
      );
      this.logger.log('[GoogleDiscovery]\nMapping completed');
    } else {
      this.logger.log('[LeadCapture]\nMapped Lead fields successfully');
    }

    // 1. Check idempotency if captureRequestId is present (rapid double-click protection)
    if (cleaned.captureRequestId) {
      const existingLeadByReq = await this.prisma.lead.findFirst({
        where: {
          customerId: numCustomerId,
          captureRequestId: cleaned.captureRequestId,
          deletedAt: null,
        },
        include: { stage: true },
      });
      if (existingLeadByReq) {
        this.logger.log(`[DATA CAPTURE DEBUG] Idempotency match found for captureRequestId: ${cleaned.captureRequestId}`);
        return this.getLeadById(customerId, existingLeadByReq.id);
      }
    }

    // 2. Check if an existing Lead exists for this customer (Create vs Update)
    let existingLead: any = null;
    const lookupConditions: any[] = [];
    if (cleaned.googlePlaceId) {
      lookupConditions.push({ googlePlaceId: cleaned.googlePlaceId });
    }
    if (cleaned.phone && cleaned.phone !== 'N/A' && cleaned.phone.length >= 10) {
      lookupConditions.push({ phone: cleaned.phone });
    }
    if (cleaned.email && cleaned.email.includes('@')) {
      lookupConditions.push({ email: cleaned.email });
    }

    if (lookupConditions.length > 0 && isGoogleLead) {
      existingLead = await this.prisma.lead.findFirst({
        where: {
          customerId: numCustomerId,
          deletedAt: null,
          OR: lookupConditions,
        },
        include: {
          stage: true,
        },
      });
    }

    this.logger.log(
      `[DATA CAPTURE DEBUG]\n` +
      `captureRequestId: ${cleaned.captureRequestId || 'none'}\n` +
      `source: ${dto.source || 'GOOGLE_PLACES'}\n` +
      `sourceRecordId: ${cleaned.sourceRecordId || cleaned.googlePlaceId || 'none'}\n` +
      `companyName: ${cleaned.companyName || cleaned.title}\n` +
      `normalizedPhone: ${cleaned.phone || 'none'}\n` +
      `normalizedEmail: ${cleaned.email || 'none'}\n` +
      `existingLeadId: ${existingLead?.id || 'none'}`
    );

    if (existingLead && isGoogleLead) {
      this.logger.log('[GoogleLead]\nExisting lead found: true');
      this.logger.log('[GoogleDiscovery]\nExisting lead found: true');
      const preservedStageName = existingLead.stage?.name || existingLead.status || 'Negotiation';
      this.logger.log(`[GoogleLead]\nPreserving existing stage: ${preservedStageName}`);
      this.logger.log(`[GoogleDiscovery]\nPreserving existing stage: ${preservedStageName}`);

      // Update existing lead without overwriting non-empty fields with blank/null
      const updateData: any = {};
      if (cleaned.firstName) updateData.firstName = cleaned.firstName;
      if (cleaned.lastName) updateData.lastName = cleaned.lastName;
      if (cleaned.phone) updateData.phone = cleaned.phone;
      if (cleaned.email) updateData.email = cleaned.email;
      if (cleaned.companyName) updateData.companyName = cleaned.companyName;
      if (cleaned.city) updateData.city = cleaned.city;
      if (cleaned.state) updateData.state = cleaned.state;
      if (cleaned.category) updateData.category = cleaned.category;
      if (cleaned.website) updateData.website = cleaned.website;
      if (cleaned.address) updateData.address = cleaned.address;
      if (cleaned.googlePlaceId && !existingLead.googlePlaceId) updateData.googlePlaceId = cleaned.googlePlaceId;

      await this.leadRepository.update(customerId, existingLead.id, updateData);
      await this.leadRepository.logTimeline(
        existingLead.id,
        'LEAD_UPDATED',
        `Lead updated from ${dto.source || 'Google Discovery'}`,
      );

      this.logger.log(`[GoogleDiscovery]\nCreating/updating Lead\n\nLead ID: ${existingLead.id}`);

      return this.getLeadById(customerId, existingLead.id);
    }

    if (isGoogleLead) {
      this.logger.log('[GoogleLead]\nExisting lead found: false');
      this.logger.log('[GoogleLead]\nInitial CRM stage resolved: NEW');
      this.logger.log('[GoogleLead]\nCreating Lead');
      this.logger.log('[GoogleDiscovery]\nExisting lead found: false');
      this.logger.log('[GoogleDiscovery]\nAssigning initial CRM stage: New');

      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        try {
          await this.leadRepository.ensureDefaultStagesForCustomer(numCustomerId);
        } catch (_) {}
      }

      // For a BRAND-NEW Google Discovery / Google Places lead, stage MUST always be New
      resolvedStatus = LeadStatus.NEW;
      let newStage = await this.prisma.leadStage.findFirst({
        where: {
          customerId: numCustomerId,
          key: 'NEW',
          deletedAt: null,
          isActive: true,
        },
        orderBy: { sortOrder: 'asc' },
      });
      if (!newStage) {
        newStage = await this.prisma.leadStage.findFirst({
          where: {
            customerId: null,
            key: 'NEW',
            deletedAt: null,
            isActive: true,
          },
          orderBy: { sortOrder: 'asc' },
        });
      }
      if (!newStage) {
        newStage = await this.prisma.leadStage.findFirst({
          where: {
            key: 'NEW',
            deletedAt: null,
          },
          orderBy: { id: 'asc' },
        });
      }
      if (newStage) {
        resolvedStageId = newStage.id;
      }
    } else {
      if (resolvedStageId) {
        const stage = await this.leadRepository.findStageById(resolvedStageId);
        if (stage) {
          const normKey = normalizeLeadStatus(stage.key);
          if (ALL_LEAD_STATUSES.includes(normKey)) {
            resolvedStatus = normKey as LeadStatus;
          }
        }
      } else if (dto.status) {
        const normStatus = normalizeLeadStatus(dto.status);
        if (ALL_LEAD_STATUSES.includes(normStatus)) {
          resolvedStatus = normStatus as LeadStatus;
        }
      }

      // Guarantee newly created leads have a valid persisted stageId
      if (!resolvedStageId && this.prisma.leadStage) {
        if (!isNaN(numCustomerId) && numCustomerId > 0) {
          try {
            await this.leadRepository.ensureDefaultStagesForCustomer(numCustomerId);
          } catch (_) {}
        }
        let defaultStage = await this.prisma.leadStage.findFirst({
          where: {
            customerId: numCustomerId,
            key: resolvedStatus || 'NEW',
            deletedAt: null,
            isActive: true,
          },
          orderBy: { sortOrder: 'asc' },
        });
        if (!defaultStage) {
          defaultStage = await this.prisma.leadStage.findFirst({
            where: {
              customerId: null,
              key: resolvedStatus || 'NEW',
              deletedAt: null,
              isActive: true,
            },
            orderBy: { sortOrder: 'asc' },
          });
        }
        if (defaultStage) {
          resolvedStageId = defaultStage.id;
        }
      }
    }

    const assignment = await this.validateBpoEmployeeAssignment(customerId, cleaned.assignedToId);

    const sanitizedDto = {
      ...cleaned,
      source: cleaned.source || (isGoogleDiscovery ? 'Google Discovery' : 'WEBSITE'),
      status: resolvedStatus,
      ...(resolvedStageId ? { stageId: resolvedStageId } : {}),
      ...(assignment !== undefined ? { assignedToId: assignment.assignedToId, employeeId: assignment.employeeId } : {}),
    };

    // Concurrency-safe atomic check and lead creation within a transaction
    const lead = await this.prisma.$transaction(async (tx) => {
      let employeeId: number | null = null;
      if (this.leadLimitService) {
        const limitRes = await this.leadLimitService.validateAndConsumeLeadLimit(tx, customerId, user);
        employeeId = limitRes.employeeId;
      }
      return this.leadRepository.create(customerId, userId, sanitizedDto as any, employeeId, tx);
    });

    if (isGoogleDiscovery) {
      this.logger.log(`[GoogleDiscovery]\nCreating/updating Lead\n\nLead ID: ${lead.id}`);
    } else {
      this.logger.log(`[LeadCapture]\nLead created/updated:\nLead ID: ${lead.id}`);
    }

    await this.leadRepository.logTimeline(
      lead.id,
      'LEAD_CREATED',
      `Lead "${lead.title}" was created via ${dto.source || 'WEBSITE'}`,
      { source: dto.source, value: dto.value },
    );

    // Retrieve fresh lead with stage and customer relations populated
    const createdLead = await this.getLeadById(customerId, lead.id).catch(() => lead);
    const initialStageName = createdLead.stage?.name || createdLead.status || 'New';
    const savedEmailExists = Boolean(createdLead.email && createdLead.email.trim().length > 0);

    if (isGoogleLead) {
      this.logger.log(`[GoogleLead]\nLead created:\nLead ID: ${createdLead.id}\nStage: NEW`);
      this.logger.log('[GoogleLead]\nNew-stage automation triggered');
      this.logger.log(`[GoogleDiscovery]\nLead created:\nLead ID: ${createdLead.id}\nStage: ${initialStageName}`);
      this.logger.log('[GoogleDiscovery]\nNew-stage automation triggered');
    }

    this.logger.log(`[NewLeadAutomation] 3. Lead created:\nLead ID = ${createdLead.id}`);
    this.logger.log(`[NewLeadAutomation] 4. Saved email exists:\n${savedEmailExists}`);
    this.logger.log(`[NewLeadAutomation] 5. Initial stage:\n${initialStageName}`);
    this.logger.log(`[NewLead]\nEmail received: ${hasRawEmail}\nEmail saved: ${savedEmailExists}\nStage: ${initialStageName}`);

    this.logger.log(`[LeadNotification] 1. New lead creation received`);
    this.logger.log(`[LeadNotification] 2. Database update successful`);
    this.logger.log(`[LeadNotification] 3. New stage identified: ${initialStageName}`);
    this.logger.log(
      `[LeadNotification]\nTrigger started\nLead ID: ${createdLead.id}\nNew Stage: ${initialStageName}`,
    );

    // Automated communication for NEW LEAD CREATED
    const leadCreatedIso = new Date().toISOString();
    this.logger.log(`[EMAIL_TIMING] Lead created time: ${leadCreatedIso}`);

    // 1. Email automation using initial stage template:
    let emailPromise: Promise<any> = Promise.resolve();
    if (!savedEmailExists) {
      this.logger.log('Automatic email skipped because Lead email is missing.');
    } else {
      this.logger.log('[NewLeadAutomation] 6. New-stage email automation started');
      this.logger.log(`[NewLeadEmail]\nStage: ${initialStageName}`);
      emailPromise = this.handleLeadStageChangeNotification(
        customerId,
        createdLead,
        '',
        initialStageName,
        userId,
        undefined,
        undefined,
        undefined,
        'LEAD_CREATED',
      ).catch((err) => {
        this.logger.error(`[NEW_LEAD_EMAIL_NOTIFICATION_ERROR] ${err?.message}`);
      });
    }

    // 2. WhatsApp automation using initial stage template:
    const whatsappPromise = this.handleLeadStageChangeWhatsappNotification(
      customerId,
      createdLead,
      '',
      initialStageName,
      userId,
      undefined,
      undefined,
      'LEAD_CREATED',
    ).catch((err) => {
      this.logger.error(`[NEW_LEAD_WHATSAPP_NOTIFICATION_ERROR] ${err?.message}`);
    });

    const notifService = this.getNotificationService();
    let pushPromise = Promise.resolve();
    if (notifService) {
      pushPromise = (async () => {
        try {
          const customerUser = await this.prisma.user.findFirst({
            where: { customerId: Number(customerId), deletedAt: null },
            select: { id: true },
          }).catch(() => null);
          if (customerUser) {
            await notifService.sendPushNotification({
              customerId: Number(customerId),
              userId: customerUser.id,
              title: `New Lead Created: ${initialStageName}`,
              body: `Lead "${createdLead.title || createdLead.companyName || (createdLead.firstName + ' ' + createdLead.lastName).trim()}" has been captured.`,
              type: 'LEAD_CREATED',
              data: {
                leadId: String(createdLead.id),
                stage: initialStageName,
                channel: 'LEAD',
              },
            });
          }
        } catch (err: any) {
          this.logger.warn(`[LeadNotification] Push notification error on create: ${err?.message}`);
        }
      })();
    }

    await Promise.allSettled([emailPromise, whatsappPromise, pushPromise]);

    if (assignment?.assignedToId) {
      const notifService = this.getNotificationService();
      if (notifService) {
        notifService.sendPushNotification({
          userId: Number(assignment.assignedToId),
          customerId: Number(customerId),
          title: 'New Lead Assigned',
          body: `You have been assigned to lead "${lead.companyName || lead.title || lead.firstName || 'Lead #' + lead.id}".`,
          type: 'LEAD_ASSIGNED',
          data: {
            leadId: String(lead.id),
            customerId: String(customerId),
            channel: 'LEAD',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        }).catch((err) => this.logger.warn(`Failed to dispatch LEAD_ASSIGNED push: ${err?.message}`));
      }
    }

    return lead;
  }

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateDto) {
    return this.leadRepository.checkDuplicate(customerId, dto);
  }

  async getStages(customerId?: number | string, includeInactive = true) {
    // Stage Management is the SINGLE SOURCE OF TRUTH.
    // Auto-seed default stages for a new workspace on first call.
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    try {
      await this.leadRepository.ensureDefaultStagesForCustomer(numCustomerId);
    } catch (err) {
      console.warn('[LeadService] ensureDefaultStagesForCustomer failed (non-fatal):', err);
    }

    let dbStages: any[] = [];
    try {
      dbStages = await this.leadRepository.findStages(customerId, includeInactive) ?? [];
    } catch (err) {
      console.error('[LeadService] getStages DB query failed:', err);
      return [];
    }

    return dbStages
      .map((stage: any) => ({
        id: stage.id,
        key: stage.key,
        name: stage.name,
        label: stage.name,
        color: stage.color,
        bgColor: stage.bgColor,
        borderColor: stage.borderColor,
        sortOrder: stage.sortOrder,
        isActive: stage.isActive,
        isSystem: stage.isSystem ?? false,
        leadsCount: stage._count?.leads ?? 0,
      }))
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  async createStage(customerId: number | string | undefined, user: any, dto: CreateLeadStageDto) {
    return this.leadRepository.createStage(customerId, dto);
  }

  async updateStage(customerId: number | string | undefined, user: any, id: number | string, dto: UpdateLeadStageDto) {
    const stage = await this.leadRepository.findStageById(id);
    if (!stage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    return this.leadRepository.updateStage(id, dto);
  }

  async reorderStages(customerId: number | string | undefined, user: any, dto: ReorderLeadStagesDto) {
    if (!dto.stages || dto.stages.length === 0) {
      throw new BadRequestException('stages array cannot be empty.');
    }
    return this.leadRepository.reorderStages(customerId, dto.stages);
  }

  async deleteStage(customerId: number | string | undefined, user: any, id: number | string) {
    const stage = await this.leadRepository.findStageById(id);
    if (!stage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    const leadCount = await this.leadRepository.countLeadsForStage(id, stage.key);
    if (leadCount > 0) {
      throw new BadRequestException(
        `Cannot delete stage "${stage.name}" because it is currently assigned to ${leadCount} lead(s). Please reassign existing leads or deactivate the stage instead.`,
      );
    }
    return this.leadRepository.deleteStage(id);
  }

  async getLeads(customerId: number | string | undefined, query: { page?: number; limit?: number; search?: string; status?: string; stageId?: string | number }, user?: any) {
    return this.leadRepository.findAll(customerId, query, user);
  }

  async getLeadById(customerId: number | string, id: number | string) {
    const lead = await this.leadRepository.findOne(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }
    return lead;
  }

  async getLeadStatus(customerId: number | string, id: number | string) {
    const lead = await this.getLeadById(customerId, id);
    let stage = lead.stage;
    if (!stage && lead.stageId) {
      stage = await this.leadRepository.findStageById(lead.stageId);
    }
    if (!stage && lead.status) {
      const stages = await this.leadRepository.findStages(customerId);
      const match = stages.find((s: any) => s.key === lead.status);
      if (match) {
        stage = match;
      }
    }
    return {
      ...lead,
      leadId: lead.id,
      status: lead.status,
      stageId: lead.stageId ?? stage?.id ?? null,
      stage: stage ?? null,
      statusHistory: lead.statusHistory ?? [],
    };
  }

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto, userId?: number | string) {
    const lead = await this.getLeadById(customerId, id);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    let resolvedStageId: number | undefined = dto.stageId !== undefined ? (dto.stageId ? Number(dto.stageId) : undefined) : undefined;
    let resolvedStatus: LeadStatus | undefined = undefined;
    let stageName: string | undefined = undefined;

    if (resolvedStageId) {
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (stage) {
        stageName = stage.name;
        const normKey = normalizeLeadStatus(stage.key);
        if (ALL_LEAD_STATUSES.includes(normKey)) {
          resolvedStatus = normKey as LeadStatus;
        } else {
          // Custom stage: keep existing lead status
          resolvedStatus = lead.status as LeadStatus;
        }
      }
    } else if (dto.status) {
      const normStatus = normalizeLeadStatus(dto.status);
      if (ALL_LEAD_STATUSES.includes(normStatus)) {
        resolvedStatus = normStatus as LeadStatus;
      } else {
        resolvedStatus = lead.status as LeadStatus;
      }
    }

    const cleaned = this.sanitizeLeadFields(dto);
    const assignment = await this.validateBpoEmployeeAssignment(customerId, cleaned.assignedToId);

    const sanitizedDto = {
      ...cleaned,
      ...(resolvedStageId !== undefined ? { stageId: resolvedStageId } : {}),
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(assignment !== undefined ? { assignedToId: assignment.assignedToId, employeeId: assignment.employeeId } : {}),
    };

    const previousStageName = lead.stage?.name || lead.status || 'NEW';
    const isStageChanged =
      (resolvedStageId !== undefined && resolvedStageId !== lead.stageId) ||
      (resolvedStatus !== undefined && resolvedStatus !== lead.status);

    await this.leadRepository.update(customerId, id, sanitizedDto as any);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );

    if (assignment?.assignedToId && assignment.assignedToId !== lead.assignedToId) {
      const notifService = this.getNotificationService();
      if (notifService) {
        notifService.sendPushNotification({
          userId: Number(assignment.assignedToId),
          customerId: Number(customerId),
          title: 'New Lead Assigned',
          body: `You have been assigned to lead "${lead.companyName || lead.title || lead.firstName || 'Lead #' + id}".`,
          type: 'LEAD_ASSIGNED',
          data: {
            leadId: String(id),
            customerId: String(customerId),
            channel: 'LEAD',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        }).catch((err) => this.logger.warn(`Failed to dispatch LEAD_ASSIGNED push: ${err?.message}`));
      }
    }

    const updatedLead = await this.getLeadById(customerId, id);

    let emailNotification: {
      sent: boolean;
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      recipient: string | null;
      messageId: string | null;
      error: string | null;
      message: string;
    } = {
      sent: false,
      status: 'SKIPPED',
      recipient: null,
      messageId: null,
      error: null,
      message: isStageChanged ? 'Email skipped' : 'Stage not changed',
    };

    let whatsappNotification: {
      sent: boolean;
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      recipient: string | null;
      messageId: string | null;
      error: string | null;
      message: string;
      details?: string | null;
    } = {
      sent: false,
      status: 'SKIPPED',
      recipient: null,
      messageId: null,
      error: null,
      message: isStageChanged ? 'WhatsApp skipped' : 'Stage not changed',
    };

    if (isStageChanged) {
      const newStageName = stageName || updatedLead.stage?.name || resolvedStatus || updatedLead.status || 'UPDATED';
      this.logger.log(`[LEAD_STAGE] Stage change detected`);
      this.logger.log(`[LEAD_STAGE] Lead: ${id}`);
      this.logger.log(`[LEAD_STAGE] Old stage: ${previousStageName}`);
      this.logger.log(`[LEAD_STAGE] New stage: ${newStageName}`);

      const emailPromise = dto.sendEmail !== false
        ? this.handleLeadStageChangeNotification(
            customerId,
            updatedLead,
            previousStageName,
            newStageName,
            userId,
            dto.templateId,
            dto.customSubject,
            dto.customBody,
            'LEAD_STAGE_CHANGED',
          )
        : Promise.resolve(emailNotification);
      const whatsappPromise = dto.sendWhatsapp !== false
        ? this.handleLeadStageChangeWhatsappNotification(
            customerId,
            updatedLead,
            previousStageName,
            newStageName,
            userId,
            dto.whatsappMessage,
            dto.whatsappTemplateName,
            'LEAD_STAGE_CHANGED',
          )
        : Promise.resolve(whatsappNotification);

      const notifService = this.getNotificationService();
      let pushPromise = Promise.resolve();
      if (notifService) {
        pushPromise = (async () => {
          try {
            const customerUser = await this.prisma.user.findFirst({
              where: { customerId: Number(customerId), deletedAt: null },
              select: { id: true },
            }).catch(() => null);
            if (customerUser) {
              await notifService.sendPushNotification({
                customerId: Number(customerId),
                userId: customerUser.id,
                title: `Lead Stage Updated: ${newStageName}`,
                body: `Lead "${updatedLead.title || updatedLead.companyName || (updatedLead.firstName + ' ' + updatedLead.lastName).trim()}" is now in ${newStageName} stage.`,
                type: 'LEAD_STAGE_CHANGED',
                data: {
                  leadId: String(updatedLead.id),
                  oldStage: String(previousStageName),
                  newStage: String(newStageName),
                  channel: 'LEAD',
                },
              });
            }
          } catch (err: any) {
            this.logger.warn(`[LeadNotification] Push notification error on update: ${err?.message}`);
          }
        })();
      }

      const [emailSettled, whatsappSettled] = await Promise.allSettled([emailPromise, whatsappPromise, pushPromise]);
      if (emailSettled.status === 'fulfilled' && emailSettled.value) {
        emailNotification = emailSettled.value as any;
      } else if (emailSettled.status === 'rejected') {
        emailNotification = {
          sent: false,
          status: 'FAILED',
          recipient: null,
          messageId: null,
          error: emailSettled.reason?.message || 'Email delivery failed',
          message: 'Email delivery failed',
        };
      }

      if (whatsappSettled.status === 'fulfilled' && whatsappSettled.value) {
        whatsappNotification = whatsappSettled.value as any;
      } else if (whatsappSettled.status === 'rejected') {
        whatsappNotification = {
          sent: false,
          status: 'FAILED',
          recipient: null,
          messageId: null,
          error: whatsappSettled.reason?.message || 'WhatsApp delivery failed',
          message: 'WhatsApp delivery failed',
        };
      }
    }

    return {
      ...updatedLead,
      emailNotification,
      whatsappNotification,
    };
  }

  async updateStatus(customerId: number | string, id: number | string, userId: number | string, dto: UpdateLeadStatusDto) {
    const lead = await this.getLeadById(customerId, id);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    let resolvedStageId: number | undefined = dto.stageId ? Number(dto.stageId) : undefined;
    let resolvedStatus: LeadStatus = lead.status as LeadStatus;
    let stageName: string | undefined;

    if (resolvedStageId) {
      // 1. Resolve LeadStage from DB
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (!stage) {
        throw new NotFoundException(`Lead stage with ID ${resolvedStageId} not found`);
      }

      stageName = stage.name;

      // 2. Tenant verification (workspace/company/tenant isolation)
      const numCustomerId = Number(customerId);
      if (
        stage.customerId !== null &&
        !isNaN(numCustomerId) &&
        numCustomerId > 0 &&
        Number(stage.customerId) !== numCustomerId
      ) {
        throw new ForbiddenException('Lead stage does not belong to your company/workspace');
      }

      // 3. Prevent assigning inactive stages (unless lead was already on this stage)
      if (!stage.isActive && lead.stageId !== stage.id) {
        throw new BadRequestException(`Cannot transition lead to inactive stage "${stage.name}"`);
      }

      // 4. Map to legacy status ONLY if there is a valid enum match, otherwise keep existing lead.status
      const normKey = normalizeLeadStatus(stage.key);
      if (ALL_LEAD_STATUSES.includes(normKey)) {
        resolvedStatus = normKey as LeadStatus;
      } else if (dto.status) {
        const normDtoStatus = normalizeLeadStatus(dto.status);
        if (ALL_LEAD_STATUSES.includes(normDtoStatus)) {
          resolvedStatus = normDtoStatus as LeadStatus;
        }
      }
    } else if (dto.status) {
      // Legacy status update without stageId
      const normStatus = normalizeLeadStatus(dto.status);
      if (!ALL_LEAD_STATUSES.includes(normStatus)) {
        throw new BadRequestException(`Invalid status "${dto.status}". Must be a recognized status or supply a valid stageId.`);
      }
      resolvedStatus = normStatus as LeadStatus;
      // Try to resolve matching stage for this tenant
      const stages = await this.leadRepository.findStages(customerId);
      const matchStage = stages.find((s: any) => s.key === resolvedStatus);
      if (matchStage) {
        resolvedStageId = matchStage.id;
        stageName = matchStage.name;
      }
    } else {
      throw new BadRequestException('Either stageId or status must be provided.');
    }

    // Detect if stage or status actually changed
    const previousStageName = lead.stage?.name || lead.status || 'New';
    const newStageName = stageName || resolvedStatus;

    const normPrev = (previousStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const normNew = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const normPrevStatus = (lead.status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const normResolvedStatus = (resolvedStatus || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

    const isStageIdChanged = resolvedStageId !== undefined && resolvedStageId !== lead.stageId;
    const isStageNameChanged = normPrev !== normNew;
    const isStatusChanged = normPrevStatus !== normResolvedStatus;

    // A stage change occurs if the stage ID changed, or both the name/status normalized keys changed
    const isStageChanged = isStageIdChanged || isStageNameChanged || isStatusChanged;

    let emailNotification: {
      sent: boolean;
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      recipient: string | null;
      messageId: string | null;
      error: string | null;
      message: string;
    } = {
      sent: false,
      status: 'SKIPPED',
      recipient: null,
      messageId: null,
      error: null,
      message: isStageChanged ? 'Email skipped' : 'Stage not changed',
    };

    let whatsappNotification: {
      sent: boolean;
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      recipient: string | null;
      messageId: string | null;
      error: string | null;
      message: string;
      details?: string | null;
    } = {
      sent: false,
      status: 'SKIPPED',
      recipient: null,
      messageId: null,
      error: null,
      message: isStageChanged ? 'WhatsApp skipped' : 'Stage not changed',
    };

    if (isStageChanged) {
      this.logger.log(`[LEAD_STAGE] Stage change detected`);
      this.logger.log(`[LEAD_STAGE] Lead: ${id}`);
      this.logger.log(`[LEAD_STAGE] Old stage: ${previousStageName}`);
      this.logger.log(`[LEAD_STAGE] New stage: ${newStageName}`);
    }

    await this.leadRepository.updateStatus(
      customerId,
      id,
      lead.status,
      resolvedStatus,
      userId,
      dto.notes,
      resolvedStageId,
      lead.stageId,
      stageName,
    );

    const updatedLead = await this.getLeadById(customerId, id);

    // If stage actually changed, trigger automatic customer Email, WhatsApp & Push notifications concurrently without cross-blocking
    if (isStageChanged) {
      const emailPromise = dto.sendEmail !== false
        ? this.handleLeadStageChangeNotification(
            customerId,
            updatedLead,
            previousStageName,
            newStageName,
            userId,
            dto.templateId,
            dto.customSubject,
            dto.customBody,
            'LEAD_STAGE_CHANGED',
          )
        : Promise.resolve(emailNotification);

      const whatsappPromise = dto.sendWhatsapp !== false
        ? this.handleLeadStageChangeWhatsappNotification(
            customerId,
            updatedLead,
            previousStageName,
            newStageName,
            userId,
            dto.whatsappMessage,
            dto.whatsappTemplateName,
            'LEAD_STAGE_CHANGED',
          )
        : Promise.resolve(whatsappNotification);

      const notifService = this.getNotificationService();
      let pushPromise = Promise.resolve();
      if (notifService) {
        pushPromise = (async () => {
          try {
            const customerUser = await this.prisma.user.findFirst({
              where: { customerId: Number(customerId), deletedAt: null },
              select: { id: true },
            }).catch(() => null);
            if (customerUser) {
              await notifService.sendPushNotification({
                customerId: Number(customerId),
                userId: customerUser.id,
                title: `Lead Stage Updated: ${newStageName}`,
                body: `Lead "${updatedLead.title || updatedLead.companyName || (updatedLead.firstName + ' ' + updatedLead.lastName).trim()}" is now in ${newStageName} stage.`,
                type: 'LEAD_STAGE_CHANGED',
                data: {
                  leadId: String(updatedLead.id),
                  oldStage: String(previousStageName),
                  newStage: String(newStageName),
                  channel: 'LEAD',
                },
              });
            }
          } catch (err: any) {
            this.logger.warn(`[LeadNotification] Push notification error on status update: ${err?.message}`);
          }
        })();
      }

      const [emailSettled, whatsappSettled] = await Promise.allSettled([emailPromise, whatsappPromise, pushPromise]);
      if (emailSettled.status === 'fulfilled' && emailSettled.value) {
        emailNotification = emailSettled.value as any;
      } else if (emailSettled.status === 'rejected') {
        emailNotification = {
          sent: false,
          status: 'FAILED',
          recipient: null,
          messageId: null,
          error: emailSettled.reason?.message || 'Email delivery failed',
          message: 'Email delivery failed',
        };
      }

      if (whatsappSettled.status === 'fulfilled' && whatsappSettled.value) {
        whatsappNotification = whatsappSettled.value as any;
      } else if (whatsappSettled.status === 'rejected') {
        whatsappNotification = {
          sent: false,
          status: 'FAILED',
          recipient: null,
          messageId: null,
          error: whatsappSettled.reason?.message || 'WhatsApp delivery failed',
          message: 'WhatsApp delivery failed',
        };
      }
    }

    return {
      ...updatedLead,
      emailNotification,
      whatsappNotification,
    };
  }

  /**
   * Dispatches automatic email notification to customer upon lead stage change.
   * Ensures email failure never causes the lead update to fail.
   */
  async handleLeadStageChangeNotification(
    customerId: number | string,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number | string,
    overrideTemplateId?: number,
    customSubject?: string,
    customBody?: string,
    eventType: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' = 'LEAD_STAGE_CHANGED',
  ): Promise<{
    sent: boolean;
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    recipient: string | null;
    messageId: string | null;
    error: string | null;
    message: string;
  }> {
    try {
      // 0. Do NOT send email if stage did not actually change (for stage change events)
      const normPrevStage = (previousStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normNewStageForCheck = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      if (
        eventType === 'LEAD_STAGE_CHANGED' &&
        normPrevStage &&
        normNewStageForCheck &&
        normPrevStage === normNewStageForCheck
      ) {
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: null,
          message: 'Stage did not change',
        };
      }

      // 1. Resolve template mapping strictly for the NEW stage
      const normNewStage = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normLeadStageKey = (lead.stage?.key || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const targetStageKey = normNewStage || normLeadStageKey;

      const candidateKeys = Array.from(
        new Set([
          TELECALLER_STATUS_TO_TEMPLATE_KEY[targetStageKey],
          TELECALLER_STATUS_TO_TEMPLATE_KEY[normLeadStageKey],
          TELECALLER_STATUS_TO_TEMPLATE_KEY[normNewStage],
          targetStageKey === 'WON' ? 'QUIKBOOM_DEAL_WON' : null,
          targetStageKey === 'LOST' ? 'QUIKBOOM_DEAL_LOST' : null,
          normNewStage === 'WON' ? 'QUIKBOOM_DEAL_WON' : null,
          normNewStage === 'LOST' ? 'QUIKBOOM_DEAL_LOST' : null,
          targetStageKey === 'WON' ? 'QUIKBOOM_WON' : null,
          targetStageKey === 'LOST' ? 'QUIKBOOM_LOST' : null,
          normNewStage === 'WON' ? 'QUIKBOOM_WON' : null,
          normNewStage === 'LOST' ? 'QUIKBOOM_LOST' : null,
          `QUIKBOOM_${targetStageKey}`,
          `QUIKBOOM_${normLeadStageKey}`,
          `QUIKBOOM_${normNewStage}`,
          `LEAD_STAGE_${targetStageKey}`,
          `LEAD_STAGE_${normLeadStageKey}`,
          targetStageKey,
          normLeadStageKey,
          normNewStage,
        ].filter(Boolean))
      ) as string[];

      let template: any = null;
      if (overrideTemplateId && this.emailTemplateService) {
        template = await this.emailTemplateService.findOne(Number(overrideTemplateId), lead.customerId).catch(() => null);
      }

      // 1a. Search customer/global DB templates by candidate keys
      if (!template && this.emailTemplateService) {
        for (const k of candidateKeys) {
          template = await this.emailTemplateService.findByKey(k, lead.customerId).catch(() => null);
          if (template) break;
        }
      }

      // 1b. Search DB template by matching name or key (safe AND combination to prevent Prisma OR overwrite)
      if (!template && this.prisma.emailTemplate && newStageName) {
        const dbTpl = await this.prisma.emailTemplate.findFirst({
          where: {
            deletedAt: null,
            isActive: true,
            AND: [
              {
                OR: [
                  { name: { equals: newStageName, mode: 'insensitive' } },
                  { name: { contains: newStageName, mode: 'insensitive' } },
                  { key: { in: candidateKeys } },
                ],
              },
              lead.customerId
                ? {
                    OR: [
                      { customerId: Number(lead.customerId) },
                      { customerId: null },
                    ],
                  }
                : { customerId: null },
            ],
          },
          orderBy: { customerId: 'desc' },
        }).catch(() => null);
        if (dbTpl) {
          template = dbTpl;
        }
      }

      // 1c. Check predefined system fallback templates matching stage keys
      if (!template) {
        template = PREDEFINED_SYSTEM_TEMPLATES.find((t) => candidateKeys.includes(t.key)) || null;
      }

      if (template && template.isActive === false) {
        this.logger.warn(`[LeadEmailAutomation] Email template is inactive.`);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: 'Email template is inactive.',
          message: 'Email template is inactive.',
        };
      }

      // If no template is configured for this stage and no custom body provided, skip gracefully
      if (!template && !customBody) {
        this.logger.warn(`[LeadEmailAutomation] Template not found for status: ${newStageName}`);
        this.logger.warn(`[LEAD_STAGE_EMAIL] No email template configured for stage: ${newStageName}`);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: `No email template configured for stage: ${newStageName}`,
          message: `No email template configured for stage: ${newStageName}`,
        };
      }

      const templateIdentifier = template?.key || template?.name || template?.id || 'CUSTOM';

      // 2. Resolve recipient email: strictly comes from the lead or contact associated with the lead
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let recipientEmail = (lead.email || lead.customerEmail || (lead as any).emailAddress || '').trim();

      // If missing on lead, check associated contact if converted or linked
      if (!recipientEmail && lead.convertedToContactId && this.prisma.contact) {
        const contact = await this.prisma.contact.findUnique({
          where: { id: Number(lead.convertedToContactId) },
          select: { email: true },
        }).catch(() => null);
        if (contact?.email) {
          recipientEmail = contact.email.trim();
        }
      }

      // If missing on lead, check lead.contact?.email if populated
      if (!recipientEmail && (lead as any).contact?.email) {
        recipientEmail = String((lead as any).contact.email).trim();
      }

      // Filter out placeholder / invalid dummy emails
      const placeholderEmails = [
        'contact@company.com',
        'placeholder@company.com',
        'example@company.com',
        'test@company.com',
        'user@company.com',
        'admin@quikboom.com',
      ];
      if (placeholderEmails.includes(recipientEmail.toLowerCase())) {
        recipientEmail = '';
      }

      // Handle missing or invalid customer email safely without failing the stage update
      if (!recipientEmail || !emailRegex.test(recipientEmail)) {
        this.logger.warn(`[LEAD_STAGE_EMAIL] Lead has no customer email`);
        await this.leadRepository.logTimeline(
          lead.id,
          eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_EMAIL' : 'STAGE_CHANGE_EMAIL',
          `Automatic stage email skipped: Lead has no customer email`,
          {
            eventType,
            previousStage: previousStageName,
            newStage: newStageName,
            status: 'SKIPPED',
            reason: 'Lead has no customer email',
          },
        ).catch(() => null);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: 'Lead has no customer email',
          message: 'Automatic stage email skipped: Lead has no customer email',
        };
      }

      // 3. Prevent duplicate notifications (debounce only successfully sent transitions within 60s)
      const recentLog = await this.prisma.emailLog.findFirst({
        where: {
          leadId: Number(lead.id),
          status: 'SENT',
          newStage: String(newStageName),
          createdAt: {
            gte: new Date(Date.now() - 60000),
          },
        },
        select: {
          id: true,
          status: true,
          providerMessageId: true,
          createdAt: true,
        },
      });

      if (recentLog) {
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: recipientEmail,
          messageId: recentLog.providerMessageId,
          error: null,
          message: 'Debounced duplicate stage transition email',
        };
      }

      // 4. Verify Email Integration is configured and active
      let isIntegrationConfigured = true;
      let isIntegrationEnabled = true;
      let configWarning: string | null = null;

      if (this.emailService && typeof (this.emailService as any).getSmtpStatus === 'function') {
        try {
          const smtpStatus = await (this.emailService as any).getSmtpStatus();
          if (smtpStatus) {
            if (!smtpStatus.isConfigured || !smtpStatus.host) {
              isIntegrationConfigured = false;
              configWarning = 'SMTP Email Integration is not configured in Settings → Integrations';
            } else if (smtpStatus.isEnabled === false) {
              isIntegrationEnabled = false;
              configWarning = 'SMTP Email Integration is disabled in Settings → Integrations';
            }
          }
        } catch {
          // If status check throws, proceed to sendEmail which has its own verification
        }
      }

      // If email integration is not configured/disabled: log warning, save EmailLog as FAILED, do not crash stage update
      if (!isIntegrationConfigured || !isIntegrationEnabled) {
        this.logger.warn(`[LEAD_STAGE_EMAIL] Email integration warning: ${configWarning}`);
        await this.prisma.emailLog.create({
          data: {
            leadId: Number(lead.id),
            customerId: lead.customerId ? Number(lead.customerId) : null,
            userId: userId ? Number(userId) : null,
            templateId: template?.id || null,
            channel: 'EMAIL',
            identifierKey: template?.key || candidateKeys[0] || 'LEAD_STAGE_CHANGED',
            recipientEmail,
            subject: customSubject || template?.subject || 'Your Lead Status Has Been Updated',
            renderedContent: customBody || template?.body || 'Lead status updated',
            eventType,
            previousStage: previousStageName ? String(previousStageName) : null,
            newStage: String(newStageName),
            status: 'FAILED',
            errorMessage: configWarning || 'Email integration not configured or disabled',
            sentAt: new Date(),
          },
        }).catch(() => null);

        return {
          sent: false,
          status: 'FAILED',
          recipient: recipientEmail,
          messageId: null,
          error: configWarning || 'Email integration not configured or disabled',
          message: configWarning || 'Email integration not configured or disabled',
        };
      }

      // 5. Build context variables and resolve dynamic employee signature
      const leadTitle =
        `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
        lead.title ||
        lead.companyName ||
        'Valued Client';

      const leadPhone = (lead.phone || lead.mobile || '').trim();
      const leadCompany = (lead.companyName || lead.company?.name || '').trim();

      // Resolve assigned employee details for signature
      let userName = 'QuickBoom Team';
      let senderEmail = 'sales@quikboom.com';
      let assignedEmployeeName = 'QuickBoom Team';
      let assignedEmployeeEmail = 'sales@quikboom.com';

      if (lead.assignedTo) {
        const repName = `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim();
        if (repName) {
          userName = repName;
          assignedEmployeeName = repName;
        }
        if (lead.assignedTo.email) {
          senderEmail = lead.assignedTo.email.trim();
          assignedEmployeeEmail = lead.assignedTo.email.trim();
        }
      } else if (lead.assignedToId && this.prisma.user) {
        const assignedUser = await this.prisma.user
          .findUnique({
            where: { id: Number(lead.assignedToId) },
            select: { firstName: true, lastName: true, email: true },
          })
          .catch(() => null);
        if (assignedUser) {
          const repName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim();
          if (repName) {
            userName = repName;
            assignedEmployeeName = repName;
          }
          if (assignedUser.email) {
            senderEmail = assignedUser.email.trim();
            assignedEmployeeEmail = assignedUser.email.trim();
          }
        }
      } else if (lead.user?.name) {
        userName = lead.user.name;
        if (lead.user.email) senderEmail = lead.user.email;
      } else if (userId && this.prisma.user) {
        const u = await this.prisma.user
          .findUnique({
            where: { id: Number(userId) },
            select: { firstName: true, lastName: true, email: true },
          })
          .catch(() => null);
        if (u) {
          const uName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          if (uName) {
            userName = uName;
            assignedEmployeeName = uName;
          }
          if (u.email) {
            senderEmail = u.email.trim();
            assignedEmployeeEmail = u.email.trim();
          }
        }
      } else if (lead.customer?.email) {
        senderEmail = lead.customer.email.trim();
      }

      // Resolve primaryColor from lead stage, database lead_stages, or Admin Panel fallback (#16A34A)
      let primaryColor = lead.stage?.color || null;
      if (!primaryColor && newStageName) {
        const st = await this.prisma.leadStage.findFirst({
          where: {
            OR: [
              { name: { equals: newStageName, mode: 'insensitive' } },
              { key: { equals: normNewStage, mode: 'insensitive' } },
            ],
            deletedAt: null,
          },
          select: { color: true },
        }).catch(() => null);
        if (st?.color) {
          primaryColor = st.color;
        }
      }
      if (!primaryColor) {
        primaryColor = process.env.PRIMARY_COLOR || '#16A34A';
      }

      // Resolve public HTTPS logo URL (absolute, public without auth)
      let logoUrl = 'https://admin.qbapp.online/logo.png';
      if (lead.customer?.logo) {
        const l = String(lead.customer.logo).trim();
        if (l.startsWith('http://') || l.startsWith('https://')) {
          logoUrl = l;
        } else if (l.startsWith('/')) {
          logoUrl = `https://admin.qbapp.online${l}`;
        }
      }

      let emailSubject = customSubject || 'Your Lead Status Has Been Updated';
      let htmlContent = '';
      let textContent = '';

      const tRenderStart = Date.now();

      if (customBody) {
        textContent = customBody;
        htmlContent = customBody.includes('<') && customBody.includes('>')
          ? customBody
          : wrapInQuikboomEmailHtml(customBody, { primaryColor, logoSrc: logoUrl });
      } else if (template) {
        let startDate = '';
        let startTime = '';

        if (template.key === 'QUIKBOOM_VISIT_SCHEDULED' || normNewStage === 'VISIT_SCHEDULED') {
          const scheduledVisit = await this.prisma.visit
            .findFirst({
              where: {
                leadId: Number(lead.id),
                status: 'SCHEDULED',
              },
              orderBy: { date: 'desc' },
            })
            .catch(() => null);

          if (scheduledVisit?.date) {
            startDate = new Intl.DateTimeFormat('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(scheduledVisit.date));
            startTime = scheduledVisit.time || '';
          } else if (lead.nextFollowUpDate) {
            startDate = new Intl.DateTimeFormat('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(lead.nextFollowUpDate));
            startTime = lead.nextFollowUpTime || '';
          }
        }

        const now = new Date();
        const currentDate = new Intl.DateTimeFormat('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(now);
        const currentTime = new Intl.DateTimeFormat('en-IN', {
          hour: 'numeric',
          minute: 'numeric',
          hour12: true,
        }).format(now);

        const variables: Record<string, any> = {
          // Dot-notation dynamic variables
          'lead.name': leadTitle,
          'lead.email': recipientEmail,
          'lead.phone': leadPhone,
          'lead.company': leadCompany || 'your company',
          'lead.stage': newStageName,
          'lead.status': newStageName,
          'lead.title': leadTitle,
          'lead.firstName': (lead.firstName || '').trim() || leadTitle,
          'lead.lastName': (lead.lastName || '').trim(),

          // Nested lead object
          lead: {
            name: leadTitle,
            email: recipientEmail,
            phone: leadPhone,
            company: leadCompany || 'your company',
            stage: newStageName,
            status: newStageName,
            title: leadTitle,
            firstName: (lead.firstName || '').trim() || leadTitle,
            lastName: (lead.lastName || '').trim(),
          },

          // Flat dynamic variables according to prompt requirements:
          // {{customerName}}, {{leadName}}, {{companyName}}, {{customerEmail}}, {{oldStage}}, {{newStage}},
          // {{leadSource}}, {{leadPhone}}, {{salesOwner}}, {{currentDate}}, {{currentTime}}
          customerName: leadTitle,
          leadName: leadTitle,
          leadTitle,
          leadFirstName: (lead.firstName || '').trim() || leadTitle,
          leadLastName: (lead.lastName || '').trim(),
          companyName: leadCompany || lead.companyName || lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency',
          company: leadCompany || lead.companyName || 'your company',
          customerEmail: recipientEmail,
          leadEmail: recipientEmail,
          oldStage: previousStageName,
          previousStage: previousStageName,
          newStage: newStageName,
          stage: newStageName,
          stageName: newStageName,
          leadSource: lead.source || 'WEBSITE',
          source: lead.source || 'WEBSITE',
          leadPhone,
          phone: leadPhone,
          salesOwner: assignedEmployeeName || userName,
          assignedUser: userName,
          assignedEmployee: userName,
          assignedEmployeeName,
          assignedEmployeeEmail,
          userName,
          senderName: userName,
          senderEmail,
          email: senderEmail,
          currentDate,
          currentTime,
          startDate: startDate || 'To be communicated',
          startTime: startTime || '',
          loginUrl: 'https://quikboom.com/login',
          primaryColor,
          logoUrl,
        };

        const rendered = renderEmailTemplate(
          { subject: template.subject, body: template.body },
          variables,
        );

        emailSubject = customSubject || rendered.subject;
        textContent = rendered.body;
        htmlContent = wrapInQuikboomEmailHtml(rendered.body, {
          primaryColor,
          logoSrc: logoUrl,
          companyName: variables.companyName,
        });
      }

      const tRenderEnd = Date.now();
      const templateRenderDuration = tRenderEnd - tRenderStart;
      this.logger.log(`[EMAIL_TIMING] Template rendered: ${new Date().toISOString()}`);
      this.logger.log(`[EMAIL_TIMING] Duration: ${templateRenderDuration}ms`);

      // Raw variable protection: never send broken emails with raw unresolved {{variables}}
      const unresolvedVars = (emailSubject + ' ' + textContent).match(/\{\{[a-zA-Z0-9_.]+\}\}/g);
      if (unresolvedVars && unresolvedVars.length > 0) {
        const errorMsg = 'Email template contains unresolved variables.';
        this.logger.warn(`[LeadEmailAutomation] ${errorMsg}: ${unresolvedVars.join(', ')}`);
        await this.prisma.emailLog.create({
          data: {
            leadId: Number(lead.id),
            customerId: lead.customerId ? Number(lead.customerId) : null,
            userId: userId ? Number(userId) : null,
            templateId: template?.id || null,
            channel: 'EMAIL',
            identifierKey: template?.key || candidateKeys[0] || 'LEAD_STAGE_CHANGED',
            recipientEmail,
            subject: emailSubject,
            renderedContent: textContent,
            eventType,
            previousStage: previousStageName ? String(previousStageName) : null,
            newStage: String(newStageName),
            status: 'FAILED',
            errorMessage: `${errorMsg} (${unresolvedVars.join(', ')})`,
            sentAt: new Date(),
          },
        }).catch(() => null);

        return {
          sent: false,
          status: 'FAILED',
          recipient: recipientEmail,
          messageId: null,
          error: errorMsg,
          message: errorMsg,
        };
      }

      // 6. Send email via existing EmailService
      this.logger.log(`[LeadEmailAutomation]\nLead ID: ${lead.id}\nOld Status: ${previousStageName}\nNew Status: ${newStageName}\nTemplate: ${templateIdentifier}\nRecipient: ${recipientEmail}\nTemplate Found: true\nTemplate Active: true\nEmail Send: STARTED`);
      this.logger.log(`[LEAD_STAGE_EMAIL] Recipient: ${recipientEmail}`);
      this.logger.log(`[LEAD_STAGE_EMAIL] Template: ${templateIdentifier}`);
      this.logger.log(`[LEAD_STAGE_EMAIL] Sending email`);

      let messageId: string | null = null;
      let sendError: string | null = null;
      let status = 'SENT';
      let providerDurationMs = 0;

      try {
        if (!this.emailService) {
          throw new Error('Email service is not available');
        }

        const sendResult = await this.emailService.sendEmail({
          to: recipientEmail,
          subject: emailSubject,
          html: htmlContent,
          text: textContent,
          body: htmlContent,
          recordType: 'lead',
          recordId: lead.id,
          templateId: template?.id || undefined,
          eventType,
          skipEmailLog: true, // LeadService records single authoritative EmailLog with stage transition details
        });

        messageId = sendResult?.messageId || null;
        providerDurationMs = sendResult?.providerDurationMs ?? 0;

        this.logger.log(`[LEAD_STAGE_EMAIL] Email sent successfully`);
        this.logger.log(`[LeadEmailAutomation] Email Send: SUCCESS`);
      } catch (err: any) {
        status = 'FAILED';
        sendError = err?.message || 'Failed to dispatch email';
        this.logger.error(`[LEAD_STAGE_EMAIL] Email failed: ${sendError}`);
        this.logger.error(`[LeadEmailAutomation] Email Send: FAILED - ${sendError}`);
      }

      // 7. Store authoritative email delivery log in EmailLog table
      await this.prisma.emailLog.create({
        data: {
          leadId: Number(lead.id),
          customerId: lead.customerId ? Number(lead.customerId) : null,
          userId: userId ? Number(userId) : null,
          templateId: template?.id || null,
          channel: 'EMAIL',
          identifierKey: template?.key || candidateKeys[0] || (eventType === 'LEAD_CREATED' ? 'QUIKBOOM_NEW_LEAD' : 'LEAD_STAGE_CHANGED'),
          recipientEmail,
          subject: emailSubject,
          renderedContent: htmlContent,
          eventType,
          previousStage: previousStageName ? String(previousStageName) : null,
          newStage: String(newStageName),
          status,
          providerMessageId: messageId,
          errorMessage: sendError,
          sentAt: new Date(),
        },
      }).catch((logErr) => {
        this.logger.warn(`[EMAIL_LOG_WARN] Failed to write EmailLog: ${logErr?.message}`);
      });

      // 8. Record timeline event in CRM Lead timeline
      await this.leadRepository.logTimeline(
        lead.id,
        eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_EMAIL' : 'STAGE_CHANGE_EMAIL',
        status === 'SENT'
          ? (eventType === 'LEAD_CREATED'
              ? `Welcome email sent to ${maskEmail(recipientEmail)} (${newStageName} stage)`
              : `Stage transition email sent to ${maskEmail(recipientEmail)} (${previousStageName} → ${newStageName})`)
          : (eventType === 'LEAD_CREATED'
              ? `Welcome email failed for ${maskEmail(recipientEmail)}: ${sendError}`
              : `Stage transition email failed for ${maskEmail(recipientEmail)}: ${sendError}`),
        {
          eventType,
          previousStage: previousStageName,
          newStage: newStageName,
          recipientEmail: maskEmail(recipientEmail),
          status,
          providerMessageId: messageId,
          errorMessage: sendError,
        },
      ).catch(() => null);

      return {
        sent: status === 'SENT',
        status: status as 'SENT' | 'FAILED',
        recipient: recipientEmail,
        messageId,
        error: sendError,
        message: status === 'SENT' ? 'Customer email sent successfully' : (sendError || 'Email delivery failed'),
      };
    } catch (unexpectedError: any) {
      // Must NEVER fail the lead stage update even on unexpected notification errors
      this.logger.error(`[EMAIL_NOTIFICATION_UNEXPECTED_ERROR] ${unexpectedError?.message}`);
      return {
        sent: false,
        status: 'FAILED',
        recipient: null,
        messageId: null,
        error: unexpectedError?.message || 'Unexpected notification error',
        message: 'Unexpected notification error',
      };
    }
  }

  async deleteLead(customerId: number | string, id: number | string) {
    await this.getLeadById(customerId, id);
    return this.leadRepository.softDelete(customerId, id);
  }

  async addNote(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateLeadNoteDto) {
    await this.getLeadById(customerId, leadId);
    const note = await this.leadRepository.addNote(leadId, userId, dto.content);
    await this.leadRepository.logTimeline(
      leadId,
      'NOTE_ADDED',
      `New note added: ${dto.content.substring(0, 40)}...`,
    );
    return note;
  }

  async logFollowUp(customerId: number | string, leadId: number | string, userId: number | string, dto: LogFollowUpDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.logFollowUp(customerId, leadId, userId, dto);
  }

  async manageVisit(customerId: number | string, leadId: number | string, userId: number | string, dto: ManageVisitDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.manageVisit(customerId, leadId, userId, dto);
  }

  async createProposal(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateProposalDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.createProposal(customerId, leadId, userId, dto);
  }

  async recordFinalCall(customerId: number | string, leadId: number | string, userId: number | string, dto: FinalCallDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordFinalCall(customerId, leadId, userId, dto);
  }

  async recordPayment(customerId: number | string, leadId: number | string, userId: number | string, dto: RecordPaymentDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordPayment(customerId, leadId, userId, dto);
  }

  async startWork(customerId: number | string, leadId: number | string, userId: number | string, dto: StartWorkDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.startWork(customerId, leadId, userId, dto);
  }

  /**
   * Dispatches complete lead profile and account details to the lead's email
   * using the configured SMTP Email Integration.
   */
  async sendLeadDetails(customerId: number | string | undefined, leadId: number | string, user?: any) {
    const id = Number(leadId);
    if (isNaN(id)) {
      throw new BadRequestException('Invalid lead ID');
    }

    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      include: {
        stage: true,
        assignedTo: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        customer: {
          select: { name: true, companyName: true, email: true, phone: true, logo: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead record #${leadId} not found`);
    }

    const recipient = (lead.email || '').trim();
    if (!recipient) {
      throw new BadRequestException(
        `Lead "${lead.companyName || lead.title || `${lead.firstName} ${lead.lastName}`}" has no email address configured. Please add an email address to the lead first.`,
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      throw new BadRequestException(
        `Lead "${lead.companyName || lead.title || `${lead.firstName} ${lead.lastName}`}" has an invalid email address "${recipient}". Please update the lead with a valid email address.`,
      );
    }

    if (!this.emailService) {
      throw new BadRequestException('Email service is not available');
    }

    const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Valued Contact';
    const businessName = lead.companyName || lead.title || 'Client Organization';
    const senderOrgName = lead.customer?.companyName || lead.customer?.name || 'QuickBoom CRM';

    const primaryColor = lead.stage?.color || process.env.PRIMARY_COLOR || '#16A34A';
    let logoUrl = 'https://admin.qbapp.online/logo.png';
    const customerObj = lead.customer as any;
    if (customerObj?.logo) {
      const l = String(customerObj.logo).trim();
      if (l.startsWith('http://') || l.startsWith('https://')) {
        logoUrl = l;
      } else if (l.startsWith('/')) {
        logoUrl = `https://admin.qbapp.online${l}`;
      }
    }

    // HTML Email Template
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background-color: ${primaryColor}; background: ${primaryColor}; padding: 28px 32px; color: #ffffff; text-align: center; }
    .header img { max-height: 48px; width: auto; display: inline-block; margin-bottom: 12px; border: 0; }
    .header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #ffffff; }
    .header p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.9); }
    .body { padding: 32px; }
    .intro { font-size: 14px; line-height: 1.6; margin-bottom: 24px; color: #334155; }
    .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .details-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .details-table tr:last-child td { border-bottom: none; }
    .label { font-weight: 700; color: #64748b; width: 38%; }
    .value { font-weight: 600; color: #0f172a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="card" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div class="header" style="background-color: ${primaryColor}; background: ${primaryColor}; padding: 28px 32px; color: #ffffff; text-align: center;">
      <img src="${logoUrl}" alt="${senderOrgName}" width="160" style="max-height: 48px; width: auto; display: inline-block; margin-bottom: 12px; border: 0;" />
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #ffffff;">${businessName}</h1>
      <p style="margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.9);">Lead Reference #${lead.id} • Registered Profile Details</p>
    </div>
    <div class="body">
      <p class="intro">
        Hello <strong>${leadFullName}</strong>,<br><br>
        Here are the recorded account and lead details on file with <strong>${senderOrgName}</strong>:
      </p>

      <div class="section-title">Lead & Contact Information</div>
      <table class="details-table">
        <tr>
          <td class="label">Lead / Opportunity</td>
          <td class="value">${lead.title}</td>
        </tr>
        <tr>
          <td class="label">Business / Account</td>
          <td class="value">${businessName}</td>
        </tr>
        <tr>
          <td class="label">Primary Contact</td>
          <td class="value">${leadFullName}</td>
        </tr>
        <tr>
          <td class="label">Email Address</td>
          <td class="value">${lead.email || '—'}</td>
        </tr>
        <tr>
          <td class="label">Phone Number</td>
          <td class="value">${lead.phone || '—'}</td>
        </tr>
        ${lead.website ? `
        <tr>
          <td class="label">Website</td>
          <td class="value">${lead.website}</td>
        </tr>` : ''}
        ${lead.address || lead.city ? `
        <tr>
          <td class="label">Location / City</td>
          <td class="value">${[lead.address, lead.city, lead.state, lead.country].filter(Boolean).join(', ')}</td>
        </tr>` : ''}
        ${lead.category ? `
        <tr>
          <td class="label">Industry / Category</td>
          <td class="value">${lead.category}</td>
        </tr>` : ''}
      </table>

      <div class="section-title">Account Engagement Overview</div>
      <table class="details-table">
        <tr>
          <td class="label">Status / Stage</td>
          <td class="value"><span class="badge">${lead.stage?.name || lead.status}</span></td>
        </tr>
        <tr>
          <td class="label">Priority</td>
          <td class="value">${lead.priority || 'MEDIUM'}</td>
        </tr>
        ${lead.value ? `
        <tr>
          <td class="label">Estimated Deal Value</td>
          <td class="value">₹${Number(lead.value).toLocaleString('en-IN')}</td>
        </tr>` : ''}
        ${lead.assignedTo ? `
        <tr>
          <td class="label">Assigned Representative</td>
          <td class="value">${lead.assignedTo.firstName} ${lead.assignedTo.lastName} (${lead.assignedTo.email})</td>
        </tr>` : ''}
        <tr>
          <td class="label">Lead Source</td>
          <td class="value">${lead.source}</td>
        </tr>
      </table>

      <p style="font-size: 13px; color: #64748b; margin: 0;">
        If you have any questions or updates regarding these details, please reply directly to this email or get in touch with our team.
      </p>
    </div>
    <div class="footer">
      Sent by <strong>${senderOrgName}</strong> via CRM
    </div>
  </div>
</body>
</html>
    `.trim();

    // Plain text fallback
    const textContent = `
Lead & Account Details
---------------------------------------------
Opportunity: ${lead.title}
Business: ${businessName}
Contact: ${leadFullName}
Email: ${lead.email || '—'}
Phone: ${lead.phone || '—'}
Website: ${lead.website || '—'}
Location: ${[lead.address, lead.city, lead.state, lead.country].filter(Boolean).join(', ') || '—'}
Stage: ${lead.stage?.name || lead.status}
Priority: ${lead.priority || 'MEDIUM'}
Deal Value: ₹${Number(lead.value || 0).toLocaleString('en-IN')}
Assigned Rep: ${lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName} (${lead.assignedTo.email})` : 'Unassigned'}
Source: ${lead.source}

Sent by ${senderOrgName} via CRM.
    `.trim();

    try {
      const result = await this.emailService.sendEmail({
        to: recipient,
        subject: `Lead Details: ${businessName}`,
        html: htmlContent,
        text: textContent,
        recordType: 'lead',
        recordId: lead.id,
      }, user);

      // Write to activity timeline
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_SENT',
          description: `Lead details dispatched via SMTP to ${recipient} (Message ID: ${result.messageId || 'sent'})`,
        },
      }).catch(() => null);

      return {
        success: true,
        message: `Lead details successfully sent to ${recipient}`,
        messageId: result.messageId,
      };
    } catch (err: any) {
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_FAILED',
          description: `Failed to send email to ${recipient}: ${err.message || 'SMTP Error'}`,
        },
      }).catch(() => null);

      const targetUserId = lead.assignedToId || (user?.id ? Number(user.id) : undefined);
      if (targetUserId && lead.customerId) {
        const notifService = this.getNotificationService();
        if (notifService) {
          notifService.sendPushNotification({
            userId: targetUserId,
            customerId: lead.customerId,
            title: 'Email Delivery Failed',
            body: `Failed to send email to "${businessName}": ${err.message || 'SMTP Error'}`,
            type: 'EMAIL_FAILED',
            data: {
              leadId: String(lead.id),
              customerId: String(lead.customerId),
              channel: 'EMAIL',
              error: String(err.message || 'SMTP Error'),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          }).catch((e) => this.logger.warn(`Failed to dispatch EMAIL_FAILED push: ${e.message}`));
        }
      }
      throw err;
    }
  }

  /**
   * Sends custom email or details email to lead.
   */
  async sendLeadEmail(
    customerId: number | string | undefined,
    leadId: number | string,
    user?: any,
    dto?: SendLeadEmailDto,
  ) {
    if (!dto?.message && !dto?.subject) {
      return this.sendLeadDetails(customerId, leadId, user);
    }

    const id = Number(leadId);
    if (isNaN(id)) throw new BadRequestException('Invalid lead ID');
    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      include: {
        customer: {
          select: { name: true, companyName: true, email: true, phone: true },
        },
      },
    });

    if (!lead) throw new NotFoundException(`Lead record #${leadId} not found`);

    const recipient = (lead.email || '').trim();
    if (!recipient) {
      throw new BadRequestException(`Lead has no email address configured.`);
    }

    if (!this.emailService) {
      throw new BadRequestException('Email service is not available');
    }

    const senderOrgName = lead.customer?.companyName || lead.customer?.name || 'QuickBoom CRM';
    const subject = dto.subject?.trim() || `Update from ${senderOrgName}`;
    const bodyContent = dto.message || '';

    const htmlContent = wrapInQuikboomEmailHtml(
      `<div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap;">${bodyContent}</div>`,
      { previewText: subject, companyName: senderOrgName },
    );

    try {
      const result = await this.emailService.sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        text: bodyContent,
        recordType: 'lead',
        recordId: lead.id,
      }, user);

      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_SENT',
          description: `Custom email sent to ${recipient}: "${subject}"`,
        },
      }).catch(() => null);

      return {
        success: true,
        message: `Email successfully sent to ${recipient}`,
        messageId: result.messageId,
      };
    } catch (err: any) {
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_FAILED',
          description: `Failed to send email to ${recipient}: ${err.message || 'SMTP Error'}`,
        },
      }).catch(() => null);

      const targetUserId = lead.assignedToId || (user?.id ? Number(user.id) : undefined);
      if (targetUserId && lead.customerId) {
        const notifService = this.getNotificationService();
        if (notifService) {
          notifService.sendPushNotification({
            userId: targetUserId,
            customerId: lead.customerId,
            title: 'Email Delivery Failed',
            body: `Failed to send email to "${recipient}": ${err.message || 'SMTP Error'}`,
            type: 'EMAIL_FAILED',
            data: {
              leadId: String(lead.id),
              customerId: String(lead.customerId),
              channel: 'EMAIL',
              error: String(err.message || 'SMTP Error'),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          }).catch((e) => this.logger.warn(`Failed to dispatch EMAIL_FAILED push: ${e.message}`));
        }
      }
      throw err;
    }
  }

  /**
   * Unified communication history for a lead (EmailLogs + WhatsApp / Email timelines)
   */
  async getLeadCommunications(customerId: number | string | undefined, leadId: number | string) {
    const id = Number(leadId);
    if (isNaN(id)) {
      throw new BadRequestException('Invalid lead ID');
    }
    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      select: {
        id: true,
        customerId: true,
        assignedToId: true,
        firstName: true,
        lastName: true,
        companyName: true,
        title: true,
        email: true,
        phone: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead #${leadId} not found`);
    }

    // 1. Fetch email logs
    const emailLogs = await this.prisma.emailLog.findMany({
      where: {
        leadId: id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 2. Fetch timeline records with communication actions
    const commActions = [
      'WHATSAPP_SENT',
      'WHATSAPP_INCOMING',
      'WHATSAPP_FAILED',
      'LEAD_CREATED_WHATSAPP',
      'EMAIL_SENT',
      'EMAIL_FAILED',
    ];
    const timelineLogs = await this.prisma.leadActivityTimeline.findMany({
      where: {
        leadId: id,
        action: { in: commActions },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 3. Build unified communication items
    const items: Array<{
      id: string;
      channel: 'EMAIL' | 'WHATSAPP';
      direction: 'OUTBOUND' | 'INBOUND';
      action: string;
      status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
      title: string;
      content: string;
      recipient: string;
      sender: string;
      errorMessage: string | null;
      providerMessageId: string | null;
      createdAt: string;
      metadata?: any;
    }> = [];

    for (const el of emailLogs) {
      const senderName = el.user
        ? `${el.user.firstName || ''} ${el.user.lastName || ''}`.trim() || el.user.email
        : 'System / CRM';
      const rawStatus = (el.status || 'SENT').toUpperCase();
      let status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' = 'SENT';
      if (rawStatus === 'FAILED') status = 'FAILED';
      else if (rawStatus === 'QUEUED') status = 'QUEUED';
      else if (rawStatus === 'DELIVERED') status = 'DELIVERED';

      items.push({
        id: `email-${el.id}`,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        action: 'EMAIL_SENT',
        status,
        title: el.subject || 'Email to Lead',
        content: el.renderedContent
          ? el.renderedContent.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().substring(0, 300)
          : (el.subject || ''),
        recipient: el.recipientEmail || lead.email || '',
        sender: senderName,
        errorMessage: el.errorMessage || null,
        providerMessageId: el.providerMessageId || null,
        createdAt: el.createdAt ? el.createdAt.toISOString() : new Date().toISOString(),
        metadata: {
          eventType: el.eventType,
          emailLogId: el.id,
        },
      });
    }

    for (const tl of timelineLogs) {
      const meta = (tl.metadata as any) || {};
      const action = tl.action;

      if (action === 'EMAIL_SENT' || action === 'EMAIL_FAILED') {
        const isDuplicate = emailLogs.some((el) => {
          const diff = Math.abs(new Date(el.createdAt).getTime() - new Date(tl.createdAt).getTime());
          return diff < 60000;
        });
        if (isDuplicate) continue;

        items.push({
          id: `timeline-${tl.id}`,
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          action,
          status: action === 'EMAIL_FAILED' ? 'FAILED' : 'SENT',
          title: 'Email Communication',
          content: tl.description || '',
          recipient: lead.email || '',
          sender: 'CRM',
          errorMessage: action === 'EMAIL_FAILED' ? tl.description : null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      } else if (action === 'WHATSAPP_INCOMING') {
        items.push({
          id: `timeline-${tl.id}`,
          channel: 'WHATSAPP',
          direction: 'INBOUND',
          action,
          status: 'RECEIVED',
          title: `Incoming WhatsApp from ${meta.from || lead.phone || 'Lead'}`,
          content: meta.text || tl.description || '',
          recipient: 'CRM / You',
          sender: meta.from || lead.phone || 'Lead',
          errorMessage: null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      } else {
        let status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' = 'SENT';
        const metaStatus = (meta.status || '').toUpperCase();
        if (action === 'WHATSAPP_FAILED' || metaStatus === 'FAILED') {
          status = 'FAILED';
        } else if (metaStatus === 'READ') {
          status = 'READ';
        } else if (metaStatus === 'DELIVERED') {
          status = 'DELIVERED';
        } else if (metaStatus === 'SENT' || metaStatus === 'SUCCESS') {
          status = 'SENT';
        }

        items.push({
          id: `timeline-${tl.id}`,
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          action,
          status,
          title: meta.stageName ? `WhatsApp: ${meta.stageName}` : 'WhatsApp Message',
          content: tl.description || '',
          recipient: meta.phone || lead.phone || '',
          sender: 'CRM Team',
          errorMessage: meta.errorReason || meta.errorCode || null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalEmails = items.filter((i) => i.channel === 'EMAIL').length;
    const totalWhatsApp = items.filter((i) => i.channel === 'WHATSAPP').length;
    const lastItem = items[0];

    return {
      leadId: id,
      summary: {
        totalCommunications: items.length,
        totalEmails,
        totalWhatsApp,
        lastContactAt: lastItem ? lastItem.createdAt : null,
        lastChannel: lastItem ? lastItem.channel : null,
        lastStatus: lastItem ? lastItem.status : null,
      },
      communications: items,
    };
  }

  /**
   * Returns all available WhatsApp templates for lead stages.
   */
  getWhatsAppTemplates() {
    if (!this.whatsappService) return [];
    return this.whatsappService.getAllStageTemplates().map((tpl) => ({
      key: tpl.key,
      templateName: tpl.templateName,
      title: `${tpl.name} WhatsApp`,
      name: tpl.name,
      body: tpl.body,
    }));
  }

  /**
   * Dispatches a WhatsApp message for a lead and logs it to activity timeline.
   */
  async sendLeadWhatsApp(
    customerId: number | string,
    id: number | string,
    userId?: number | string,
    dto?: SendLeadWhatsAppDto & { eventType?: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' },
  ) {
    const lead = await this.getLeadById(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead #${id} not found`);
    }

    const phone = lead.phone ? String(lead.phone).trim() : '';
    if (!phone) {
      return {
        success: false,
        skipped: true,
        reason: 'NO_PHONE',
        message: 'No phone number is registered for this lead.',
      };
    }

    const normalizedPhone = this.whatsappService?.normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return {
        success: false,
        reason: 'INVALID_PHONE',
        message: `Phone number "${phone}" is not a valid mobile number for WhatsApp.`,
      };
    }

    const targetStageName = dto?.stageName || lead.stage?.name || lead.status || 'NEW';
    const normStage = targetStageName.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const rawKey = dto?.stageName
      ? normStage
      : (lead.stage?.key ? String(lead.stage.key).trim().toUpperCase().replace(/[\s-]+/g, '_') : normStage);
    const stageKey = STAGE_KEY_TO_WHATSAPP_KEY[rawKey] || rawKey || 'NEW';

    const template = typeof this.whatsappService?.getStageTemplate === 'function'
      ? (this.whatsappService.getStageTemplate(stageKey) || this.whatsappService.getStageTemplate(normStage))
      : true;
    if (!template && !dto?.message) {
      this.logger.log(
        `[WHATSAPP] Lead #${lead.id} stage is "${targetStageName}", but no WhatsApp template is configured for this stage. Skipping WhatsApp.`,
      );
      return {
        success: false,
        skipped: true,
        reason: 'NO_TEMPLATE_CONFIGURED',
        message: `No WhatsApp template is configured for stage "${targetStageName}". Skipping.`,
      };
    }

    this.logger.log(
      `[LeadNotification] 4. Notification template found: ${template && typeof template === 'object' ? template.templateName : stageKey}`,
    );
    this.logger.log(`[LeadNotification] 5. Recipient resolved: ${maskPhone(phone)}`);

    const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Valued Prospect';
    const companyName = lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency';

    let userName = 'QuickBoom Team';
    let assignedEmployeeName = 'QuickBoom Team';
    let assignedEmployeeEmail = '';
    let assignedEmployeePhone = '';

    const assignedUser = lead.assignedTo || (lead.assignedToId && this.prisma.user ? await this.prisma.user.findUnique({
      where: { id: lead.assignedToId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    }).catch(() => null) : null);

    if (assignedUser) {
      const repName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim();
      if (repName) {
        userName = repName;
        assignedEmployeeName = repName;
      }
      if (assignedUser.email) assignedEmployeeEmail = assignedUser.email.trim();
      if (assignedUser.phone) assignedEmployeePhone = assignedUser.phone.trim();
    } else if (userId && this.prisma.user) {
      const u = await this.prisma.user
        .findUnique({
          where: { id: Number(userId) },
          select: { firstName: true, lastName: true, email: true, phone: true },
        })
        .catch(() => null);
      if (u) {
        const uName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
        if (uName) {
          userName = uName;
          assignedEmployeeName = uName;
        }
        if (u.email) assignedEmployeeEmail = u.email.trim();
        if (u.phone) assignedEmployeePhone = u.phone.trim();
      }
    }

    const variables: Record<string, string> = {
      leadName: leadFullName,
      leadTitle: lead.title || leadFullName,
      companyName,
      userName,
      assignedUser: userName,
      assignedEmployeeName,
      assignedEmployeeEmail,
      assignedEmployeePhone,
      stage: targetStageName,
      startDate: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toLocaleDateString('en-IN') : '',
      startTime: lead.nextFollowUpTime || '',
    };

    let result: any = { success: false, messageId: undefined, skipped: true };
    if (this.whatsappService) {
      this.logger.log(`[LeadNotification] 6. Notification service called: WhatsAppService.sendLeadStageMessage`);
      try {
        result = await this.whatsappService.sendLeadStageMessage({
          to: normalizedPhone,
          stageKey: String(stageKey),
          variables,
          customMessage: dto?.message,
          stageName: targetStageName,
          customerId: Number(customerId),
          userId: userId ? Number(userId) : undefined,
        });
      } catch (sendErr: any) {
        result = {
          success: false,
          skipped: false,
          errorCode: 'PROVIDER_ERROR',
          reason: 'PROVIDER_ERROR',
          message: sendErr?.message || 'WhatsApp message failed to send',
          details: sendErr?.message || 'WhatsApp message failed to send',
        };
      }
    } else {
      result = {
        success: false,
        skipped: true,
        reason: 'WHATSAPP_SERVICE_UNAVAILABLE',
        message: 'WhatsApp service is not available',
      };
    }

    // Write to LeadActivityTimeline
    const eventType = dto?.eventType || 'LEAD_STAGE_CHANGED';
    const action = eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'WHATSAPP_SENT';
    await this.prisma.leadActivityTimeline
      .create({
        data: {
          leadId: Number(lead.id),
          action,
          description: result.success
            ? (eventType === 'LEAD_CREATED'
                ? `Welcome WhatsApp message sent to ${phone} for ${targetStageName} stage`
                : `WhatsApp notification sent to ${phone} for stage ${targetStageName}`)
            : `WhatsApp notification skipped or failed for ${phone}: ${result.reason || result.error || 'Not delivered'}`,
          metadata: {
            eventType,
            phone: maskPhone(phone),
            normalizedPhone: maskPhone(normalizedPhone),
            stageName: targetStageName,
            stageKey,
            status: result.success ? 'Sent' : (result.skipped ? 'Skipped' : 'Failed'),
            success: result.success,
            messageId: result.messageId || null,
            errorCode: result.errorCode || result.error || null,
            errorReason: result.reason || null,
            errorDetails: result.providerMessage || result.details || null,
          } as any,
        },
      })
      .catch(() => null);

    this.logger.log(
      `[LeadNotification] 9. Communication status saved: ${result.success ? 'SENT' : (result.skipped ? 'SKIPPED' : 'FAILED')}`,
    );

    this.logger.log(
      `[LEAD_STAGE_NOTIFICATION]\nLead Stage Changed\nLead ID: ${lead.id}\nPrevious Stage: ${dto?.eventType === 'LEAD_CREATED' ? 'None' : (lead.stage?.name || 'N/A')}\nNew Stage: ${targetStageName}\nWhatsApp:\nTemplate Found: ${template ? 'YES' : 'NO'}\nTemplate ID: ${template && typeof template === 'object' ? template.templateName : stageKey}\nRecipient: ${maskPhone(phone)}\nProvider Status: ${result.success ? 'SUCCESS' : 'FAILED'}`
    );

    const errorCode = result.errorCode || result.reason || (result.success ? undefined : 'WHATSAPP_UNKNOWN_ERROR');
    const safeDetails = result.providerMessage || result.details || (errorCode ? friendlyWhatsAppErrorMessage(errorCode) : undefined);
    const failureMessage = result.message || (safeDetails
      ? `WhatsApp message could not be sent: ${safeDetails}`
      : `WhatsApp message could not be sent: ${result.reason || result.error || 'Provider error'}`);

    return {
      success: result.success,
      provider: 'WHATSAPP',
      messageId: result.messageId,
      errorCode: result.errorCode,
      providerStatus: result.providerStatus,
      providerMessage: result.providerMessage || result.details,
      message: result.success
        ? `WhatsApp message sent successfully to ${phone}`
        : failureMessage,
      details: safeDetails,
      skipped: result.skipped,
      reason: result.reason || result.error,
    };
  }

  /**
   * Dispatches automatic WhatsApp notification upon lead creation or stage change with debouncing.
   * Mirrors Email automation checking stage changes, phone, templates, and integration settings.
   */
  async handleLeadStageChangeWhatsappNotification(
    customerId: number | string,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number | string,
    customMessage?: string,
    templateName?: string,
    eventType: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' = 'LEAD_STAGE_CHANGED',
  ): Promise<{
    sent: boolean;
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    recipient: string | null;
    messageId: string | null;
    error: string | null;
    message: string;
    details?: string | null;
  }> {
    try {
      this.logger.log(`[WHATSAPP] Handling ${eventType} WhatsApp notification for lead #${lead.id} (${previousStageName} → ${newStageName})`);

      // 0. Do NOT send if stage did not actually change for stage change events
      const normPrevStage = (previousStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normNewStageForCheck = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      if (
        eventType === 'LEAD_STAGE_CHANGED' &&
        normPrevStage &&
        normNewStageForCheck &&
        normPrevStage === normNewStageForCheck
      ) {
        this.logger.log(`[WHATSAPP] Stage unchanged (${previousStageName} → ${newStageName}). Skipping automatic WhatsApp.`);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: null,
          message: 'Stage did not change',
        };
      }

      // 1. Resolve and validate recipient phone number
      const phone = (lead.phone || lead.mobile || '').trim();
      if (!phone) {
        this.logger.warn(`[WHATSAPP] Lead #${lead.id} has no phone registered. Skipping.`);
        await this.leadRepository.logTimeline(
          lead.id,
          eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'STAGE_CHANGE_WHATSAPP',
          `Automatic stage WhatsApp skipped: Lead has no phone number`,
          {
            eventType,
            previousStage: previousStageName,
            newStage: newStageName,
            status: 'SKIPPED',
            reason: 'NO_PHONE',
          },
        ).catch(() => null);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: null,
          messageId: null,
          error: 'Lead has no phone number registered',
          message: 'Automatic stage WhatsApp skipped: Lead has no phone number registered',
        };
      }

      const normalizedPhone = this.whatsappService?.normalizePhoneNumber
        ? this.whatsappService.normalizePhoneNumber(phone)
        : phone.replace(/[^\d+]/g, '');
      const digitsOnly = (normalizedPhone || phone).replace(/\D/g, '');
      if (!normalizedPhone || digitsOnly.length < 10) {
        const errorMsg = `Phone number "${phone}" is not a valid mobile number for WhatsApp`;
        this.logger.warn(`[WHATSAPP] Lead #${lead.id} ${errorMsg}.`);
        await this.leadRepository.logTimeline(
          lead.id,
          eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'STAGE_CHANGE_WHATSAPP',
          `Automatic stage WhatsApp failed: ${errorMsg}`,
          {
            eventType,
            previousStage: previousStageName,
            newStage: newStageName,
            status: 'FAILED',
            reason: 'INVALID_PHONE',
            errorMessage: errorMsg,
          },
        ).catch(() => null);
        return {
          sent: false,
          status: 'FAILED',
          recipient: phone,
          messageId: null,
          error: errorMsg,
          message: errorMsg,
        };
      }

      // 2. Resolve stage WhatsApp Template
      const normNewStage = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normLeadStageKey = (lead.stage?.key || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const targetStageKey = normNewStage || normLeadStageKey;
      const stageKey = STAGE_KEY_TO_WHATSAPP_KEY[targetStageKey] || STAGE_KEY_TO_WHATSAPP_KEY[normLeadStageKey] || targetStageKey || 'NEW';

      const template = this.whatsappService && typeof this.whatsappService.getStageTemplate === 'function'
        ? (this.whatsappService.getStageTemplate(stageKey) || this.whatsappService.getStageTemplate(normNewStage))
        : null;

      if (!template && !customMessage) {
        const skipMsg = `No WhatsApp template configured for stage: ${newStageName}`;
        this.logger.warn(`[WHATSAPP] ${skipMsg}`);
        await this.leadRepository.logTimeline(
          lead.id,
          eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'STAGE_CHANGE_WHATSAPP',
          `Automatic stage WhatsApp skipped: ${skipMsg}`,
          {
            eventType,
            previousStage: previousStageName,
            newStage: newStageName,
            status: 'SKIPPED',
            reason: 'NO_TEMPLATE_CONFIGURED',
            errorMessage: skipMsg,
          },
        ).catch(() => null);
        return {
          sent: false,
          status: 'SKIPPED',
          recipient: maskPhone(phone),
          messageId: null,
          error: skipMsg,
          message: skipMsg,
        };
      }

      // 3. Debounce check: avoid duplicate sends within 15s for the same stage
      let recentTimeline: any = null;
      if (this.prisma.leadActivityTimeline?.findFirst) {
        recentTimeline = await this.prisma.leadActivityTimeline.findFirst({
          where: {
            leadId: Number(lead.id),
            action: { in: ['WHATSAPP_SENT', 'LEAD_CREATED_WHATSAPP', 'STAGE_CHANGE_WHATSAPP'] },
            createdAt: {
              gte: new Date(Date.now() - 15000),
            },
          },
          orderBy: { createdAt: 'desc' },
        }).catch(() => null);
      }

      if (recentTimeline) {
        const meta = (recentTimeline.metadata as any) || {};
        const recentStage = (meta.stageName || '').trim().toUpperCase();
        const currentNewStage = (newStageName || '').trim().toUpperCase();
        if (!recentStage || recentStage === currentNewStage || (eventType === 'LEAD_CREATED' && recentTimeline.action === 'LEAD_CREATED_WHATSAPP')) {
          this.logger.log(`[WHATSAPP] Duplicate ${eventType} WhatsApp notification within 15s for lead #${lead.id} on stage "${newStageName}". Skipping.`);
          return {
            sent: false,
            status: 'SKIPPED',
            recipient: maskPhone(phone),
            messageId: meta.messageId || null,
            error: null,
            message: 'Debounced duplicate stage transition WhatsApp message',
          };
        }
      }

      // 4. Verify WhatsApp Integration is configured and enabled in Settings
      let isIntegrationConfigured = true;
      let isIntegrationEnabled = true;
      let configWarning: string | null = null;

      if (this.whatsappService && typeof (this.whatsappService as any).getWhatsAppStatus === 'function') {
        try {
          const waStatus = await (this.whatsappService as any).getWhatsAppStatus();
          if (waStatus) {
            if (!waStatus.isConfigured) {
              isIntegrationConfigured = false;
              configWarning = 'WhatsApp Integration is not configured in Settings → Integrations';
            } else if (waStatus.isEnabled === false) {
              isIntegrationEnabled = false;
              configWarning = 'WhatsApp Integration is disabled in Settings → Integrations';
            }
          }
        } catch {
          // Proceed to send which handles individual errors
        }
      }

      if (!isIntegrationConfigured || !isIntegrationEnabled) {
        this.logger.warn(`[LEAD_STAGE_WHATSAPP] WhatsApp integration warning: ${configWarning}`);
        await this.leadRepository.logTimeline(
          lead.id,
          eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'STAGE_CHANGE_WHATSAPP',
          `Automatic stage WhatsApp failed: ${configWarning}`,
          {
            eventType,
            previousStage: previousStageName,
            newStage: newStageName,
            recipientPhone: maskPhone(phone),
            status: 'FAILED',
            errorMessage: configWarning,
          },
        ).catch(() => null);

        return {
          sent: false,
          status: 'FAILED',
          recipient: maskPhone(phone),
          messageId: null,
          error: configWarning,
          message: configWarning || 'WhatsApp integration not configured or disabled',
        };
      }

      // 5. Dispatch message via sendLeadWhatsApp
      const sendRes = await this.sendLeadWhatsApp(customerId, lead.id, userId, {
        message: customMessage,
        templateName,
        stageName: newStageName,
        eventType,
      });

      const isSent = Boolean(sendRes && sendRes.success && !sendRes.skipped);
      const notifStatus: 'SENT' | 'FAILED' | 'SKIPPED' = isSent
        ? 'SENT'
        : sendRes?.skipped
        ? 'SKIPPED'
        : 'FAILED';

      return {
        sent: isSent,
        status: notifStatus,
        recipient: maskPhone(phone),
        messageId: sendRes?.messageId || null,
        error: isSent ? null : (sendRes?.reason || (sendRes as any)?.error || (sendRes as any)?.details || null),
        message: sendRes?.message || (isSent ? 'Customer WhatsApp message sent successfully' : 'WhatsApp delivery failed'),
        details: (sendRes as any)?.details || null,
      };
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Failed to send lead ${eventType} WhatsApp: ${err?.message}`);
      return {
        sent: false,
        status: 'FAILED',
        recipient: lead?.phone ? maskPhone(String(lead.phone)) : null,
        messageId: null,
        error: err?.message || 'WhatsApp delivery failed',
        message: err?.message || 'WhatsApp delivery failed',
      };
    }
  }
}
