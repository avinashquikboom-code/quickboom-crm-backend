import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { getBusinessDayRange } from '../../common/utils/timezone.util';
import { FinancialMetricsService } from '../invoice/financial-metrics.service';
import { EXPORT_MODULE_SCHEMAS, ExportColumnDef, isSensitiveExportKey } from './export-schemas';
import {
  formatIndianCurrency,
  renderQuikBoomCsv,
  renderQuikBoomExcel,
  renderQuikBoomPdf,
  renderQuikBoomZip,
} from './export-renderer.util';

export interface ExportRequestDto {
  module: string;
  format: 'pdf' | 'xlsx' | 'csv';
  scope?: 'ALL_FILTERED' | 'SELECTED' | 'CURRENT_PAGE' | 'ALL_AUTHORIZED';
  selectedIds?: Array<number | string>;
  columns?: string[];
  orientation?: 'portrait' | 'landscape';
  includeSummary?: boolean;
  includeBranding?: boolean;
  includeFilters?: boolean;
  filters?: Record<string, any>;
  page?: number;
  limit?: number;
  customTitle?: string;
  customColumns?: ExportColumnDef[];
  customRows?: Array<Record<string, any>>;
  customSummary?: Array<{ label: string; value: string | number }>;
}

export interface ExportHistoryEntry {
  jobId: string;
  module: string;
  reportName: string;
  format: string;
  recordCount: number;
  requestedBy: string;
  userId: number | null;
  customerId: number | null;
  requestedAt: string;
  appliedFilters: Record<string, any>;
  fileSizeBytes: number;
  status: 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  expiresAt: string;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly history: ExportHistoryEntry[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly financialMetrics?: FinancialMetricsService,
  ) {}

  getSchemas() {
    return Object.values(EXPORT_MODULE_SCHEMAS);
  }

  private emitLog(event: string, meta: Record<string, any>) {
    this.logger.log(`[EXPORT_EVENT] ${JSON.stringify({ event, timestamp: new Date().toISOString(), ...meta })}`);
  }

  private resolveCustomerScope(user: any, customerId?: number | string): number | null {
    const isSuper = isUserSuperAdmin(user);
    const num = Number(customerId);
    if (!isSuper) {
      if (!num || Number.isNaN(num) || num <= 0) {
        throw new ForbiddenException('Organization context is required for exports.');
      }
      return num;
    }
    return num && !Number.isNaN(num) && num > 0 ? num : null;
  }

  private resolveDateBounds(filters: Record<string, any> = {}) {
    const from = filters.fromDate || filters.dateFrom;
    const to = filters.toDate || filters.dateTo;
    if (!from && !to) return null;
    return {
      gte: from ? getBusinessDayRange(from).start : undefined,
      lte: to ? getBusinessDayRange(to).end : undefined,
    };
  }

  private recordHistory(entry: ExportHistoryEntry) {
    this.history.unshift(entry);
    if (this.history.length > 200) {
      this.history.length = 200;
    }
  }

  getExportHistory(user: any, customerId?: number | string) {
    const isSuper = isUserSuperAdmin(user);
    const scopeId = this.resolveCustomerScope(user, customerId);
    return this.history.filter((h) => {
      if (isSuper) return true;
      return h.customerId === scopeId;
    });
  }

  async countRecords(module: string, filters: Record<string, any>, user: any, customerId?: number | string): Promise<number> {
    const scopeId = this.resolveCustomerScope(user, customerId);
    const { rows } = await this.fetchModuleData(module, { ...filters, _countOnly: true }, scopeId, 'ALL_FILTERED');
    return rows.length;
  }

