import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { PreviewEmailTemplateDto } from './dto/preview-email-template.dto';

export interface SystemTemplateDefinition {
  key: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  description: string;
  supportedVariables: string[];
}

export const PREDEFINED_SYSTEM_TEMPLATES: SystemTemplateDefinition[] = [
  {
    key: 'EMAIL_OTP',
    name: 'Email OTP Verification',
    category: 'AUTH',
    subject: 'Your OTP for {{companyName}}',
    description: 'Sent when a user requests an email verification code for login or password reset',
    supportedVariables: ['companyName', 'userName', 'otp'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0f172a; margin-top: 0; margin-bottom: 16px; font-size: 20px;">Verification Code</h2>
  <p style="color: #475569; font-size: 15px; margin-bottom: 12px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px; margin-bottom: 20px;">Your verification OTP is:</p>
  <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
    <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #16a34a; font-family: monospace;">{{otp}}</span>
  </div>
  <p style="color: #64748b; font-size: 14px; margin-top: 16px;">This OTP will expire in <strong>5 minutes</strong>.</p>
  <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">If you did not request this verification code, please ignore this email or contact support immediately.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Regards,<br /><strong style="color: #475569;">{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'PASSWORD_RESET',
    name: 'Password Reset Notification',
    category: 'AUTH',
    subject: 'Reset your {{companyName}} password',
    description: 'Sent when an employee or administrator requests a password reset link or OTP',
    supportedVariables: ['companyName', 'userName', 'resetLink', 'otp'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">We received a request to reset your password for {{companyName}}.</p>
  <div style="margin: 24px 0;">
    <a href="{{resetLink}}" style="background-color: #16a34a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
  </div>
  <p style="color: #64748b; font-size: 14px;">Alternatively, enter this OTP: <strong>{{otp}}</strong></p>
  <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">This request will expire in 15 minutes. If you did not make this request, you can safely ignore this email.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'EMPLOYEE_WELCOME',
    name: 'New Employee Welcome',
    category: 'HR',
    subject: 'Welcome to {{companyName}}, {{userName}}!',
    description: 'Sent to newly created employees with their onboarding login details',
    supportedVariables: ['companyName', 'userName', 'email', 'temporaryPassword', 'loginUrl', 'designation'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0f172a; margin-top: 0;">Welcome to {{companyName}}!</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">We are excited to welcome you to the team as <strong>{{designation}}</strong>.</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 20px 0;">
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Login Email:</strong> {{email}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Temporary Password:</strong> {{temporaryPassword}}</p>
  </div>
  <p style="margin: 24px 0;">
    <a href="{{loginUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Access Employee Portal</a>
  </p>
  <p style="color: #64748b; font-size: 13px;">Please change your password upon your first login.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Warm regards,<br /><strong>{{companyName}} HR Team</strong></p>
</div>`,
  },
  {
    key: 'LEAVE_APPROVED',
    name: 'Leave Application Approved',
    category: 'LEAVE',
    subject: 'Leave Approved: {{leaveType}} ({{startDate}} to {{endDate}})',
    description: 'Sent to employee when their leave application is approved by manager or HR',
    supportedVariables: ['companyName', 'userName', 'leaveType', 'startDate', 'endDate', 'approverName', 'remarks'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #16a34a; margin-top: 0;">Leave Approved</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">Your application for <strong>{{leaveType}}</strong> from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> has been <strong style="color: #16a34a;">APPROVED</strong> by {{approverName}}.</p>
  <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 20px 0;">
    <p style="margin: 0; font-size: 14px; color: #166534;"><strong>Manager Remarks:</strong> {{remarks}}</p>
  </div>
  <p style="color: #64748b; font-size: 13px;">Your leave balance has been updated in the HRM portal.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'LEAVE_REJECTED',
    name: 'Leave Application Rejected',
    category: 'LEAVE',
    subject: 'Leave Update: {{leaveType}} ({{startDate}} to {{endDate}})',
    description: 'Sent to employee when their leave application cannot be approved',
    supportedVariables: ['companyName', 'userName', 'leaveType', 'startDate', 'endDate', 'approverName', 'rejectionReason'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #dc2626; margin-top: 0;">Leave Application Update</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">Your application for <strong>{{leaveType}}</strong> from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> was reviewed by {{approverName}} and could not be approved at this time.</p>
  <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 20px 0;">
    <p style="margin: 0; font-size: 14px; color: #991b1b;"><strong>Reason:</strong> {{rejectionReason}}</p>
  </div>
  <p style="color: #64748b; font-size: 13px;">If you have any questions or need to discuss further, please contact your reporting manager.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'LEAD_DETAILS',
    name: 'Lead Assignment & Details',
    category: 'CRM',
    subject: 'New Lead Assigned: {{leadTitle}}',
    description: 'Sent to sales representative or contact when a lead is created or shared',
    supportedVariables: ['companyName', 'recipientName', 'leadTitle', 'leadContact', 'leadPhone', 'leadCity', 'leadValue', 'leadNotes'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0f172a; margin-top: 0;">Lead Details</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{recipientName}},</p>
  <p style="color: #475569; font-size: 15px;">Here are the details for lead <strong>{{leadTitle}}</strong>:</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Contact:</strong> {{leadContact}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Phone:</strong> {{leadPhone}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>City / Location:</strong> {{leadCity}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Potential Value:</strong> ₹{{leadValue}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Notes:</strong> {{leadNotes}}</p>
  </div>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}} CRM</strong></p>
</div>`,
  },
  {
    key: 'CUSTOMER_WELCOME',
    name: 'Customer Welcome & Onboarding',
    category: 'CRM',
    subject: 'Welcome to {{companyName}}!',
    description: 'Sent to newly converted customers or registered enterprise clients',
    supportedVariables: ['companyName', 'customerName', 'contactEmail', 'supportPhone'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0f172a; margin-top: 0;">Welcome to {{companyName}}!</h2>
  <p style="color: #475569; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #475569; font-size: 15px;">Thank you for partnering with {{companyName}}. We are thrilled to have you onboard.</p>
  <p style="color: #475569; font-size: 15px;">Our team is dedicated to supporting your growth. If you ever have questions or require assistance, reach out at <a href="mailto:{{contactEmail}}">{{contactEmail}}</a> or call {{supportPhone}}.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Warm regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
];

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safely interpolates {{variables}} inside a string template.
   * Does NOT evaluate expressions or execute code.
   */
  interpolate(templateStr: string, variables: Record<string, any> = {}): string {
    if (!templateStr || typeof templateStr !== 'string') return '';
    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      if (varName in variables && variables[varName] !== undefined && variables[varName] !== null) {
        return String(variables[varName]);
      }
      return match;
    });
  }

  /**
   * Auto-seeds standard templates for a customer or global workspace if they do not exist.
   */
  async ensureDefaultTemplates(customerId?: number | null) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    for (const item of PREDEFINED_SYSTEM_TEMPLATES) {
      const existing = await this.prisma.emailTemplate.findFirst({
        where: {
          key: item.key,
          customerId: numCustomerId,
          deletedAt: null,
        },
      });

      if (!existing) {
        await this.prisma.emailTemplate.create({
          data: {
            customerId: numCustomerId,
            key: item.key,
            name: item.name,
            subject: item.subject,
            body: item.body,
            category: item.category,
            description: item.description,
            supportedVariables: item.supportedVariables,
            isSystem: true,
            isActive: true,
          },
        }).catch((err) => {
          this.logger.warn(`Failed to seed template ${item.key}: ${err?.message}`);
        });
      }
    }
  }

  /**
   * Lists templates with optional search and category filters.
   */
  async findAll(customerId?: number | null, query?: { category?: string; isActive?: string | boolean; search?: string }) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    await this.ensureDefaultTemplates(numCustomerId);

    const where: any = {
      deletedAt: null,
      OR: [
        { customerId: numCustomerId },
        { customerId: null },
      ],
    };

    if (query?.category && query.category !== 'ALL') {
      where.category = query.category.toUpperCase();
    }

    if (query?.isActive !== undefined && query.isActive !== '' && query.isActive !== 'ALL') {
      where.isActive = String(query.isActive) === 'true';
    }

    if (query?.search) {
      const s = query.search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { key: { contains: s, mode: 'insensitive' } },
            { subject: { contains: s, mode: 'insensitive' } },
            { description: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const templates = await this.prisma.emailTemplate.findMany({
      where,
      orderBy: [
        { isSystem: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    // Deduplicate: customer-specific overrides take precedence over global templates
    const map = new Map<string, any>();
    for (const t of templates) {
      if (!map.has(t.key) || (t.customerId === numCustomerId && map.get(t.key)?.customerId === null)) {
        map.set(t.key, t);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Retrieves single template by ID.
   */
  async findOne(id: number, customerId?: number | null) {
    const numId = Number(id);
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    const template = await this.prisma.emailTemplate.findFirst({
      where: {
        id: numId,
        deletedAt: null,
        OR: [
          { customerId: numCustomerId },
          { customerId: null },
        ],
      },
    });

    if (!template) {
      throw new NotFoundException(`Email template with ID ${id} not found`);
    }

    return template;
  }

  /**
   * Resolves template by key for email delivery.
   * Checks customer-specific template first; falls back to global/system default;
   * falls back to hardcoded code default if not found in database.
   */
  async findByKey(key: string, customerId?: number | null) {
    const upperKey = (key || '').trim().toUpperCase();
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    // 1. Customer-specific active template
    if (numCustomerId) {
      const custom = await this.prisma.emailTemplate.findFirst({
        where: {
          key: upperKey,
          customerId: numCustomerId,
          isActive: true,
          deletedAt: null,
        },
      });
      if (custom) return custom;
    }

    // 2. Global active template
    const globalTpl = await this.prisma.emailTemplate.findFirst({
      where: {
        key: upperKey,
        customerId: null,
        isActive: true,
        deletedAt: null,
      },
    });
    if (globalTpl) return globalTpl;

    // 3. Fallback to hardcoded predefined system template
    const fallbackDef = PREDEFINED_SYSTEM_TEMPLATES.find((t) => t.key === upperKey);
    if (fallbackDef) {
      return {
        id: 0,
        customerId: null,
        key: fallbackDef.key,
        name: fallbackDef.name,
        subject: fallbackDef.subject,
        body: fallbackDef.body,
        description: fallbackDef.description,
        category: fallbackDef.category,
        supportedVariables: fallbackDef.supportedVariables,
        isSystem: true,
        isActive: true,
      };
    }

    return null;
  }

  /**
   * Creates a new email template.
   */
  async create(dto: CreateEmailTemplateDto, customerId?: number | null) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    const cleanKey = (dto.key || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

    // Check duplicate key within customer scope
    const existing = await this.prisma.emailTemplate.findFirst({
      where: {
        key: cleanKey,
        customerId: numCustomerId,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException(`An email template with key "${cleanKey}" already exists`);
    }

    // Auto-detect variables from subject & body if not explicitly provided
    let variables = dto.supportedVariables || [];
    if (!variables.length) {
      const foundVars = new Set<string>();
      const combined = `${dto.subject} ${dto.body}`;
      const matches = combined.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
      for (const m of matches) {
        if (m[1]) foundVars.add(m[1]);
      }
      variables = Array.from(foundVars);
    }

    return this.prisma.emailTemplate.create({
      data: {
        customerId: numCustomerId,
        name: dto.name.trim(),
        key: cleanKey,
        subject: dto.subject.trim(),
        body: dto.body,
        description: dto.description?.trim() || null,
        category: dto.category ? dto.category.trim().toUpperCase() : 'GENERAL',
        supportedVariables: variables,
        isSystem: false,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });
  }

  /**
   * Updates an existing email template.
   */
  async update(id: number, dto: UpdateEmailTemplateDto, customerId?: number | null) {
    const template = await this.findOne(id, customerId);

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name.trim();
    if (dto.subject !== undefined) updateData.subject = dto.subject.trim();
    if (dto.body !== undefined) updateData.body = dto.body;
    if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
    if (dto.category !== undefined) updateData.category = dto.category.trim().toUpperCase();
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    if (dto.supportedVariables !== undefined) {
      updateData.supportedVariables = dto.supportedVariables;
    } else if (dto.body !== undefined || dto.subject !== undefined) {
      const subj = dto.subject !== undefined ? dto.subject : template.subject;
      const bod = dto.body !== undefined ? dto.body : template.body;
      const foundVars = new Set<string>();
      const matches = `${subj} ${bod}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
      for (const m of matches) {
        if (m[1]) foundVars.add(m[1]);
      }
      updateData.supportedVariables = Array.from(foundVars);
    }

    // If key is changed on non-system template, check duplicate
    if (dto.key && dto.key !== template.key) {
      if (template.isSystem) {
        throw new BadRequestException('The key of a system template cannot be modified');
      }
      const cleanKey = dto.key.trim().toUpperCase().replace(/[\s-]+/g, '_');
      const dup = await this.prisma.emailTemplate.findFirst({
        where: {
          key: cleanKey,
          customerId: template.customerId,
          deletedAt: null,
          id: { not: template.id },
        },
      });
      if (dup) {
        throw new BadRequestException(`A template with key "${cleanKey}" already exists`);
      }
      updateData.key = cleanKey;
    }

    return this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: updateData,
    });
  }

  /**
   * Toggles active / inactive status of a template.
   */
  async toggleActive(id: number, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    return this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: { isActive: !template.isActive },
    });
  }

  /**
   * Soft deletes a user-defined email template.
   */
  async remove(id: number, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    if (template.isSystem) {
      throw new BadRequestException('System email templates cannot be deleted. You can disable them instead.');
    }

    await this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: { deletedAt: new Date() },
    });

    return { success: true, message: `Email template "${template.name}" deleted successfully` };
  }

  /**
   * Generates a preview with interpolated sample variables.
   */
  preview(dto: PreviewEmailTemplateDto) {
    const sampleVars: Record<string, any> = {
      companyName: 'QuickBoom Technologies',
      userName: 'John Doe',
      otp: '682941',
      email: 'john.doe@example.com',
      temporaryPassword: 'QB-' + Math.random().toString(36).slice(-8),
      resetLink: 'https://crm.quickboom.com/reset-password?token=sample-token-123456',
      loginUrl: 'https://crm.quickboom.com/login',
      designation: 'Sales Executive',
      leaveType: 'Casual Leave',
      startDate: new Date().toLocaleDateString('en-IN'),
      endDate: new Date(Date.now() + 86400000 * 2).toLocaleDateString('en-IN'),
      approverName: 'Manager Sarah',
      remarks: 'Approved as per leave policy.',
      rejectionReason: 'Urgent project release during this week.',
      recipientName: 'Vikram Patel',
      leadTitle: 'Sunrise Infrastructure Pvt Ltd',
      leadContact: 'Vikram Patel',
      leadPhone: '+91 98765 43210',
      leadCity: 'Pune',
      leadValue: '1,50,000',
      leadNotes: 'Client interested in Enterprise CRM & HRMS setup.',
      customerName: 'Acme Enterprises',
      contactEmail: 'support@quickboom.com',
      supportPhone: '+91 8000 123 456',
      ...(dto.variables || {}),
    };

    const renderedSubject = this.interpolate(dto.subject, sampleVars);
    const renderedBody = this.interpolate(dto.body, sampleVars);

    return {
      subject: renderedSubject,
      body: renderedBody,
      variablesUsed: sampleVars,
    };
  }

  /**
   * Returns list of known system template events and placeholders.
   */
  getEventDefinitions() {
    return PREDEFINED_SYSTEM_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      category: t.category,
      description: t.description,
      supportedVariables: t.supportedVariables,
    }));
  }
}
