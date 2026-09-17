import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeType, WorkType, TaskStatus, WorkStatus, PaymentMethod } from '@prisma/client';

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

    const counts = await this.prisma.employee.groupBy({
      by: ['employeeType'],
      where: { customerId: numCustomerId },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    for (const c of counts) {
      countMap[c.employeeType] = c._count.id;
    }

    const types = [
      {
        id: 'COMPANY',
        code: 'COMPANY',
        name: 'Company Full-Time / On-Roll',
        description: 'Standard on-roll salaried employees eligible for full payroll, attendance tracking, and benefits.',
        employeeCount: countMap['COMPANY'] || 0,
        isActive: true,
        isSystem: true,
      },
      {
        id: 'FREELANCER',
        code: 'FREELANCER',
        name: 'Freelancer / Contractor',
        description: 'Contract-based or gig workforce assigned to project shoots, video editing, or freelance creative tasks.',
        employeeCount: countMap['FREELANCER'] || 0,
        isActive: true,
        isSystem: true,
      },
    ];

    return { success: true, data: types };
  }

  async getWorkTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const workCounts = await this.prisma.work.groupBy({
      by: ['workType'],
      where: { customerId: numCustomerId },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    for (const wc of workCounts) {
      countMap[wc.workType] = wc._count.id;
    }

    const catalog: Array<{
      code: string;
      name: string;
      category: 'Production' | 'Design' | 'Marketing' | 'Management';
      description: string;
      itemCount: number;
      isActive: boolean;
    }> = [
      { code: 'REELS_SHOOT', name: 'Reels Shoot', category: 'Production', description: 'On-site video production and reels recording.', itemCount: countMap['REELS_SHOOT'] || 0, isActive: true },
      { code: 'VIDEO_EDITING', name: 'Video Editing', category: 'Production', description: 'Post-production cutting, sound, and color grading.', itemCount: countMap['VIDEO_EDITING'] || 0, isActive: true },
      { code: 'POST_DESIGN', name: 'Post Design', category: 'Design', description: 'Social media creative graphics and carousel designs.', itemCount: countMap['POST_DESIGN'] || 0, isActive: true },
      { code: 'STORY_DESIGN', name: 'Story Design', category: 'Design', description: 'Interactive and promotional 9:16 vertical stories.', itemCount: countMap['STORY_DESIGN'] || 0, isActive: true },
      { code: 'UPLOADING', name: 'Publishing & Uploading', category: 'Marketing', description: 'Scheduling and publishing finalized digital assets.', itemCount: countMap['UPLOADING'] || 0, isActive: true },
      { code: 'INFLUENCER_PROMO', name: 'Influencer Promotion', category: 'Marketing', description: 'Creator collaborations, product seeding, and shoutouts.', itemCount: countMap['INFLUENCER_PROMO'] || 0, isActive: true },
      { code: 'ADS_MANAGEMENT', name: 'Ads Campaign Management', category: 'Marketing', description: 'Paid ad optimization on Meta and Google Ads.', itemCount: countMap['ADS_MANAGEMENT'] || 0, isActive: true },
      { code: 'SHOOT', name: 'Commercial Photo/Video Shoot', category: 'Production', description: 'Professional product and catalog photography.', itemCount: countMap['SHOOT'] || 0, isActive: true },
      { code: 'GRAPHIC_DESIGN', name: 'Branding & Graphics', category: 'Design', description: 'Vector logos, brand identity, and print marketing collateral.', itemCount: countMap['GRAPHIC_DESIGN'] || 0, isActive: true },
      { code: 'CONTENT_WRITING', name: 'Content & Copywriting', category: 'Marketing', description: 'Captions, hashtags, marketing scriptwriting, and newsletters.', itemCount: countMap['CONTENT_WRITING'] || 0, isActive: true },
      { code: 'PERFORMANCE_REPORT', name: 'Performance Analytics', category: 'Management', description: 'Monthly KPI, reach, and engagement reporting.', itemCount: countMap['PERFORMANCE_REPORT'] || 0, isActive: true },
    ];

    return { success: true, data: catalog };
  }

  async getActivityTypes(customerId?: number | string) {
    const activityTypes = [
      { code: 'REEL', name: 'Reel Activity', target: 'Calendar / Schedules', color: '#8B5CF6', description: 'Scheduled short-form vertical video publish.' },
      { code: 'POST', name: 'Creative Post Activity', target: 'Calendar / Schedules', color: '#0284C7', description: 'Scheduled single image or carousel social post.' },
      { code: 'STORY', name: 'Story Activity', target: 'Calendar / Schedules', color: '#EC4899', description: 'Daily promotional or behind-the-scenes story.' },
      { code: 'SHOOT', name: 'On-Site Shoot Activity', target: 'Calendar / Schedules', color: '#10B981', description: 'Scheduled location or studio content shoot.' },
      { code: 'REVIEW', name: 'Creative Review Activity', target: 'Quality Assurance', color: '#F59E0B', description: 'Admin or client approval session for deliverables.' },
      { code: 'CALL', name: 'Client Phone Call', target: 'CRM / Leads', color: '#3B82F6', description: 'Scheduled lead discovery or client alignment phone call.' },
      { code: 'MEETING', name: 'Client Meeting / Pitch', target: 'CRM / Leads', color: '#6366F1', description: 'Virtual or in-person business review meeting.' },
      { code: 'NOTE', name: 'CRM Activity Note', target: 'CRM / Leads', color: '#64748B', description: 'Internal follow-up summary or strategy briefing.' },
    ];

    return { success: true, data: activityTypes };
  }

  async getTaskStatuses(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const [taskCounts, workCounts] = await Promise.all([
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

    const statuses = [
      { code: 'PENDING', name: 'Pending', type: 'Task', color: '#F59E0B', count: taskCountMap['PENDING'] || 0, description: 'Task queued for execution.' },
      { code: 'ASSIGNED', name: 'Assigned', type: 'Work', color: '#3B82F6', count: workCountMap['ASSIGNED'] || 0, description: 'Allocated to an employee or creative editor.' },
      { code: 'IN_PROGRESS', name: 'In Progress', type: 'Task & Work', color: '#06B6D4', count: (taskCountMap['IN_PROGRESS'] || 0) + (workCountMap['IN_PROGRESS'] || 0), description: 'Actively being drafted, shot, or edited.' },
      { code: 'SUBMITTED', name: 'Submitted', type: 'Work', color: '#8B5CF6', count: workCountMap['SUBMITTED'] || 0, description: 'Submitted for internal supervisor review.' },
      { code: 'CUSTOMER_REVIEW', name: 'Customer Review', type: 'Work', color: '#EC4899', count: workCountMap['CUSTOMER_REVIEW'] || 0, description: 'Sent to Customer Mobile app for client approval.' },
      { code: 'REVISION_REQUESTED', name: 'Revision Requested', type: 'Work', color: '#EF4444', count: workCountMap['REVISION_REQUESTED'] || 0, description: 'Feedback received; adjustments needed.' },
      { code: 'APPROVED', name: 'Approved', type: 'Work', color: '#10B981', count: workCountMap['APPROVED'] || 0, description: 'Approved by client / supervisor.' },
      { code: 'COMPLETED', name: 'Completed', type: 'Task & Work', color: '#22C55E', count: (taskCountMap['COMPLETED'] || 0) + (workCountMap['COMPLETED'] || 0), description: 'Final deliverable published and completed.' },
      { code: 'CANCELLED', name: 'Cancelled', type: 'Task & Work', color: '#64748B', count: (taskCountMap['CANCELLED'] || 0) + (workCountMap['CANCELLED'] || 0), description: 'Discarded or superseded by new requirement.' },
    ];

    return { success: true, data: statuses };
  }

  async getLeadSources(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const leadCounts = await this.prisma.lead.groupBy({
      by: ['source'],
      where: { customerId: numCustomerId },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    for (const lc of leadCounts) {
      if (lc.source) countMap[lc.source.toUpperCase()] = lc._count.id;
    }

    const sources = [
      { code: 'WEBSITE', name: 'Corporate Website', description: 'Inbound leads submitted via web contact forms.', count: countMap['WEBSITE'] || 0, isActive: true },
      { code: 'GOOGLE_PLACES', name: 'Google Places / Maps', description: 'B2B leads captured from local business search.', count: countMap['GOOGLE_PLACES'] || 0, isActive: true },
      { code: 'REFERRAL', name: 'Client Referral', description: 'Warm introductions and word-of-mouth recommendations.', count: countMap['REFERRAL'] || 0, isActive: true },
      { code: 'LINKEDIN', name: 'LinkedIn Outreach', description: 'B2B professional network prospecting and InMail.', count: countMap['LINKEDIN'] || 0, isActive: true },
      { code: 'COLD_CALL', name: 'Direct Cold Calling', description: 'Outbound sales tele-calling campaigns.', count: countMap['COLD_CALL'] || 0, isActive: true },
      { code: 'CAMPAIGN', name: 'Marketing Ad Campaign', description: 'Lead generation campaigns on Meta and Google Ads.', count: countMap['CAMPAIGN'] || 0, isActive: true },
      { code: 'OTHER', name: 'Other Channels', description: 'Exhibitions, events, and miscellaneous sources.', count: countMap['OTHER'] || 0, isActive: true },
    ];

    return { success: true, data: sources };
  }

  async getExpenseCategories(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const claimCounts = await this.prisma.employeeClaim.groupBy({
      by: ['category'],
      where: { customerId: numCustomerId },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    for (const cc of claimCounts) {
      if (cc.category) countMap[cc.category.toUpperCase()] = cc._count.id;
    }

    const policy = await this.prisma.claimPolicy.findFirst({
      where: { customerId: numCustomerId, isActive: true },
    });

    const allowed = policy?.allowedCategories && policy.allowedCategories.length > 0
      ? policy.allowedCategories
      : ['TRAVEL', 'FOOD', 'FUEL', 'ACCOMMODATION', 'MEDICAL', 'COMMUNICATION', 'OFFICE_SUPPLIES', 'OTHER'];

    const catalog = [
      { code: 'TRAVEL', name: 'Travel & Commute', description: 'Flight, train, bus, and local cab fares for business visits.', count: countMap['TRAVEL'] || 0, isAllowed: allowed.includes('TRAVEL') },
      { code: 'FOOD', name: 'Food & Meals', description: 'Client entertainment, team lunches, and travel per-diem meals.', count: countMap['FOOD'] || 0, isAllowed: allowed.includes('FOOD') },
      { code: 'FUEL', name: 'Fuel & Mileage', description: 'Vehicle fuel allowances for sales and shoot location travel.', count: countMap['FUEL'] || 0, isAllowed: allowed.includes('FUEL') },
      { code: 'ACCOMMODATION', name: 'Hotel & Lodging', description: 'Lodging during out-of-town shoot or client assignments.', count: countMap['ACCOMMODATION'] || 0, isAllowed: allowed.includes('ACCOMMODATION') },
      { code: 'MEDICAL', name: 'Medical / Healthcare', description: 'Employee medical bills and emergency care reimbursements.', count: countMap['MEDICAL'] || 0, isAllowed: allowed.includes('MEDICAL') },
      { code: 'COMMUNICATION', name: 'Phone & Internet', description: 'Monthly mobile, broadband, and remote work internet reimbursements.', count: countMap['COMMUNICATION'] || 0, isAllowed: allowed.includes('COMMUNICATION') },
      { code: 'OFFICE_SUPPLIES', name: 'Office Supplies & Gear', description: 'Stationery, shoot props, memory cards, and minor production accessories.', count: countMap['OFFICE_SUPPLIES'] || 0, isAllowed: allowed.includes('OFFICE_SUPPLIES') },
      { code: 'OTHER', name: 'Miscellaneous Expenses', description: 'Other approved business expenses with attached valid receipt.', count: countMap['OTHER'] || 0, isAllowed: allowed.includes('OTHER') },
    ];

    return { success: true, data: catalog, policyLimit: policy?.monthlyClaimLimit || 100000 };
  }

  async getLoanTypes(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const activeLoans = await this.prisma.employeeLoan.count({
      where: { customerId: numCustomerId, status: 'ACTIVE' },
    });

    const loanTypes = [
      {
        id: 'EMERGENCY',
        code: 'EMERGENCY',
        name: 'Emergency Medical Loan',
        maxMonths: 12,
        interestRate: 0.0,
        description: 'Zero-interest short term loan for sudden employee or dependent medical needs.',
        requiresApproval: true,
        isActive: true,
      },
      {
        id: 'SALARY_ADVANCE',
        code: 'SALARY_ADVANCE',
        name: 'Salary Advance',
        maxMonths: 3,
        interestRate: 0.0,
        description: 'Advance against upcoming salary cycle, deducted via automated payroll EMI.',
        requiresApproval: true,
        isActive: true,
      },
      {
        id: 'EQUIPMENT',
        code: 'EQUIPMENT',
        name: 'Equipment / Camera Gear Loan',
        maxMonths: 24,
        interestRate: 4.5,
        description: 'Subsidized loan for creators, photographers, and video editors to acquire production hardware.',
        requiresApproval: true,
        isActive: true,
      },
      {
        id: 'PERSONAL',
        code: 'PERSONAL',
        name: 'Personal Workforce Advance',
        maxMonths: 18,
        interestRate: 6.0,
        description: 'Company-sponsored personal financial assistance with flexible monthly deductions.',
        requiresApproval: true,
        isActive: true,
      },
    ];

    return { success: true, data: loanTypes, activeLoansCount: activeLoans };
  }

  async getPaymentMethods(customerId?: number | string) {
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
      const whereClause: any = { deletedAt: null };
      if (customerId) {
        const numCustId = Number(customerId);
        if (!isNaN(numCustId) && numCustId > 0) {
          whereClause.customerId = numCustId;
        }
      }

      const counts = await this.prisma.paymentHistory.groupBy({
        by: ['paymentMethod'],
        where: whereClause,
        _count: { id: true },
      });

      for (const c of counts) {
        if (c.paymentMethod) {
          countMap[c.paymentMethod] = c._count.id;
        }
      }
    } catch {
      // Safe fallback if table is empty or unpopulated
    }

    const methods = [
      {
        code: 'RAZORPAY',
        name: 'Razorpay Online Gateway',
        type: 'ONLINE',
        isEnabled: paymentSetting?.razorpayEnabled ?? true,
        mode: paymentSetting?.paymentMode || 'TEST',
        transactionsCount: countMap['RAZORPAY'] || 0,
        description: 'Accepts UPI, NetBanking, Debit/Credit Cards via automated Razorpay checkout.',
      },
      {
        code: 'BANK_TRANSFER',
        name: 'Direct Bank Transfer / NEFT / RTGS',
        type: 'OFFLINE',
        isEnabled: paymentSetting?.offlinePaymentEnabled ?? true,
        transactionsCount: countMap['BANK_TRANSFER'] || 0,
        description: 'Customers upload transfer UTR receipts for manual admin verification and activation.',
      },
      {
        code: 'CASH',
        name: 'Cash / Manual Receipt',
        type: 'OFFLINE',
        isEnabled: true,
        transactionsCount: countMap['CASH'] || 0,
        description: 'Over-the-counter payments recorded directly with an invoice receipt.',
      },
      {
        code: 'CREDIT_CARD',
        name: 'Corporate Card / Terminal',
        type: 'ONLINE',
        isEnabled: true,
        transactionsCount: countMap['CREDIT_CARD'] || 0,
        description: 'Direct corporate card swipes or point-of-sale transactions.',
      },
      {
        code: 'OTHER',
        name: 'Other Custom Method',
        type: 'OFFLINE',
        isEnabled: true,
        transactionsCount: countMap['OTHER'] || 0,
        description: 'Cheque or barter service adjustments approved by management.',
      },
    ];

    return {
      success: true,
      data: methods,
      gatewayConfig: {
        mode: paymentSetting?.paymentMode || 'TEST',
        hasLiveKey: Boolean(paymentSetting?.razorpayLiveKeyId),
        hasTestKey: Boolean(paymentSetting?.razorpayTestKeyId),
      },
    };
  }
}