  async generateExport(dto: ExportRequestDto, user: any, customerId?: number | string) {
    const jobId = `EXP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const startedAt = Date.now();
    const scopeId = this.resolveCustomerScope(user, customerId);
    const requestedBy = user?.fullName || user?.name || user?.email || `User #${user?.id || 'System'}`;
    const format = (dto.format || 'csv').toLowerCase() as 'pdf' | 'xlsx' | 'csv';

    if (!['pdf', 'xlsx', 'csv'].includes(format)) {
      this.emitLog('EXPORT_VALIDATION_FAILED', { jobId, module: dto.module, format, reason: 'Unsupported format' });
      throw new BadRequestException('Supported export formats are pdf, xlsx, and csv.');
    }

    this.emitLog('EXPORT_REQUESTED', { jobId, module: dto.module, format, scope: dto.scope || 'ALL_FILTERED', userId: user?.id });

    try {
      const schema = EXPORT_MODULE_SCHEMAS[dto.module];
      let columns: ExportColumnDef[] = [];
      const title = dto.customTitle || schema?.title || `${dto.module} Report`;
      const sheetName = schema?.sheetName || dto.module;
      let rows: Array<Record<string, any>> = [];
      let summaryMetrics: Array<{ label: string; value: string | number }> = dto.customSummary || [];

      if (Array.isArray(dto.customRows) && Array.isArray(dto.customColumns) && dto.customColumns.length > 0) {
        columns = dto.customColumns.filter((c) => !isSensitiveExportKey(c.key));
        rows = dto.customRows;
      } else if (schema) {
        const fetched = await this.fetchModuleData(
          dto.module,
          dto.filters || {},
          scopeId,
          dto.scope || 'ALL_FILTERED',
          dto.selectedIds,
          dto.page,
          dto.limit,
        );
        rows = fetched.rows;
        if (fetched.summaryMetrics?.length && !summaryMetrics.length) {
          summaryMetrics = fetched.summaryMetrics;
        }
        if (Array.isArray(dto.columns) && dto.columns.length > 0) {
          const colMap = new Map(schema.columns.map((c) => [c.key, c]));
          columns = dto.columns
            .map((key) => colMap.get(key))
            .filter((c): c is ExportColumnDef => Boolean(c && !isSensitiveExportKey(c.key)));
        }
        if (columns.length === 0) {
          columns = schema.columns;
        }
      } else {
        throw new BadRequestException(`Unsupported export module: ${dto.module}`);
      }

      this.emitLog('EXPORT_STARTED', { jobId, module: dto.module, format, recordCount: rows.length });

      const renderCtx = {
        title,
        module: dto.module,
        sheetName,
        orientation: dto.orientation || schema?.defaultOrientation || (columns.length > 6 ? 'landscape' : 'portrait'),
        companyName: 'QUIK BOOM MARKETING AGENCY — QB SUITE',
        generatedBy: requestedBy,
        generatedAt: new Date(),
        appliedFilters: dto.filters || {},
        summaryMetrics,
        includeBranding: dto.includeBranding !== false,
        includeSummary: dto.includeSummary !== false,
        includeFilters: dto.includeFilters !== false,
        columns,
        rows,
      };

      let buffer: Buffer;
      let contentType: string;
      let ext: string;

      if (format === 'pdf') {
        buffer = await renderQuikBoomPdf(renderCtx);
        contentType = 'application/pdf';
        ext = 'pdf';
      } else if (format === 'xlsx') {
        buffer = await renderQuikBoomExcel(renderCtx);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        ext = 'xlsx';
      } else {
        buffer = renderQuikBoomCsv(renderCtx);
        contentType = 'text/csv; charset=utf-8';
        ext = 'csv';
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      const safeModule = dto.module.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const filename = `qb-${safeModule}-${dateStamp}.${ext}`;
      const durationMs = Date.now() - startedAt;

      this.recordHistory({
        jobId,
        module: dto.module,
        reportName: title,
        format: format.toUpperCase(),
        recordCount: rows.length,
        requestedBy,
        userId: user?.id ? Number(user.id) : null,
        customerId: scopeId,
        requestedAt: new Date().toISOString(),
        appliedFilters: dto.filters || {},
        fileSizeBytes: buffer.length,
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });

      this.emitLog('EXPORT_GENERATED', {
        jobId,
        module: dto.module,
        format,
        recordCount: rows.length,
        fileSize: buffer.length,
        durationMs,
      });

      return { jobId, filename, contentType, buffer, recordCount: rows.length };
    } catch (err: any) {
      this.recordHistory({
        jobId,
        module: dto.module,
        reportName: dto.customTitle || dto.module,
        format: format.toUpperCase(),
        recordCount: 0,
        requestedBy,
        userId: user?.id ? Number(user.id) : null,
        customerId: scopeId,
        requestedAt: new Date().toISOString(),
        appliedFilters: dto.filters || {},
        fileSizeBytes: 0,
        status: 'FAILED',
        errorMessage: err?.message || 'Export failed',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      this.emitLog('EXPORT_FAILED', { jobId, module: dto.module, format, error: err?.message });
      throw err;
    }
  }

  async generateIndividualLeadPdf(leadId: number, user: any, customerId?: number | string) {
    const scopeId = this.resolveCustomerScope(user, customerId);
    const lead: any = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        ...(scopeId ? { customerId: scopeId } : {}),
      },
      include: {
        stage: true,
        assignedTo: { select: { firstName: true, lastName: true } },
        employee: { select: { firstName: true, lastName: true, department: { select: { name: true } } } },
        visits: { orderBy: { date: 'desc' }, take: 15 },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 15 },
        notes: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead record not found or access denied.');
    }

    const contactName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || '—';
    const assignedEmp = lead.employee || lead.assignedTo;
    const assignedName = assignedEmp
      ? `${assignedEmp.firstName || ''} ${assignedEmp.lastName || ''}`.trim()
      : 'Unassigned';

    const sections: Array<{ section: string; detail: string }> = [
      { section: 'Lead ID', detail: `LEAD-${lead.id}` },
      { section: 'Business Name', detail: lead.companyName || lead.title || contactName },
      { section: 'Contact Person', detail: contactName },
      { section: 'Phone / Email', detail: `${lead.phone || '—'} / ${lead.email || '—'}` },
      { section: 'Category / City', detail: `${lead.category || '—'} / ${lead.city || '—'}` },
      { section: 'Address', detail: [lead.address, lead.city, lead.state, lead.pincode].filter(Boolean).join(', ') || '—' },
      { section: 'Website', detail: lead.website || '—' },
      { section: 'Google Rating & Reviews', detail: lead.rating != null ? `${lead.rating} ★ (${lead.reviewCount || 0} reviews)` : 'Not Available' },
      { section: 'Source & Stage', detail: `${lead.source || '—'} • ${lead.stage?.name || lead.status || '—'}` },
      { section: 'Assigned Employee', detail: `${assignedName} (${lead.employee?.department?.name || 'General'})` },
      { section: 'Next Follow-up', detail: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toLocaleDateString('en-IN') : 'Not Scheduled' },
      { section: 'Work / Remarks', detail: lead.workNotes || '—' },
    ];

    if (lead.statusHistory?.length) {
      sections.push({
        section: `Stage History (${lead.statusHistory.length})`,
        detail: lead.statusHistory
          .map((h: any) => `${new Date(h.createdAt).toLocaleDateString('en-IN')} — ${h.fromStatus || ''} → ${h.toStatus || ''}`)
          .join('\n'),
      });
    }

    if (lead.visits?.length) {
      sections.push({
        section: `Visit History (${lead.visits.length})`,
        detail: lead.visits
          .map((v: any) => `${new Date(v.date).toLocaleDateString('en-IN')} — ${v.status}: ${v.notes || v.purpose || ''}`)
          .join('\n'),
      });
    }

    if (lead.notes?.length) {
      sections.push({
        section: `Notes (${lead.notes.length})`,
        detail: lead.notes.map((n: any) => `${new Date(n.createdAt).toLocaleDateString('en-IN')}: ${n.content || n.note || ''}`).join('\n'),
      });
    }

    const buffer = await renderQuikBoomPdf({
      title: `Lead Dossier — ${lead.companyName || contactName}`,
      module: 'leads',
      orientation: 'portrait',
      generatedBy: user?.fullName || user?.email || 'Admin',
      generatedAt: new Date(),
      columns: [
        { key: 'section', label: 'Field / Section', type: 'string', width: 28 },
        { key: 'detail', label: 'Details', type: 'string', width: 72 },
      ],
      rows: sections,
    });

    return {
      filename: `qb-lead-${lead.id}.pdf`,
      contentType: 'application/pdf',
      buffer,
    };
  }

  async generateZipArchive(dto: ExportRequestDto, user: any, customerId?: number | string) {
    const ids = Array.isArray(dto.selectedIds) ? dto.selectedIds.map(Number).filter((n) => !Number.isNaN(n) && n > 0) : [];
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one record to download as ZIP.');
    }
    if (ids.length > 50) {
      throw new BadRequestException('ZIP download supports up to 50 documents at once.');
    }

    const files: Array<{ filename: string; buffer: Buffer }> = [];
    if (dto.module === 'leads') {
      for (const id of ids) {
        try {
          const pdf = await this.generateIndividualLeadPdf(id, user, customerId);
          files.push({ filename: pdf.filename, buffer: pdf.buffer });
        } catch {
          // Skip inaccessible records
        }
      }
    } else {
      const single = await this.generateExport({ ...dto, format: 'pdf', scope: 'SELECTED' }, user, customerId);
      files.push({ filename: single.filename, buffer: single.buffer });
    }

    if (files.length === 0) {
      throw new NotFoundException('No authorized documents found for the selected IDs.');
    }

    const zipBuffer = await renderQuikBoomZip(files);
    return {
      filename: `qb-${dto.module}-bundle-${new Date().toISOString().slice(0, 10)}.zip`,
      contentType: 'application/zip',
      buffer: zipBuffer,
      recordCount: files.length,
    };
  }

