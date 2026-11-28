import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmployeeService } from '../employee/employee.service';
import { applyExcelBranding, drawStandardPdfHeader } from '../../common/utils/report-branding.util';
import {
  AdminCreateCandidateDto,
  AdminUpdateCandidateDto,
  ConvertCandidateToEmployeeDto,
  CreateHiringFormDto,
  PublicSubmitApplicationDto,
  ScheduleInterviewDto,
  UpdateHiringFormDto,
} from './dto/hiring.dto';

const ALLOWED_RESUME_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class HiringService {
  private readonly logger = new Logger(HiringService.name);
  private readonly publicRateMap = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly s3Service?: S3Service,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly employeeService?: EmployeeService,
  ) {}

  private async resolveCustomerId(user: any, customerId?: number | string): Promise<number> {
    const parsed = Number(customerId ?? user?.customerId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    const customer = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return customer?.id || 1;
  }

  private checkPublicRateLimit(key: string) {
    const now = Date.now();
    const windowMs = 60_000;
    const recent = (this.publicRateMap.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= 10) {
      throw new ForbiddenException('Too many application submissions. Please try again in a minute.');
    }
    recent.push(now);
    this.publicRateMap.set(key, recent);
  }

  private defaultFieldConfig() {
    return {
      candidateName: { required: true, visible: true },
      mobileNumber: { required: true, visible: true },
      email: { required: true, visible: true },
      departmentId: { required: true, visible: true },
      currentSalary: { required: false, visible: true },
      expectedSalary: { required: false, visible: true },
      experience: { required: true, visible: true },
      resume: { required: false, visible: true },
    };
  }

  async createForm(user: any, customerId: number | string | undefined, dto: CreateHiringFormDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const token = crypto.randomBytes(24).toString('base64url');
    const form = await this.prisma.hiringForm.create({
      data: {
        customerId: numCustomerId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        token,
        departmentIds: dto.departmentIds?.length ? (dto.departmentIds.map(Number) as any) : undefined,
        fieldConfig: (dto.fieldConfig || this.defaultFieldConfig()) as any,
        isActive: dto.isActive !== false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: user?.id ? Number(user.id) : null,
      },
    });
    return { success: true, data: form };
  }

  async listForms(user: any, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const forms = await this.prisma.hiringForm.findMany({
      where: { customerId: numCustomerId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: forms };
  }

  async updateForm(user: any, customerId: number | string | undefined, id: number, dto: UpdateHiringFormDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const existing = await this.prisma.hiringForm.findFirst({
      where: { id, customerId: numCustomerId },
    });
    if (!existing) throw new NotFoundException(`Hiring form #${id} not found`);

    const updated = await this.prisma.hiringForm.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.departmentIds !== undefined ? { departmentIds: dto.departmentIds as any } : {}),
        ...(dto.fieldConfig !== undefined ? { fieldConfig: dto.fieldConfig as any } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null } : {}),
      },
    });
    return { success: true, data: updated };
  }

  async getPublicFormByToken(token: string) {
    const form = await this.prisma.hiringForm.findUnique({ where: { token } });
    if (!form) throw new NotFoundException('Hiring form not found.');
    if (!form.isActive) throw new BadRequestException('This hiring form is currently closed.');
    if (form.expiresAt && new Date(form.expiresAt) < new Date()) {
      throw new BadRequestException('This hiring form has expired.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: form.customerId },
      select: { id: true, name: true, companyName: true },
    });

    const allowedIds = Array.isArray(form.departmentIds) ? (form.departmentIds as number[]).map(Number) : [];
    const departments = await this.prisma.department.findMany({
      where: {
        customerId: form.customerId,
        isActive: true,
        ...(allowedIds.length > 0 ? { id: { in: allowedIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: {
        id: form.id,
        title: form.title,
        description: form.description,
        companyName: customer?.companyName || customer?.name || 'QB Suite',
        fieldConfig: form.fieldConfig || this.defaultFieldConfig(),
        departments,
      },
    };
  }

  private async storePrivateResume(customerId: number, file?: Express.Multer.File) {
    if (!file) return { resumeKey: null, resumeUrl: null, resumeFilename: null };
    if (file.size > MAX_RESUME_BYTES) {
      throw new BadRequestException('Resume file size must not exceed 5 MB.');
    }
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_RESUME_EXTENSIONS.has(ext)) {
      throw new BadRequestException('Only PDF, DOC, and DOCX resume files are allowed.');
    }

    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const storageKey = `private-resumes/${customerId}/${safeName}`;

    const stored = { resumeKey: storageKey, resumeUrl: null, resumeFilename: file.originalname };

    if (this.s3Service) {
      try {
        await this.s3Service.uploadPrivatePdf(file.buffer, storageKey, file.mimetype);
        return stored;
      } catch (err: any) {
        this.logger.warn(`S3 private resume upload fallback to local disk: ${err?.message}`);
      }
    }

    try {
      const dir = path.join(process.cwd(), 'uploads', 'private-resumes', String(customerId));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, safeName), file.buffer);
    } catch (err: any) {
      this.logger.error(`Resume storage failed: ${err?.message}`);
      throw new ServiceUnavailableException(
        'We could not save your resume right now. Please try again later.',
      );
    }
    return stored;
  }

  async submitPublicApplication(
    token: string,
    dto: PublicSubmitApplicationDto,
    file?: Express.Multer.File,
    clientIp = 'unknown',
  ) {
    if (dto.website && dto.website.trim().length > 0) {
      throw new BadRequestException('Invalid submission.');
    }
    this.checkPublicRateLimit(`${token}:${clientIp}`);

    const form = await this.prisma.hiringForm.findUnique({ where: { token } });
    if (!form) throw new NotFoundException('Hiring form not found.');
    if (!form.isActive) throw new BadRequestException('This hiring form is no longer accepting applications.');
    if (form.expiresAt && new Date(form.expiresAt) < new Date()) {
      throw new BadRequestException('This hiring form has expired.');
    }

    const email = dto.email.trim().toLowerCase();
    const mobile = dto.mobileNumber.replace(/\s+/g, '');
    const dedupeKey = `${form.id}:${email}:${mobile}`;
    const recentDup = await this.prisma.candidateApplication.findFirst({
      where: {
        customerId: form.customerId,
        dedupeKey,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (recentDup) {
      throw new ConflictException('Your application for this opening has already been submitted.');
    }

    const deptId = dto.departmentId ? Number(dto.departmentId) : null;
    const dept = deptId
      ? await this.prisma.department.findFirst({
          where: { id: deptId, customerId: form.customerId },
          select: { id: true, name: true },
        })
      : null;

    const resume = await this.storePrivateResume(form.customerId, file);

    const app = await this.prisma.$transaction(async (tx) => {
      const created = await tx.candidateApplication.create({
        data: {
          customerId: form.customerId,
          hiringFormId: form.id,
          source: 'PUBLIC_FORM',
          candidateName: dto.candidateName.trim(),
          countryCode: (dto.countryCode || '+91').trim(),
          mobileNumber: mobile,
          email,
          departmentId: dept?.id ?? null,
          departmentName: dept?.name ?? null,
          currentSalary: dto.currentSalary !== undefined && dto.currentSalary !== '' ? Number(dto.currentSalary) : null,
          expectedSalary: dto.expectedSalary !== undefined && dto.expectedSalary !== '' ? Number(dto.expectedSalary) : null,
          experience: dto.experience?.trim() || null,
          resumeKey: resume.resumeKey,
          resumeUrl: resume.resumeUrl,
          resumeFilename: resume.resumeFilename,
          interviewStatus: 'NEW_APPLICATION',
          dedupeKey,
        },
      });
      await tx.hiringForm.update({
        where: { id: form.id },
        data: { submissionCount: { increment: 1 } },
      });
      await tx.candidateStatusHistory.create({
        data: {
          customerId: form.customerId,
          applicationId: created.id,
          fromStatus: null,
          toStatus: 'NEW_APPLICATION',
          changedByName: 'Public Candidate Form',
          remarks: `Submitted via ${form.title}`,
        },
      });
      return created;
    });

    this.dispatchCandidateNotifications(app.id, 'APPLICATION_RECEIVED').catch(() => {});

    return {
      success: true,
      message: 'Your application has been submitted successfully.',
      data: { id: app.id, candidateName: app.candidateName, appliedAt: app.appliedAt },
    };
  }

  async createManualApplication(
    user: any,
    customerId: number | string | undefined,
    dto: AdminCreateCandidateDto,
    file?: Express.Multer.File,
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const dept = dto.departmentId
      ? await this.prisma.department.findFirst({
          where: { id: Number(dto.departmentId), customerId: numCustomerId },
          select: { id: true, name: true },
        })
      : null;
    const hrEmp = dto.assignedHrId
      ? await this.prisma.employee.findFirst({
          where: { id: Number(dto.assignedHrId), customerId: numCustomerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;
    const resume = await this.storePrivateResume(numCustomerId, file);

    const created = await this.prisma.candidateApplication.create({
      data: {
        customerId: numCustomerId,
        source: 'MANUAL',
        candidateName: dto.candidateName.trim(),
        countryCode: (dto.countryCode || '+91').trim(),
        mobileNumber: dto.mobileNumber.trim(),
        email: dto.email.trim().toLowerCase(),
        departmentId: dept?.id ?? null,
        departmentName: dept?.name ?? null,
        currentSalary: dto.currentSalary ?? null,
        expectedSalary: dto.expectedSalary ?? null,
        experience: dto.experience?.trim() || null,
        resumeKey: resume.resumeKey,
        resumeUrl: resume.resumeUrl,
        resumeFilename: resume.resumeFilename,
        interviewStatus: dto.interviewStatus || 'NEW_APPLICATION',
        remarks: dto.remarks?.trim() || null,
        assignedHrId: hrEmp?.id ?? null,
        assignedHrName: hrEmp ? `${hrEmp.firstName} ${hrEmp.lastName}`.trim() : null,
      },
    });
    await this.prisma.candidateStatusHistory.create({
      data: {
        customerId: numCustomerId,
        applicationId: created.id,
        fromStatus: null,
        toStatus: created.interviewStatus,
        changedById: user?.id ? Number(user.id) : null,
        changedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'HR',
        remarks: 'Added manually by HR',
      },
    });
    return { success: true, data: created };
  }

  async listApplications(
    user: any,
    customerId: number | string | undefined,
    query: {
      search?: string;
      departmentId?: string;
      interviewStatus?: string;
      appliedFrom?: string;
      appliedTo?: string;
      interviewFrom?: string;
      interviewTo?: string;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const rows = await this.prisma.candidateApplication.findMany({
      where: {
        customerId: numCustomerId,
        ...(query.departmentId && query.departmentId !== 'ALL' ? { departmentId: Number(query.departmentId) } : {}),
        ...(query.interviewStatus && query.interviewStatus !== 'ALL' ? { interviewStatus: query.interviewStatus } : {}),
        ...(query.appliedFrom || query.appliedTo
          ? {
              appliedAt: {
                ...(query.appliedFrom ? { gte: new Date(`${query.appliedFrom}T00:00:00.000Z`) } : {}),
                ...(query.appliedTo ? { lte: new Date(`${query.appliedTo}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
        ...(query.interviewFrom || query.interviewTo
          ? {
              interviewDate: {
                ...(query.interviewFrom ? { gte: query.interviewFrom } : {}),
                ...(query.interviewTo ? { lte: query.interviewTo } : {}),
              },
            }
          : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                { candidateName: { contains: query.search.trim(), mode: 'insensitive' } },
                { email: { contains: query.search.trim(), mode: 'insensitive' } },
                { mobileNumber: { contains: query.search.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        hiringForm: { select: { id: true, title: true } },
        interviews: { orderBy: { createdAt: 'desc' }, take: 5 },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
        notifications: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: { appliedAt: 'desc' },
    });

    const allForStats = await this.prisma.candidateApplication.findMany({
      where: { customerId: numCustomerId },
      select: { interviewStatus: true, departmentName: true },
    });

    const deptMap: Record<string, number> = {};
    for (const r of allForStats) {
      const k = r.departmentName || 'Unassigned';
      deptMap[k] = (deptMap[k] || 0) + 1;
    }

    const stats = {
      total: allForStats.length,
      newApplications: allForStats.filter((r) => r.interviewStatus === 'NEW_APPLICATION').length,
      pending: allForStats.filter((r) => r.interviewStatus === 'PENDING').length,
      scheduled: allForStats.filter((r) => r.interviewStatus === 'INTERVIEW_SCHEDULED').length,
      completed: allForStats.filter((r) => r.interviewStatus === 'INTERVIEW_COMPLETED').length,
      selected: allForStats.filter((r) => r.interviewStatus === 'SELECTED').length,
      rejected: allForStats.filter((r) => r.interviewStatus === 'REJECTED').length,
      joined: allForStats.filter((r) => r.interviewStatus === 'JOINED').length,
      departmentWise: Object.entries(deptMap).map(([department, count]) => ({ department, count })),
    };

    return { success: true, data: { rows, stats } };
  }

  async updateApplication(
    user: any,
    customerId: number | string | undefined,
    id: number,
    dto: AdminUpdateCandidateDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const existing = await this.prisma.candidateApplication.findFirst({
      where: { id, customerId: numCustomerId },
    });
    if (!existing) throw new NotFoundException(`Application #${id} not found`);

    const dept = dto.departmentId
      ? await this.prisma.department.findFirst({
          where: { id: Number(dto.departmentId), customerId: numCustomerId },
          select: { id: true, name: true },
        })
      : null;
    const hrEmp = dto.assignedHrId
      ? await this.prisma.employee.findFirst({
          where: { id: Number(dto.assignedHrId), customerId: numCustomerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;

    const updated = await this.prisma.candidateApplication.update({
      where: { id },
      data: {
        ...(dto.candidateName !== undefined ? { candidateName: dto.candidateName.trim() } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode.trim() } : {}),
        ...(dto.mobileNumber !== undefined ? { mobileNumber: dto.mobileNumber.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dept ? { departmentId: dept.id, departmentName: dept.name } : {}),
        ...(dto.currentSalary !== undefined ? { currentSalary: dto.currentSalary } : {}),
        ...(dto.expectedSalary !== undefined ? { expectedSalary: dto.expectedSalary } : {}),
        ...(dto.experience !== undefined ? { experience: dto.experience } : {}),
        ...(dto.interviewStatus !== undefined ? { interviewStatus: dto.interviewStatus } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
        ...(hrEmp ? { assignedHrId: hrEmp.id, assignedHrName: `${hrEmp.firstName} ${hrEmp.lastName}`.trim() } : {}),
      },
    });

    if (dto.interviewStatus && dto.interviewStatus !== existing.interviewStatus) {
      await this.prisma.candidateStatusHistory.create({
        data: {
          customerId: numCustomerId,
          applicationId: id,
          fromStatus: existing.interviewStatus,
          toStatus: dto.interviewStatus,
          changedById: user?.id ? Number(user.id) : null,
          changedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'HR',
          remarks: dto.remarks || null,
        },
      });

      if (dto.notifyCandidate !== false) {
        const eventMap: Record<string, string> = {
          SELECTED: 'SELECTED',
          REJECTED: 'REJECTED',
          OFFER_SENT: 'OFFER_LETTER',
        };
        const ev = eventMap[dto.interviewStatus];
        if (ev) this.dispatchCandidateNotifications(id, ev).catch(() => {});
      }
    }

    return { success: true, data: updated };
  }

  async scheduleInterview(
    user: any,
    customerId: number | string | undefined,
    id: number,
    dto: ScheduleInterviewDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const existing = await this.prisma.candidateApplication.findFirst({
      where: { id, customerId: numCustomerId },
    });
    if (!existing) throw new NotFoundException(`Application #${id} not found`);

    const isReschedule = Boolean(existing.interviewDate);
    const interview = await this.prisma.$transaction(async (tx) => {
      const row = await tx.candidateInterview.create({
        data: {
          customerId: numCustomerId,
          applicationId: id,
          interviewDate: dto.interviewDate,
          interviewTime: dto.interviewTime,
          mode: dto.mode || 'IN_PERSON',
          location: dto.location?.trim() || null,
          meetingLink: dto.meetingLink?.trim() || null,
          interviewerName: dto.interviewerName?.trim() || null,
          status: isReschedule ? 'RESCHEDULED' : 'SCHEDULED',
          notes: dto.notes?.trim() || null,
          createdById: user?.id ? Number(user.id) : null,
        },
      });
      await tx.candidateApplication.update({
        where: { id },
        data: {
          interviewDate: dto.interviewDate,
          interviewTime: dto.interviewTime,
          interviewMode: dto.mode || 'IN_PERSON',
          interviewLocation: dto.location?.trim() || null,
          meetingLink: dto.meetingLink?.trim() || null,
          interviewStatus: 'INTERVIEW_SCHEDULED',
        },
      });
      await tx.candidateStatusHistory.create({
        data: {
          customerId: numCustomerId,
          applicationId: id,
          fromStatus: existing.interviewStatus,
          toStatus: 'INTERVIEW_SCHEDULED',
          changedById: user?.id ? Number(user.id) : null,
          changedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'HR',
          remarks: `${isReschedule ? 'Rescheduled' : 'Scheduled'} for ${dto.interviewDate} at ${dto.interviewTime}`,
        },
      });
      return row;
    });

    if (dto.notifyCandidate !== false) {
      this.dispatchCandidateNotifications(
        id,
        isReschedule ? 'INTERVIEW_RESCHEDULED' : 'INTERVIEW_SCHEDULED',
      ).catch(() => {});
    }

    return { success: true, data: interview };
  }

  async getResumeBuffer(user: any, customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const app = await this.prisma.candidateApplication.findFirst({
      where: { id, customerId: numCustomerId },
    });
    if (!app || !app.resumeKey) throw new NotFoundException('Resume not found');

    const localPath = path.join(process.cwd(), 'uploads', app.resumeKey);
    if (fs.existsSync(localPath)) {
      return {
        buffer: fs.readFileSync(localPath),
        filename: app.resumeFilename || path.basename(app.resumeKey),
      };
    }
    if (!app.resumeUrl && this.s3Service) {
      try {
        return {
          buffer: await this.s3Service.readPrivateObject(app.resumeKey),
          filename: app.resumeFilename || path.basename(app.resumeKey),
        };
      } catch (err: any) {
        this.logger.warn(`S3 private resume read failed: ${err?.message}`);
      }
    }
    if (app.resumeUrl) {
      const resp = await fetch(app.resumeUrl);
      if (resp.ok) {
        return {
          buffer: Buffer.from(await resp.arrayBuffer()),
          filename: app.resumeFilename || 'resume.pdf',
        };
      }
    }
    throw new NotFoundException('Resume file unavailable');
  }

  async dispatchCandidateNotifications(applicationId: number, eventType: string) {
    const app = await this.prisma.candidateApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: app.customerId },
      select: { companyName: true, name: true },
    });
    const company = customer?.companyName || customer?.name || 'QB Suite';

    const messages: Record<string, { subject: string; body: string }> = {
      APPLICATION_RECEIVED: {
        subject: `Application Received - ${company}`,
        body: `Hello ${app.candidateName}, thank you for applying for ${app.departmentName || 'our open role'} at ${company}. Our HR team will review your profile shortly.`,
      },
      INTERVIEW_SCHEDULED: {
        subject: `Interview Scheduled - ${company}`,
        body: `Hello ${app.candidateName}, your interview with ${company} is scheduled on ${app.interviewDate} at ${app.interviewTime}. ${app.meetingLink ? `Meeting Link: ${app.meetingLink}` : `Location: ${app.interviewLocation || 'Office'}`}`,
      },
      INTERVIEW_RESCHEDULED: {
        subject: `Interview Rescheduled - ${company}`,
        body: `Hello ${app.candidateName}, your interview with ${company} has been rescheduled to ${app.interviewDate} at ${app.interviewTime}. ${app.meetingLink ? `Meeting Link: ${app.meetingLink}` : `Location: ${app.interviewLocation || 'Office'}`}`,
      },
      SELECTED: {
        subject: `Congratulations! Selection Update - ${company}`,
        body: `Hello ${app.candidateName}, congratulations! You have been selected for ${app.departmentName || 'the role'} at ${company}.`,
      },
      REJECTED: {
        subject: `Application Update - ${company}`,
        body: `Hello ${app.candidateName}, thank you for interviewing with ${company}. Unfortunately, we are not moving forward at this time.`,
      },
      OFFER_LETTER: {
        subject: `Offer Letter - ${company}`,
        body: `Hello ${app.candidateName}, your offer letter from ${company} has been issued. Our HR team will coordinate your onboarding.`,
      },
    };
    const msg = messages[eventType] || messages.APPLICATION_RECEIVED;

    if (app.email && this.emailService) {
      try {
        await this.emailService.sendEmail({
          to: app.email,
          subject: msg.subject,
          html: `<p>${msg.body}</p>`,
        } as any);
        await this.prisma.candidateNotificationLog.create({
          data: {
            customerId: app.customerId,
            applicationId,
            eventType,
            channel: 'EMAIL',
            recipient: app.email,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      } catch (err: any) {
        await this.prisma.candidateNotificationLog.create({
          data: {
            customerId: app.customerId,
            applicationId,
            eventType,
            channel: 'EMAIL',
            recipient: app.email,
            status: 'FAILED',
            errorMessage: err?.message || 'Email failed',
          },
        });
      }
    }

    const phone = `${app.countryCode}${app.mobileNumber}`.replace(/\s+/g, '');
    if (phone && this.whatsappService) {
      try {
        const res: any = await (this.whatsappService as any).sendTextMessage?.(phone, msg.body)
          ?? { success: false, skipped: true, reason: 'TEMPLATE_REQUIRED' };
        await this.prisma.candidateNotificationLog.create({
          data: {
            customerId: app.customerId,
            applicationId,
            eventType,
            channel: 'WHATSAPP',
            recipient: phone,
            status: res?.success ? 'SENT' : res?.skipped ? 'SKIPPED' : 'FAILED',
            errorMessage: res?.success ? null : (res?.error || res?.reason || 'WhatsApp not sent'),
            sentAt: res?.success ? new Date() : null,
          },
        });
      } catch (err: any) {
        await this.prisma.candidateNotificationLog.create({
          data: {
            customerId: app.customerId,
            applicationId,
            eventType,
            channel: 'WHATSAPP',
            recipient: phone,
            status: 'FAILED',
            errorMessage: err?.message || 'WhatsApp failed',
          },
        });
      }
    }
  }

  async retryNotification(user: any, customerId: number | string | undefined, logId: number) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const log = await this.prisma.candidateNotificationLog.findFirst({
      where: { id: logId, customerId: numCustomerId },
    });
    if (!log) throw new NotFoundException(`Notification log #${logId} not found`);
    await this.dispatchCandidateNotifications(log.applicationId, log.eventType);
    return { success: true };
  }

  async convertToEmployee(
    user: any,
    customerId: number | string | undefined,
    applicationId: number,
    dto: ConvertCandidateToEmployeeDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const app = await this.prisma.candidateApplication.findFirst({
      where: { id: applicationId, customerId: numCustomerId },
    });
    if (!app) throw new NotFoundException(`Application #${applicationId} not found`);
    if (app.convertedEmployeeId) {
      throw new ConflictException(`Candidate already converted to Employee #${app.convertedEmployeeId}`);
    }
    if (!this.employeeService) {
      throw new BadRequestException('Employee service unavailable');
    }

    const nameParts = app.candidateName.trim().split(/\s+/);
    const firstName = nameParts[0] || app.candidateName;
    const lastName = nameParts.slice(1).join(' ') || 'Employee';

    const createdEmp: any = await this.employeeService.create({
      customerId: numCustomerId,
      dto: {
        firstName,
        lastName,
        email: app.email,
        phone: `${app.countryCode}${app.mobileNumber}`,
        employeeCode: dto.employeeCode,
        departmentId: dto.departmentId ?? app.departmentId ?? undefined,
        designationId: dto.designationId,
        joiningDate: dto.joiningDate,
        monthlySalary: dto.monthlySalary ?? app.expectedSalary ?? undefined,
        shiftId: dto.shiftId,
        reportingManagerId: dto.reportingManagerId,
        password: dto.password || 'Welcome@123',
        mobileLoginEnabled: dto.mobileLoginEnabled ?? true,
      } as any,
    });

    const empId = createdEmp?.data?.id ?? createdEmp?.id;
    const updatedApp = await this.prisma.candidateApplication.update({
      where: { id: applicationId },
      data: {
        convertedEmployeeId: empId || null,
        interviewStatus: 'JOINED',
      },
    });
    await this.prisma.candidateStatusHistory.create({
      data: {
        customerId: numCustomerId,
        applicationId,
        fromStatus: app.interviewStatus,
        toStatus: 'JOINED',
        changedById: user?.id ? Number(user.id) : null,
        changedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'HR',
        remarks: `Converted to Employee #${empId}`,
      },
    });

    return { success: true, data: { application: updatedApp, employee: createdEmp?.data ?? createdEmp } };
  }

  async exportApplications(
    user: any,
    customerId: number | string | undefined,
    query: any,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const { data } = await this.listApplications(user, customerId, query);
    const rows = data.rows;
    const format = String(query.format || 'csv').toLowerCase();

    if (format === 'xlsx' || format === 'excel') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Hiring Applications');
      const startRow = applyExcelBranding(wb, ws, 'Recruitment & Candidate Applications', `Total: ${rows.length}`);
      const headers = [
        'Candidate Name', 'Mobile Number', 'Email Address', 'Department',
        'Interview Date', 'Interview Time', 'Current Salary', 'Expected Salary',
        'Experience', 'Interview Status', 'Remarks', 'Application Date', 'Source',
      ];
      const headerRow = ws.getRow(startRow);
      headerRow.values = headers;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107569' } };
      rows.forEach((r) =>
        ws.addRow([
          r.candidateName, `${r.countryCode} ${r.mobileNumber}`, r.email, r.departmentName || '',
          r.interviewDate || '', r.interviewTime || '', r.currentSalary ?? '', r.expectedSalary ?? '',
          r.experience || '', r.interviewStatus, r.remarks || '', String(r.appliedAt).slice(0, 10), r.source,
        ]),
      );
      return {
        buffer: Buffer.from(await wb.xlsx.writeBuffer()),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'hiring-applications.xlsx',
      };
    }

    if (format === 'pdf') {
      const numCustomerId = await this.resolveCustomerId(user, customerId);
      const customer = await this.prisma.customer.findUnique({
        where: { id: numCustomerId },
        select: { companyName: true, name: true },
      });
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        let y = drawStandardPdfHeader(doc, {
          companyName: customer?.companyName || customer?.name || 'QB Suite',
          title: 'Hiring & Recruitment Report',
          rightLine1: `Total Candidates: ${rows.length}`,
          bannerHeight: 68,
          marginX: 28,
        });
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#0F172A');
        doc.text('Candidate  |  Mobile  |  Department  |  Interview  |  Curr/Exp Salary  |  Exp  |  Status', 28, y);
        y += 14;
        doc.font('Helvetica').fontSize(7.5);
        rows.forEach((r) => {
          if (y > doc.page.height - 40) { doc.addPage(); y = 28; }
          doc.text(
            `${r.candidateName}  |  ${r.countryCode} ${r.mobileNumber}  |  ${r.departmentName || '-'}  |  ${r.interviewDate || '-'} ${r.interviewTime || ''}  |  ${r.currentSalary ?? '-'}/${r.expectedSalary ?? '-'}  |  ${r.experience || '-'}  |  ${r.interviewStatus}`,
            28,
            y,
            { width: doc.page.width - 56 },
          );
          y += 13;
        });
        doc.end();
      });
      return { buffer, mimeType: 'application/pdf', filename: 'hiring-applications.pdf' };
    }

    const header = [
      'Candidate Name', 'Mobile Number', 'Email', 'Department', 'Interview Date', 'Interview Time',
      'Current Salary', 'Expected Salary', 'Experience', 'Interview Status', 'Remarks', 'Application Date', 'Source',
    ].join(',');
    const lines = rows.map((r) =>
      [
        r.candidateName, `${r.countryCode} ${r.mobileNumber}`, r.email, r.departmentName || '',
        r.interviewDate || '', r.interviewTime || '', r.currentSalary ?? '', r.expectedSalary ?? '',
        r.experience || '', r.interviewStatus, r.remarks || '', String(r.appliedAt).slice(0, 10), r.source,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
    );
    return {
      buffer: Buffer.from([header, ...lines].join('\n'), 'utf8'),
      mimeType: 'text/csv',
      filename: 'hiring-applications.csv',
    };
  }
}
