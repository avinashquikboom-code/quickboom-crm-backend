import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (customerId) {
      const parsed = Number(customerId);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const defaultCust = await this.prisma.customer.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return defaultCust?.id || 1;
  }

  // ==========================================
  // GENERIC CRUD FOR MASTER ITEMS
  // ==========================================

  async createMasterItem(customerId: number | string | undefined, dto: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    if (!dto?.type || !dto?.code || !dto?.name) {
      throw new BadRequestException('type, code, and name are required fields.');
    }
    const cleanCode = String(dto.code).trim().toUpperCase();

    // Check duplicate
    const existing = await this.prisma.masterItem.findFirst({
      where: {
        type: dto.type,
        code: cleanCode,
        customerId: numCustomerId,
      },
    });
    if (existing) {
      throw new BadRequestException(`A master item with code "${cleanCode}" already exists.`);
    }

    const item = await this.prisma.masterItem.create({
      data: {
        customerId: numCustomerId,
        type: dto.type,
        code: cleanCode,
        name: String(dto.name).trim(),
        category: dto.category?.trim() || null,
        description: dto.description?.trim() || null,
        color: dto.color?.trim() || null,
        icon: dto.icon?.trim() || null,
        sortOrder: Number(dto.sortOrder) || 0,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
        meta: dto.meta || null,
      },
    });

    return { success: true, data: item, message: 'Master record created successfully' };
  }

  async updateMasterItem(id: number, customerId: number | string | undefined, dto: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const existing = await this.prisma.masterItem.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) {
      throw new NotFoundException(`Master item #${id} not found`);
    }

    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      const cleanCode = dto.code.trim().toUpperCase();
      const duplicate = await this.prisma.masterItem.findFirst({
        where: {
          type: existing.type,
          code: cleanCode,
          customerId: numCustomerId,
          NOT: { id: Number(id) },
        },
      });
      if (duplicate) {
        throw new BadRequestException(`A master record with code "${cleanCode}" already exists.`);
      }
    }

    const updated = await this.prisma.masterItem.update({
      where: { id: Number(id) },
      data: {
        code: dto.code ? String(dto.code).trim().toUpperCase() : undefined,
        name: dto.name ? String(dto.name).trim() : undefined,
        category: dto.category !== undefined ? (dto.category ? String(dto.category).trim() : null) : undefined,
        description: dto.description !== undefined ? (dto.description ? String(dto.description).trim() : null) : undefined,
        color: dto.color !== undefined ? (dto.color ? String(dto.color).trim() : null) : undefined,
        icon: dto.icon !== undefined ? (dto.icon ? String(dto.icon).trim() : null) : undefined,
        sortOrder: dto.sortOrder !== undefined ? Number(dto.sortOrder) : undefined,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : undefined,
        meta: dto.meta !== undefined ? dto.meta : undefined,
      },
    });

    return { success: true, data: updated, message: 'Master record updated successfully' };
  }

  async deleteMasterItem(id: number, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const existing = await this.prisma.masterItem.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) {
      throw new NotFoundException(`Master item #${id} not found`);
    }

    await this.prisma.masterItem.delete({
      where: { id: Number(id) },
    });

    return { success: true, message: 'Master record deleted successfully' };
  }

  private async ensureSeedData(type: string, customerId: number, defaults: any[]) {
    const count = await this.prisma.masterItem.count({
      where: { type, customerId },
    });
    if (count === 0) {
      for (const d of defaults) {
        try {
          await this.prisma.masterItem.create({
            data: {
              customerId,
              type,
              code: d.code,
              name: d.name,
              category: d.category || null,
              description: d.description || null,
              color: d.color || null,
              icon: d.icon || null,
              sortOrder: d.sortOrder || 0,
              isActive: d.isActive !== undefined ? d.isActive : true,
              isSystem: d.isSystem !== undefined ? d.isSystem : true,
              meta: d.meta || null,
            },
          });
        } catch {
          // ignore duplicate race condition
        }
      }
    }
  }

  // ==========================================
  // MODULE SPECIFIC GET METHODS (WITH COUNTS)
  // ==========================================

  async getMasterSummary(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const [
      departmentsCount,
      designationsCount,
      leaveTypesCount,
      leadStagesCount,
      plansCount,
      totalEmployees,
      totalWorkItems,
      totalLeads,
      totalClaims,
      totalLoans,
    ] = await Promise.all([
      this.prisma.department.count({ where: { customerId: numCustomerId, isActive: true } }),
      this.prisma.designation.count({ where: { customerId: numCustomerId, isActive: true } }),
      this.prisma.leaveType.count({ where: { customerId: numCustomerId, isActive: true } }),
      this.prisma.leadStage.count({ where: { customerId: numCustomerId, isActive: true } }),
      this.prisma.plan.count({ where: { isActive: true } }),
      this.prisma.employee.count({ where: { customerId: numCustomerId } }),
      this.prisma.work.count({ where: { customerId: numCustomerId } }),
      this.prisma.lead.count({ where: { customerId: numCustomerId } }),
      this.prisma.employeeClaim.count({ where: { customerId: numCustomerId } }),
      this.prisma.employeeLoan.count({ where: { customerId: numCustomerId } }),
    ]);

    return {
      success: true,
      data: {
        departmentsCount,
        designationsCount,
        leaveTypesCount,
        leadStagesCount,
        plansCount,
        totalEmployees,
        totalWorkItems,
        totalLeads,
        totalClaims,
        totalLoans,
      },
    };
  }

  async getEmployeeTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('EMPLOYEE_TYPE', numCustomerId, [
      {
        code: 'COMPANY',
        name: 'Company Full-Time / On-Roll',
        description: 'Standard on-roll salaried employees eligible for full payroll, attendance tracking, and benefits.',
        isActive: true,
        isSystem: true,
        sortOrder: 1,
      },
      {
        code: 'FREELANCER',
        name: 'Freelancer / Contractor',
        description: 'Contract-based or gig workforce assigned to project shoots, video editing, or freelance creative tasks.',
        isActive: true,
        isSystem: true,
        sortOrder: 2,
      },
    ]);

    const [items, counts] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'EMPLOYEE_TYPE', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.employee.groupBy({
        by: ['employeeType'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const c of counts) {
      countMap[c.employeeType] = c._count.id;
    }

    const data = items.map((it) => ({
      id: it.id,
      code: it.code,
      name: it.name,
      description: it.description,
      employeeCount: countMap[it.code] || 0,
      isActive: it.isActive,
      isSystem: it.isSystem,
      meta: it.meta,
    }));

    return { success: true, data };
  }

  async getWorkTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('WORK_TYPE', numCustomerId, [
      { code: 'REELS_SHOOT', name: 'Reels Shoot', category: 'Production', description: 'On-site video production and reels recording.', sortOrder: 1 },
      { code: 'VIDEO_EDITING', name: 'Video Editing', category: 'Production', description: 'Post-production cutting, sound, and color grading.', sortOrder: 2 },
      { code: 'POST_DESIGN', name: 'Post Design', category: 'Design', description: 'Social media creative graphics and carousel designs.', sortOrder: 3 },
      { code: 'STORY_DESIGN', name: 'Story Design', category: 'Design', description: 'Interactive and promotional 9:16 vertical stories.', sortOrder: 4 },
      { code: 'UPLOADING', name: 'Publishing & Uploading', category: 'Marketing', description: 'Scheduling and publishing finalized digital assets.', sortOrder: 5 },
      { code: 'INFLUENCER_PROMO', name: 'Influencer Promotion', category: 'Marketing', description: 'Creator collaborations, product seeding, and shoutouts.', sortOrder: 6 },
      { code: 'ADS_MANAGEMENT', name: 'Ads Campaign Management', category: 'Marketing', description: 'Paid ad optimization on Meta and Google Ads.', sortOrder: 7 },
      { code: 'SHOOT', name: 'Commercial Photo/Video Shoot', category: 'Production', description: 'Professional product and catalog photography.', sortOrder: 8 },
      { code: 'GRAPHIC_DESIGN', name: 'Branding & Graphics', category: 'Design', description: 'Vector logos, brand identity, and print marketing collateral.', sortOrder: 9 },
      { code: 'CONTENT_WRITING', name: 'Content & Copywriting', category: 'Marketing', description: 'Captions, hashtags, marketing scriptwriting, and newsletters.', sortOrder: 10 },
      { code: 'PERFORMANCE_REPORT', name: 'Performance Analytics', category: 'Management', description: 'Monthly KPI, reach, and engagement reporting.', sortOrder: 11 },
    ]);

    const [items, workCounts] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'WORK_TYPE', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.work.groupBy({
        by: ['workType'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const wc of workCounts) {
      countMap[wc.workType] = wc._count.id;
    }

    const data = items.map((it) => ({
      id: it.id,
      code: it.code,
      name: it.name,
      category: it.category || 'Production',
      description: it.description,
      itemCount: countMap[it.code] || 0,
      isActive: it.isActive,
      isSystem: it.isSystem,
      meta: it.meta,
    }));

    return { success: true, data };
  }

  async getActivityTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('ACTIVITY_TYPE', numCustomerId, [
      { code: 'REEL', name: 'Reel Activity', category: 'Calendar / Schedules', color: '#8B5CF6', description: 'Scheduled short-form vertical video publish.', sortOrder: 1 },
      { code: 'POST', name: 'Creative Post Activity', category: 'Calendar / Schedules', color: '#0284C7', description: 'Scheduled single image or carousel social post.', sortOrder: 2 },
      { code: 'STORY', name: 'Story Activity', category: 'Calendar / Schedules', color: '#EC4899', description: 'Daily promotional or behind-the-scenes story.', sortOrder: 3 },
      { code: 'SHOOT', name: 'On-Site Shoot Activity', category: 'Calendar / Schedules', color: '#10B981', description: 'Scheduled location or studio content shoot.', sortOrder: 4 },
      { code: 'REVIEW', name: 'Creative Review Activity', category: 'Quality Assurance', color: '#F59E0B', description: 'Admin or client approval session for deliverables.', sortOrder: 5 },
      { code: 'CALL', name: 'Client Phone Call', category: 'CRM / Leads', color: '#3B82F6', description: 'Scheduled lead discovery or client alignment phone call.', sortOrder: 6 },
      { code: 'MEETING', name: 'Client Meeting / Pitch', category: 'CRM / Leads', color: '#6366F1', description: 'Virtual or in-person business review meeting.', sortOrder: 7 },
      { code: 'NOTE', name: 'CRM Activity Note', category: 'CRM / Leads', color: '#64748B', description: 'Internal follow-up summary or strategy briefing.', sortOrder: 8 },
    ]);

    const items = await this.prisma.masterItem.findMany({
      where: { type: 'ACTIVITY_TYPE', customerId: numCustomerId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    const data = items.map((it) => ({
      id: it.id,
      code: it.code,
      name: it.name,
      target: it.category || 'CRM / Leads',
      category: it.category,
      color: it.color || '#3B82F6',
      description: it.description,
      isActive: it.isActive,
      isSystem: it.isSystem,
      meta: it.meta,
    }));

    return { success: true, data };
  }

  async getTaskStatuses(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('TASK_STATUS', numCustomerId, [
      { code: 'PENDING', name: 'Pending', category: 'Task', color: '#F59E0B', description: 'Task queued for execution.', sortOrder: 1 },
      { code: 'ASSIGNED', name: 'Assigned', category: 'Work', color: '#3B82F6', description: 'Allocated to an employee or creative editor.', sortOrder: 2 },
      { code: 'IN_PROGRESS', name: 'In Progress', category: 'Task & Work', color: '#06B6D4', description: 'Actively being drafted, shot, or edited.', sortOrder: 3 },
      { code: 'SUBMITTED', name: 'Submitted', category: 'Work', color: '#8B5CF6', description: 'Submitted for internal supervisor review.', sortOrder: 4 },
      { code: 'CUSTOMER_REVIEW', name: 'Customer Review', category: 'Work', color: '#EC4899', description: 'Sent to Customer Mobile app for client approval.', sortOrder: 5 },
      { code: 'REVISION_REQUESTED', name: 'Revision Requested', category: 'Work', color: '#EF4444', description: 'Feedback received; adjustments needed.', sortOrder: 6 },
      { code: 'APPROVED', name: 'Approved', category: 'Work', color: '#10B981', description: 'Approved by client / supervisor.', sortOrder: 7 },
      { code: 'COMPLETED', name: 'Completed', category: 'Task & Work', color: '#22C55E', description: 'Final deliverable published and completed.', sortOrder: 8 },
      { code: 'CANCELLED', name: 'Cancelled', category: 'Task & Work', color: '#64748B', description: 'Discarded or superseded by new requirement.', sortOrder: 9 },
    ]);

    const [items, taskCounts, workCounts] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'TASK_STATUS', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
      this.prisma.work.groupBy({
        by: ['status'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
    ]);

    const taskCountMap: Record<string, number> = {};
    for (const tc of taskCounts) taskCountMap[tc.status] = tc._count.id;

    const workCountMap: Record<string, number> = {};
    for (const wc of workCounts) workCountMap[wc.status] = wc._count.id;

    const data = items.map((it) => {
      let count = 0;
      if (it.category?.includes('Task') && it.category?.includes('Work')) {
        count = (taskCountMap[it.code] || 0) + (workCountMap[it.code] || 0);
      } else if (it.category === 'Work') {
        count = workCountMap[it.code] || 0;
      } else {
        count = taskCountMap[it.code] || 0;
      }

      return {
        id: it.id,
        code: it.code,
        name: it.name,
        type: it.category || 'Task',
        category: it.category,
        color: it.color || '#3B82F6',
        count,
        description: it.description,
        isActive: it.isActive,
        isSystem: it.isSystem,
        meta: it.meta,
      };
    });

    return { success: true, data };
  }

  async getLeadSources(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('LEAD_SOURCE', numCustomerId, [
      { code: 'WEBSITE', name: 'Corporate Website', description: 'Inbound leads submitted via web contact forms.', sortOrder: 1 },
      { code: 'GOOGLE_PLACES', name: 'Google Places / Maps', description: 'B2B leads captured from local business search.', sortOrder: 2 },
      { code: 'REFERRAL', name: 'Client Referral', description: 'Warm introductions and word-of-mouth recommendations.', sortOrder: 3 },
      { code: 'LINKEDIN', name: 'LinkedIn Outreach', description: 'B2B professional network prospecting and InMail.', sortOrder: 4 },
      { code: 'COLD_CALL', name: 'Direct Cold Calling', description: 'Outbound sales tele-calling campaigns.', sortOrder: 5 },
      { code: 'CAMPAIGN', name: 'Marketing Ad Campaign', description: 'Lead generation campaigns on Meta and Google Ads.', sortOrder: 6 },
      { code: 'OTHER', name: 'Other Channels', description: 'Exhibitions, events, and miscellaneous sources.', sortOrder: 7 },
    ]);

    const [items, leadCounts] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'LEAD_SOURCE', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const lc of leadCounts) {
      if (lc.source) countMap[lc.source.toUpperCase()] = lc._count.id;
    }

    const data = items.map((it) => ({
      id: it.id,
      code: it.code,
      name: it.name,
      description: it.description,
      count: countMap[it.code] || 0,
      isActive: it.isActive,
      isSystem: it.isSystem,
      meta: it.meta,
    }));

    return { success: true, data };
  }

  async getExpenseCategories(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('EXPENSE_CATEGORY', numCustomerId, [
      { code: 'TRAVEL', name: 'Travel & Commute', description: 'Flight, train, bus, and local cab fares for business visits.', meta: { isAllowed: true }, sortOrder: 1 },
      { code: 'FOOD', name: 'Food & Meals', description: 'Client entertainment, team lunches, and travel per-diem meals.', meta: { isAllowed: true }, sortOrder: 2 },
      { code: 'FUEL', name: 'Fuel & Mileage', description: 'Vehicle fuel allowances for sales and shoot location travel.', meta: { isAllowed: true }, sortOrder: 3 },
      { code: 'ACCOMMODATION', name: 'Hotel & Lodging', description: 'Lodging during out-of-town shoot or client assignments.', meta: { isAllowed: true }, sortOrder: 4 },
      { code: 'MEDICAL', name: 'Medical / Healthcare', description: 'Employee medical bills and emergency care reimbursements.', meta: { isAllowed: true }, sortOrder: 5 },
      { code: 'COMMUNICATION', name: 'Phone & Internet', description: 'Monthly mobile, broadband, and remote work internet reimbursements.', meta: { isAllowed: true }, sortOrder: 6 },
      { code: 'OFFICE_SUPPLIES', name: 'Office Supplies & Gear', description: 'Stationery, shoot props, memory cards, and minor production accessories.', meta: { isAllowed: true }, sortOrder: 7 },
      { code: 'OTHER', name: 'Miscellaneous Expenses', description: 'Other approved business expenses with attached valid receipt.', meta: { isAllowed: true }, sortOrder: 8 },
    ]);

    const [items, claimCounts, policy] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'EXPENSE_CATEGORY', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.employeeClaim.groupBy({
        by: ['category'],
        where: { customerId: numCustomerId },
        _count: { id: true },
      }),
      this.prisma.claimPolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const cc of claimCounts) {
      if (cc.category) countMap[cc.category.toUpperCase()] = cc._count.id;
    }

    const allowed = policy?.allowedCategories && policy.allowedCategories.length > 0
      ? policy.allowedCategories
      : ['TRAVEL', 'FOOD', 'FUEL', 'ACCOMMODATION', 'MEDICAL', 'COMMUNICATION', 'OFFICE_SUPPLIES', 'OTHER'];

    const data = items.map((it) => {
      const isAllowed = (it.meta as any)?.isAllowed !== undefined
        ? (it.meta as any).isAllowed
        : allowed.includes(it.code);

      return {
        id: it.id,
        code: it.code,
        name: it.name,
        description: it.description,
        count: countMap[it.code] || 0,
        isAllowed: Boolean(isAllowed),
        isActive: it.isActive,
        isSystem: it.isSystem,
        meta: it.meta,
      };
    });

    return { success: true, data, policyLimit: policy?.monthlyClaimLimit || 100000 };
  }

  async getLoanTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('LOAN_TYPE', numCustomerId, [
      {
        code: 'EMERGENCY',
        name: 'Emergency Medical Loan',
        description: 'Zero-interest short term loan for sudden employee or dependent medical needs.',
        meta: { maxMonths: 12, interestRate: 0.0, requiresApproval: true },
        sortOrder: 1,
      },
      {
        code: 'SALARY_ADVANCE',
        name: 'Salary Advance',
        description: 'Advance against upcoming salary cycle, deducted via automated payroll EMI.',
        meta: { maxMonths: 3, interestRate: 0.0, requiresApproval: true },
        sortOrder: 2,
      },
      {
        code: 'EQUIPMENT',
        name: 'Equipment / Camera Gear Loan',
        description: 'Subsidized loan for creators, photographers, and video editors to acquire production hardware.',
        meta: { maxMonths: 24, interestRate: 4.5, requiresApproval: true },
        sortOrder: 3,
      },
      {
        code: 'PERSONAL',
        name: 'Personal Workforce Advance',
        description: 'Company-sponsored personal financial assistance with flexible monthly deductions.',
        meta: { maxMonths: 18, interestRate: 6.0, requiresApproval: true },
        sortOrder: 4,
      },
    ]);

    const [items, activeLoans] = await Promise.all([
      this.prisma.masterItem.findMany({
        where: { type: 'LOAN_TYPE', customerId: numCustomerId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.employeeLoan.count({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
      }),
    ]);

    const data = items.map((it) => {
      const meta = (it.meta as any) || {};
      return {
        id: it.id,
        code: it.code,
        name: it.name,
        maxMonths: meta.maxMonths || 12,
        interestRate: meta.interestRate !== undefined ? meta.interestRate : 0.0,
        requiresApproval: meta.requiresApproval !== undefined ? meta.requiresApproval : true,
        description: it.description,
        isActive: it.isActive,
        isSystem: it.isSystem,
        meta: it.meta,
      };
    });

    return { success: true, data, activeLoansCount: activeLoans };
  }

  async getPaymentMethods(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    await this.ensureSeedData('PAYMENT_METHOD', numCustomerId, [
      {
        code: 'RAZORPAY',
        name: 'Razorpay Online Gateway',
        category: 'ONLINE',
        description: 'Accepts UPI, NetBanking, Debit/Credit Cards via automated Razorpay checkout.',
        meta: { mode: 'TEST', isEnabled: true },
        sortOrder: 1,
      },
      {
        code: 'BANK_TRANSFER',
        name: 'Direct Bank Transfer / NEFT / RTGS',
        category: 'OFFLINE',
        description: 'Customers upload transfer UTR receipts for manual admin verification and activation.',
        meta: { mode: 'LIVE', isEnabled: true },
        sortOrder: 2,
      },
      {
        code: 'CASH',
        name: 'Cash / Manual Receipt',
        category: 'OFFLINE',
        description: 'Over-the-counter payments recorded directly with an invoice receipt.',
        meta: { mode: 'LIVE', isEnabled: true },
        sortOrder: 3,
      },
      {
        code: 'CREDIT_CARD',
        name: 'Corporate Card / Terminal',
        category: 'ONLINE',
        description: 'Direct corporate card swipes or point-of-sale transactions.',
        meta: { mode: 'LIVE', isEnabled: true },
        sortOrder: 4,
      },
      {
        code: 'OTHER',
        name: 'Other Custom Method',
        category: 'OFFLINE',
        description: 'Cheque or barter service adjustments approved by management.',
        meta: { mode: 'LIVE', isEnabled: true },
        sortOrder: 5,
      },
    ]);

    let paymentSetting: any = null;
    try {
      paymentSetting = await this.prisma.paymentSetting.findFirst({
        where: { singletonKey: 'DEFAULT' },
      });
    } catch {
      paymentSetting = null;
    }

    const countMap: Record<string, number> = {};
    try {
      const counts = await this.prisma.paymentHistory.groupBy({
        by: ['paymentMethod'],
        where: { customerId: numCustomerId, deletedAt: null },
        _count: { id: true },
      });

      for (const c of counts) {
        if (c.paymentMethod) {
          countMap[c.paymentMethod] = c._count.id;
        }
      }
    } catch {
      // safe fallback
    }

    const items = await this.prisma.masterItem.findMany({
      where: { type: 'PAYMENT_METHOD', customerId: numCustomerId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    const data = items.map((it) => {
      const meta = (it.meta as any) || {};
      let isEnabled = it.isActive;
      let mode = meta.mode || 'TEST';

      if (it.code === 'RAZORPAY') {
        isEnabled = paymentSetting?.razorpayEnabled ?? isEnabled;
        mode = paymentSetting?.paymentMode || mode;
      } else if (it.code === 'BANK_TRANSFER') {
        isEnabled = paymentSetting?.offlinePaymentEnabled ?? isEnabled;
      }

      return {
        id: it.id,
        code: it.code,
        name: it.name,
        type: it.category || 'ONLINE',
        category: it.category,
        isEnabled,
        mode,
        transactionsCount: countMap[it.code] || 0,
        description: it.description,
        isActive: it.isActive,
        isSystem: it.isSystem,
        meta: it.meta,
      };
    });

    return {
      success: true,
      data,
      gatewayConfig: {
        mode: paymentSetting?.paymentMode || 'TEST',
        hasLiveKey: Boolean(paymentSetting?.razorpayLiveKeyId),
        hasTestKey: Boolean(paymentSetting?.razorpayTestKeyId),
      },
    };
  }
}