  private async fetchModuleData(
    module: string,
    filters: Record<string, any>,
    scopeId: number | null,
    scope: string,
    selectedIds?: Array<number | string>,
    page = 1,
    limit = 20,
  ): Promise<{ rows: Array<Record<string, any>>; summaryMetrics?: Array<{ label: string; value: string | number }> }> {
    const baseCustomerWhere: any = scopeId ? { customerId: scopeId } : {};
    const dateRange = scope === 'ALL_AUTHORIZED' ? null : this.resolveDateBounds(filters);
    const idFilter =
      scope === 'SELECTED' && Array.isArray(selectedIds) && selectedIds.length > 0
        ? { id: { in: selectedIds.map(Number).filter((n) => !Number.isNaN(n)) } }
        : {};
    const skipVal = scope === 'CURRENT_PAGE' ? (Math.max(1, page) - 1) * Math.max(1, limit) : undefined;
    const takeVal = scope === 'CURRENT_PAGE' ? Math.min(200, Math.max(1, limit)) : undefined;
    const search = typeof filters.search === 'string' && filters.search.trim() ? filters.search.trim() : null;

    if (module === 'leads') {
      const where: any = {
        ...baseCustomerWhere,
        deletedAt: null,
        ...idFilter,
        ...(dateRange ? { createdAt: dateRange } : {}),
        ...(filters.employeeId ? { OR: [{ employeeId: Number(filters.employeeId) }, { assignedToId: Number(filters.employeeId) }] } : {}),
        ...(filters.leadStageId ? { stageId: Number(filters.leadStageId) } : {}),
        ...(filters.leadSource ? { source: filters.leadSource } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { companyName: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const items = await this.prisma.lead.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { createdAt: 'desc' },
        include: { stage: true, assignedTo: { select: { firstName: true, lastName: true } }, employee: { select: { firstName: true, lastName: true } } },
      });
      const rows = items.map((l: any) => {
        const contactPerson = `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.title || '—';
        const owner = l.employee || l.assignedTo;
        return {
          id: l.id,
          businessName: l.companyName || l.title || contactPerson,
          contactPerson,
          phone: l.phone || '',
          email: l.email || '',
          city: l.city || '',
          category: l.category || '',
          source: l.source || 'OTHER',
          stage: l.stage?.name || l.status || 'NEW',
          assignedTo: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : 'Unassigned',
          estimatedValue: Number(l.value || 0),
          createdAt: l.createdAt,
        };
      });
      return {
        rows,
        summaryMetrics: [
          { label: 'Total Leads', value: rows.length },
          { label: 'Est. Pipeline Value', value: formatIndianCurrency(rows.reduce((s, r) => s + r.estimatedValue, 0)) },
        ],
      };
    }

    if (module === 'deals') {
      const where: any = {
        ...baseCustomerWhere,
        deletedAt: null,
        ...idFilter,
        ...(dateRange ? { createdAt: dateRange } : {}),
        ...(filters.employeeId ? { ownerId: Number(filters.employeeId) } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      };
      const items = await this.prisma.deal.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          contact: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      });
      const rows = items.map((d: any) => ({
        id: d.id,
        title: d.title,
        leadName: d.company?.name || `${d.contact?.firstName || ''} ${d.contact?.lastName || ''}`.trim() || '—',
        stage: d.stage,
        value: Number(d.value || 0),
        ownerName: d.owner ? `${d.owner.firstName || ''} ${d.owner.lastName || ''}`.trim() : 'Unassigned',
        expectedCloseDate: d.expectedCloseDate,
        createdAt: d.createdAt,
      }));
      return {
        rows,
        summaryMetrics: [
          { label: 'Total Deals', value: rows.length },
          { label: 'Total Value', value: formatIndianCurrency(rows.reduce((s, r) => s + r.value, 0)) },
        ],
      };
    }

    if (module === 'customers') {
      const where: any = {
        ...(scopeId ? { id: scopeId } : {}),
        deletedAt: null,
        ...idFilter,
        ...(dateRange ? { createdAt: dateRange } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { companyName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const items = await this.prisma.customer.findMany({ where, skip: skipVal, take: takeVal, orderBy: { createdAt: 'desc' } });
      return {
        rows: items.map((c: any) => ({
          id: c.id,
          name: c.name,
          companyName: c.companyName || c.name,
          email: c.email,
          phone: c.phone || '',
          city: c.city || '',
          status: c.isActive ? 'ACTIVE' : 'INACTIVE',
          createdAt: c.createdAt,
        })),
      };
    }

    if (module === 'invoices') {
      const where: any = {
        ...baseCustomerWhere,
        deletedAt: null,
        ...idFilter,
        ...(dateRange ? { issueDate: dateRange } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
        ...(search ? { invoiceNo: { contains: search, mode: 'insensitive' } } : {}),
      };
      const items = await this.prisma.invoice.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { issueDate: 'desc' },
        include: {
          customer: { select: { name: true, companyName: true } },
          items: true,
          payments: true,
          subscription: { include: { plan: true } },
        },
      });
      const rows = items.map((inv: any) => {
        const calc = this.financialMetrics
          ? this.financialMetrics.computeAuthoritativeInvoice(inv)
          : {
              planName: inv.planName || 'Subscription',
              subTotal: Number(inv.subTotal || 0),
              taxAmount: Number(inv.taxAmount || 0),
              totalAmount: Number(inv.totalAmount || 0),
              paidAmount: Number(inv.paidAmount || 0),
              balanceAmount: Number(inv.balanceAmount || 0),
              paymentMode: inv.paymentMode || 'NOT_PAID',
              status: inv.status,
            };
        return {
          invoiceNo: inv.invoiceNo,
          customerName: inv.customer?.companyName || inv.customer?.name || '—',
          planName: calc.planName,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          subTotal: calc.subTotal,
          taxAmount: calc.taxAmount,
          totalAmount: calc.totalAmount,
          paidAmount: calc.paidAmount,
          balanceAmount: calc.balanceAmount,
          paymentMode: calc.paymentMode,
          status: calc.status,
        };
      });
      return {
        rows,
        summaryMetrics: [
          { label: 'Invoices', value: rows.length },
          { label: 'Total Billed', value: formatIndianCurrency(rows.reduce((s, r) => s + r.totalAmount, 0)) },
          { label: 'Collected', value: formatIndianCurrency(rows.reduce((s, r) => s + r.paidAmount, 0)) },
          { label: 'Outstanding', value: formatIndianCurrency(rows.reduce((s, r) => s + r.balanceAmount, 0)) },
        ],
      };
    }

    if (module === 'employees') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(filters.departmentId ? { departmentId: Number(filters.departmentId) } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const items = await this.prisma.employee.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { createdAt: 'desc' },
        include: { department: { select: { name: true } }, designation: { select: { name: true } } },
      });
      return {
        rows: items.map((e: any) => ({
          employeeCode: e.employeeCode || `EMP-${e.id}`,
          fullName: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          email: e.email || '',
          phone: e.phone || '',
          department: e.department?.name || '—',
          designation: e.designation?.name || '—',
          branch: e.branch || 'Head Office',
          joiningDate: e.joiningDate,
          status: e.status,
        })),
      };
    }

    if (module === 'attendance') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(dateRange ? { date: dateRange } : {}),
        ...(filters.employeeId ? { employeeId: Number(filters.employeeId) } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
      };
      const items = await this.prisma.attendance.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { date: 'desc' },
        include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } } },
      });
      return {
        rows: items.map((a: any) => ({
          date: a.date,
          employeeCode: a.employee?.employeeCode || `EMP-${a.employeeId}`,
          employeeName: a.employee ? `${a.employee.firstName || ''} ${a.employee.lastName || ''}`.trim() : '—',
          department: a.employee?.department?.name || '—',
          punchIn: a.punchInTime,
          punchOut: a.punchOutTime,
          workingHours: Number(a.workingHours || 0),
          lateMinutes: Number(a.lateMinutes || 0),
          status: a.status,
        })),
      };
    }

    if (module === 'leaves') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(dateRange ? { startDate: dateRange } : {}),
        ...(filters.employeeId ? { employeeId: Number(filters.employeeId) } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
      };
      const items = await this.prisma.leaveRequest.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { createdAt: 'desc' },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      return {
        rows: items.map((lv: any) => ({
          id: lv.id,
          employeeName: lv.employee ? `${lv.employee.firstName || ''} ${lv.employee.lastName || ''}`.trim() : '—',
          leaveType: lv.leaveType,
          startDate: lv.startDate,
          endDate: lv.endDate,
          totalDays: Number(lv.totalDays || 1),
          reason: lv.reason || '',
          status: lv.status,
        })),
      };
    }

    if (module === 'announcements') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
        ...(filters.departmentId ? { departmentId: Number(filters.departmentId) } : {}),
        ...(filters.audience ? { audience: filters.audience } : {}),
        ...(dateRange ? { publishAt: dateRange } : {}),
        ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
      };
      const items = await this.prisma.announcement.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: [{ publishAt: 'desc' }, { id: 'desc' }],
        include: { department: { select: { name: true } } },
      });
      return {
        rows: items.map((a: any) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          category: a.category,
          audience: a.audience,
          departmentName: a.department?.name || 'All',
          publishAt: a.publishAt,
          expiresAt: a.expiresAt,
          status: a.status,
        })),
      };
    }

    if (module === 'ssm_access') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(filters.platform && filters.platform !== 'ALL' ? { platform: filters.platform } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
      };
      const items = await this.prisma.socialMediaHandler.findMany({
        where,
        skip: skipVal,
        take: takeVal,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true, companyName: true } } },
      });
      return {
        rows: items.map((h: any) => ({
          id: h.id,
          handlerName: h.handlerName || 'Unassigned',
          handlerEmail: h.handlerEmail || '',
          handlerPhone: h.handlerPhone || '',
          accountName: h.accountName || '',
          platform: h.platform || '',
          customerName: h.customer?.companyName || h.customer?.name || 'All Customers',
          status: h.status || 'ACTIVE',
        })),
      };
    }

    if (module === 'audit_logs') {
      const where: any = {
        ...baseCustomerWhere,
        ...idFilter,
        ...(dateRange ? { createdAt: dateRange } : {}),
        ...(filters.module ? { module: filters.module } : {}),
        ...(filters.action ? { action: filters.action } : {}),
      };
      const items = await this.prisma.auditLog.findMany({
        where,
        skip: skipVal,
        take: takeVal ?? 1000,
        orderBy: { createdAt: 'desc' },
      });
      return {
        rows: items.map((l: any) => ({
          id: l.id,
          userName: l.userName || 'System',
          userRole: l.userRole || '—',
          action: l.action,
          module: l.module,
          description: l.description || '',
          createdAt: l.createdAt,
        })),
      };
    }

    return { rows: [] };
  }
}
