import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';
import { isUserAdmin } from '../../common/utils/role.util';
import PDFDocument = require('pdfkit');
import ExcelJS = require('exceljs');

export type ExportScope = 'all_complete' | 'individual' | 'summary_only' | 'detailed' | 'stage_wise';

export interface EmployeeLeadStageQuery {
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
  dayOfWeek?: string;
  employeeIds?: string;
  departmentId?: string;
  stageKey?: string;
  page?: number;
  limit?: number;
  search?: string;
  mode?: 'current' | 'transition';
  drillEmployeeId?: string;
  drillStageKey?: string;
  exportScope?: ExportScope;
  exportEmployeeId?: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function normalizeKey(val?: string | null): string {
  return String(val || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function getIstWeekday(date: Date): number {
  const istStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[istStr] ?? date.getDay();
}

function formatIstDateTime(date?: Date | string | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function personDisplayName(rec?: any, fallback = '—'): string {
  if (!rec) return fallback;
  const full = `${rec.firstName || ''} ${rec.lastName || ''}`.trim();
  return full || rec.name || rec.email || fallback;
}

function formatIstDate(date?: Date | string | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

@Injectable()
export class EmployeeLeadStageReportService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveIstDateRange(preset?: string, dateFrom?: string, dateTo?: string) {
    const nowIstStr = getBusinessDate(new Date()); // YYYY-MM-DD in Asia/Kolkata
    const [y, m, d] = nowIstStr.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(y, m - 1, d));

    const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
    const normPreset = String(preset || (dateFrom || dateTo ? 'custom' : 'this_month')).toLowerCase();

    let fromStr = fmt(todayUtc);
    let toStr = fmt(todayUtc);

    if (normPreset === 'today') {
      fromStr = fmt(todayUtc);
      toStr = fmt(todayUtc);
    } else if (normPreset === 'yesterday') {
      const yest = new Date(todayUtc);
      yest.setUTCDate(yest.getUTCDate() - 1);
      fromStr = fmt(yest);
      toStr = fmt(yest);
    } else if (normPreset === 'this_week') {
      const day = todayUtc.getUTCDay(); // 0=Sun..6=Sat
      const diffToMon = day === 0 ? 6 : day - 1;
      const mon = new Date(todayUtc);
      mon.setUTCDate(mon.getUTCDate() - diffToMon);
      fromStr = fmt(mon);
      toStr = fmt(todayUtc);
    } else if (normPreset === 'last_week') {
      const day = todayUtc.getUTCDay();
      const diffToMon = day === 0 ? 6 : day - 1;
      const thisMon = new Date(todayUtc);
      thisMon.setUTCDate(thisMon.getUTCDate() - diffToMon);
      const lastMon = new Date(thisMon);
      lastMon.setUTCDate(lastMon.getUTCDate() - 7);
      const lastSun = new Date(thisMon);
      lastSun.setUTCDate(lastSun.getUTCDate() - 1);
      fromStr = fmt(lastMon);
      toStr = fmt(lastSun);
    } else if (normPreset === 'this_month') {
      fromStr = fmt(new Date(Date.UTC(y, m - 1, 1)));
      toStr = fmt(todayUtc);
    } else if (normPreset === 'last_month') {
      const firstLastMonth = new Date(Date.UTC(y, m - 2, 1));
      const lastLastMonth = new Date(Date.UTC(y, m - 1, 0));
      fromStr = fmt(firstLastMonth);
      toStr = fmt(lastLastMonth);
    } else if (normPreset === 'this_year') {
      fromStr = fmt(new Date(Date.UTC(y, 0, 1)));
      toStr = fmt(todayUtc);
    } else if (normPreset === 'last_year') {
      fromStr = fmt(new Date(Date.UTC(y - 1, 0, 1)));
      toStr = fmt(new Date(Date.UTC(y - 1, 11, 31)));
    } else {
      if (dateFrom) fromStr = dateFrom.slice(0, 10);
      if (dateTo) toStr = dateTo.slice(0, 10);
      if (!dateFrom && !dateTo) {
        fromStr = fmt(new Date(Date.UTC(y, m - 1, 1)));
        toStr = fmt(todayUtc);
      }
    }

    const start = getBusinessDayRange(fromStr).start;
    const end = getBusinessDayRange(toStr).end;
    return { preset: normPreset, fromStr, toStr, start, end };
  }

  private async getActiveStages(customerId: number) {
    const rawStages = await this.prisma.leadStage.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ customerId }, { customerId: null }],
      },
      orderBy: [{ customerId: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });

    const byKey = new Map<string, any>();
    for (const s of rawStages) {
      const k = normalizeKey(s.key || s.name);
      if (!byKey.has(k)) {
        byKey.set(k, {
          id: s.id,
          key: k,
          rawKey: s.key,
          name: s.name,
          color: s.color || '#0284C7',
          bgColor: s.bgColor || '#E0F2FE',
          sortOrder: s.sortOrder,
        });
      }
    }

    const stages = Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    const idToStage = new Map<number, any>();
    for (const s of rawStages) {
      const canonical = byKey.get(normalizeKey(s.key || s.name));
      if (canonical) idToStage.set(s.id, canonical);
    }
    return { stages, idToStage, byKey };
  }

  private async getEmployeesAndDepartments(customerId: number, user?: any) {
    const [employees, departments] = await Promise.all([
      this.prisma.employee.findMany({
        where: { customerId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.department.findMany({
        where: { customerId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const admin = isUserAdmin(user);
    const scopedEmpId = user?.employee?.id ?? user?.employeeId;

    const visibleEmployees = admin
      ? employees
      : employees.filter((e) => e.id === Number(scopedEmpId) || e.userId === Number(user?.id));

    return { employees: visibleEmployees, allEmployees: employees, departments };
  }

  private resolveLeadStageKey(lead: any, idToStage: Map<number, any>): { key: string; name: string; color: string } {
    if (lead.stageId && idToStage.has(lead.stageId)) {
      const st = idToStage.get(lead.stageId);
      return { key: st.key, name: st.name, color: st.color };
    }
    if (lead.stage) {
      return {
        key: normalizeKey(lead.stage.key || lead.stage.name),
        name: lead.stage.name,
        color: lead.stage.color || '#0284C7',
      };
    }
    const statusKey = normalizeKey(lead.status || 'NEW');
    return { key: statusKey, name: lead.status || 'New', color: '#64748B' };
  }

  private resolveHistoryStageName(
    stageId: number | null | undefined,
    fallbackStatus: string | null | undefined,
    idToStage: Map<number, any>,
    byKey: Map<string, any>,
  ): { key: string; name: string } {
    if (stageId && idToStage.has(stageId)) {
      const st = idToStage.get(stageId);
      return { key: st.key, name: st.name };
    }
    const key = normalizeKey(fallbackStatus);
    if (key && byKey.has(key)) {
      const st = byKey.get(key);
      return { key: st.key, name: st.name };
    }
    return { key: key || 'UNKNOWN', name: fallbackStatus ? String(fallbackStatus).replace(/_/g, ' ') : '—' };
  }

  async getReport(customerId: number, query: EmployeeLeadStageQuery, user?: any) {
    const range = this.resolveIstDateRange(query.preset, query.dateFrom, query.dateTo);
    const dayFilter = query.dayOfWeek && query.dayOfWeek !== 'ALL' ? WEEKDAY_MAP[query.dayOfWeek.toUpperCase()] : undefined;
    const deptFilter = query.departmentId && query.departmentId !== 'ALL' ? Number(query.departmentId) : undefined;
    const stageFilter = query.stageKey && query.stageKey !== 'ALL' ? normalizeKey(query.stageKey) : undefined;
    const selectedEmpIds = String(query.employeeIds || '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const [{ stages, idToStage, byKey }, { employees, allEmployees, departments }] = await Promise.all([
      this.getActiveStages(customerId),
      this.getEmployeesAndDepartments(customerId, user),
    ]);

    let targetEmployees = employees;
    if (deptFilter) {
      targetEmployees = targetEmployees.filter((e) => e.departmentId === deptFilter);
    }
    if (selectedEmpIds.length > 0) {
      const set = new Set(selectedEmpIds);
      targetEmployees = targetEmployees.filter((e) => set.has(e.id));
    }

    const targetEmpIds = new Set(targetEmployees.map((e) => e.id));
    const userIdToEmployee = new Map<number, any>();
    const empIdToEmployee = new Map<number, any>();
    for (const emp of allEmployees) {
      empIdToEmployee.set(emp.id, emp);
      if (emp.userId) userIdToEmployee.set(emp.userId, emp);
    }

    const targetUserIds = new Set(targetEmployees.map((e) => e.userId).filter((id): id is number => Boolean(id)));

    // Fetch leads in period (createdAt or updatedAt in range)
    const rawLeads = await this.prisma.lead.findMany({
      where: {
        customerId,
        deletedAt: null,
        createdAt: { gte: range.start, lte: range.end },
      },
      include: {
        stage: true,
        employee: { include: { department: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Fetch historical stage transitions in period
    const rawHistory = await this.prisma.leadStatusHistory.findMany({
      where: {
        lead: { customerId, deletedAt: null },
        createdAt: { gte: range.start, lte: range.end },
      },
      include: {
        lead: {
          include: {
            stage: true,
            employee: true,
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Apply day-of-week (IST), department, employee, and stage filters
    const matchesEmployee = (empId?: number | null, userId?: number | null) => {
      if (empId && targetEmpIds.has(empId)) return true;
      if (userId && targetUserIds.has(userId)) return true;
      return false;
    };

    const filteredLeads = rawLeads.filter((lead) => {
      if (dayFilter !== undefined && getIstWeekday(lead.createdAt) !== dayFilter) return false;
      const empId = lead.employeeId ?? (lead.assignedToId ? userIdToEmployee.get(lead.assignedToId)?.id : undefined);
      if (selectedEmpIds.length > 0 || deptFilter || !isUserAdmin(user)) {
        if (!matchesEmployee(empId, lead.assignedToId)) return false;
      }
      if (stageFilter) {
        const st = this.resolveLeadStageKey(lead, idToStage);
        if (st.key !== stageFilter) return false;
      }
      return true;
    });

    const filteredHistory = rawHistory.filter((h) => {
      if (dayFilter !== undefined && getIstWeekday(h.createdAt) !== dayFilter) return false;
      const actorEmp = h.changedById ? userIdToEmployee.get(h.changedById) : undefined;
      const fallbackEmpId = h.lead?.employeeId;
      const effectiveEmpId = actorEmp?.id ?? fallbackEmpId;
      if (selectedEmpIds.length > 0 || deptFilter || !isUserAdmin(user)) {
        if (!matchesEmployee(effectiveEmpId, h.changedById ?? h.lead?.assignedToId)) return false;
      }
      if (stageFilter) {
        const toSt = this.resolveHistoryStageName(h.toStageId, h.toStatus, idToStage, byKey);
        if (toSt.key !== stageFilter) return false;
      }
      return true;
    });

    // Deduplicated global metrics
    const assignedLeadIds = new Set<number>();
    const workedLeadIds = new Set<number>();
    const newLeadIds = new Set<number>();
    const hotDealIds = new Set<number>();
    const followUpIds = new Set<number>();
    const visitScheduledIds = new Set<number>();
    const visitCompletedIds = new Set<number>();
    const wonLeadIds = new Set<number>();
    const lostLeadIds = new Set<number>();

    const isHot = (k: string) => k === 'HOT_LEAD' || k === 'HOT_DEAL';
    const isFollowUp = (k: string) => k === 'FOLLOW_UP' || k === 'FOLLOWUP';
    const isVisitSched = (k: string) => ['VISIT_SCHEDULED', 'VISIT_SCHEDULE', 'SCHEDULE_VISIT', 'VISIT'].includes(k);
    const isVisitDone = (k: string) => ['VISIT_DONE', 'VISIT_COMPLETED'].includes(k);
    const isWon = (k: string) => ['WON', 'CONVERTED'].includes(k);
    const isLost = (k: string) => ['LOST', 'CANCELLED'].includes(k);

    const empStatsMap = new Map<number, any>();
    for (const emp of targetEmployees) {
      const stageCounts: Record<string, number> = {};
      const stageTransitionCounts: Record<string, number> = {};
      for (const s of stages) {
        stageCounts[s.key] = 0;
        stageTransitionCounts[s.key] = 0;
      }
      empStatsMap.set(emp.id, {
        employeeId: emp.id,
        userId: emp.userId,
        name: personDisplayName(emp, personDisplayName(emp.user, `Employee #${emp.id}`)),
        employeeCode: emp.employeeCode || `EMP-${emp.id}`,
        departmentName: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Sales Executive',
        assignedIds: new Set<number>(),
        workedIds: new Set<number>(),
        wonIds: new Set<number>(),
        lostIds: new Set<number>(),
        hotIds: new Set<number>(),
        stageLeadSets: new Map<string, Set<number>>(),
        transitionLeadSets: new Map<string, Set<number>>(),
        stageCounts,
        stageTransitionCounts,
      });
    }

    for (const lead of filteredLeads) {
      const st = this.resolveLeadStageKey(lead, idToStage);
      if (lead.employeeId || lead.assignedToId) assignedLeadIds.add(lead.id);
      if (st.key === 'NEW') newLeadIds.add(lead.id);
      if (isHot(st.key)) hotDealIds.add(lead.id);
      if (isFollowUp(st.key) || lead.nextFollowUpDate) followUpIds.add(lead.id);
      if (isVisitSched(st.key)) visitScheduledIds.add(lead.id);
      if (isVisitDone(st.key)) visitCompletedIds.add(lead.id);
      if (isWon(st.key)) wonLeadIds.add(lead.id);
      if (isLost(st.key)) lostLeadIds.add(lead.id);

      const empId = lead.employeeId ?? (lead.assignedToId ? userIdToEmployee.get(lead.assignedToId)?.id : undefined);
      if (empId && empStatsMap.has(empId)) {
        const row = empStatsMap.get(empId);
        row.assignedIds.add(lead.id);
        if (!row.stageLeadSets.has(st.key)) row.stageLeadSets.set(st.key, new Set<number>());
        row.stageLeadSets.get(st.key).add(lead.id);
        if (isHot(st.key)) row.hotIds.add(lead.id);
        if (isWon(st.key)) row.wonIds.add(lead.id);
        if (isLost(st.key)) row.lostIds.add(lead.id);
      }
    }

    // Track latest previous stage per lead from history
    const latestTransitionByLead = new Map<number, any>();
    for (const h of filteredHistory) {
      workedLeadIds.add(h.leadId);
      const toSt = this.resolveHistoryStageName(h.toStageId, h.toStatus, idToStage, byKey);
      if (!latestTransitionByLead.has(h.leadId)) {
        latestTransitionByLead.set(h.leadId, h);
      }

      const actorEmp = h.changedById ? userIdToEmployee.get(h.changedById) : undefined;
      const empId = actorEmp?.id ?? h.lead?.employeeId;
      if (empId && empStatsMap.has(empId)) {
        const row = empStatsMap.get(empId);
        row.workedIds.add(h.leadId);
        if (!row.transitionLeadSets.has(toSt.key)) row.transitionLeadSets.set(toSt.key, new Set<number>());
        row.transitionLeadSets.get(toSt.key).add(h.leadId);
      }
    }

    const totalAssigned = assignedLeadIds.size;
    const totalWon = wonLeadIds.size;
    const conversionRate = totalAssigned > 0 ? Number(((totalWon / totalAssigned) * 100).toFixed(1)) : 0;

    const employeeRows = Array.from(empStatsMap.values()).map((row) => {
      for (const s of stages) {
        row.stageCounts[s.key] = row.stageLeadSets.get(s.key)?.size || 0;
        row.stageTransitionCounts[s.key] = row.transitionLeadSets.get(s.key)?.size || 0;
      }
      const empAssigned = row.assignedIds.size;
      const empWon = row.wonIds.size;
      const empConv = empAssigned > 0 ? Number(((empWon / empAssigned) * 100).toFixed(1)) : 0;
      return {
        employeeId: row.employeeId,
        userId: row.userId,
        name: row.name,
        employeeCode: row.employeeCode,
        departmentName: row.departmentName,
        designation: row.designation,
        totalAssignedLeads: empAssigned,
        totalLeadsWorkedOn: row.workedIds.size,
        hotDeals: row.hotIds.size,
        wonLeads: empWon,
        lostLeads: row.lostIds.size,
        conversionRate: empConv,
        stageCounts: row.stageCounts,
        stageTransitionCounts: row.stageTransitionCounts,
      };
    });

    // Sort employees by totalAssignedLeads desc, then workedOn desc
    employeeRows.sort((a, b) => b.totalAssignedLeads - a.totalAssignedLeads || b.totalLeadsWorkedOn - a.totalLeadsWorkedOn);

    // Stage Distribution Chart
    const stageCountAgg = new Map<string, number>();
    for (const lead of filteredLeads) {
      const st = this.resolveLeadStageKey(lead, idToStage);
      stageCountAgg.set(st.key, (stageCountAgg.get(st.key) || 0) + 1);
    }
    const stageDistribution = stages.map((s) => ({
      stageKey: s.key,
      stageName: s.name,
      color: s.color,
      count: stageCountAgg.get(s.key) || 0,
    }));

    // Daily Activity Trend (IST date buckets)
    const dailyMap = new Map<string, { date: string; label: string; dayName: string; assigned: Set<number>; stageChanges: number; won: Set<number> }>();
    const ensureBucket = (dt: Date) => {
      const dateStr = getBusinessDate(dt);
      if (!dailyMap.has(dateStr)) {
        const wd = getIstWeekday(dt);
        dailyMap.set(dateStr, {
          date: dateStr,
          label: formatIstDate(dt),
          dayName: WEEKDAY_NAMES[wd],
          assigned: new Set<number>(),
          stageChanges: 0,
          won: new Set<number>(),
        });
      }
      return dailyMap.get(dateStr)!;
    };

    for (const lead of filteredLeads) {
      const b = ensureBucket(lead.createdAt);
      b.assigned.add(lead.id);
      const st = this.resolveLeadStageKey(lead, idToStage);
      if (isWon(st.key)) b.won.add(lead.id);
    }
    for (const h of filteredHistory) {
      const b = ensureBucket(h.createdAt);
      b.stageChanges += 1;
    }

    const dailyTrend = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({
        date: b.date,
        label: b.label,
        dayName: b.dayName,
        assigned: b.assigned.size,
        stageChanges: b.stageChanges,
        won: b.won.size,
      }));

    const stageHistory = filteredHistory.slice(0, 100).map((h) => {
      const fromSt = this.resolveHistoryStageName(h.fromStageId, h.fromStatus, idToStage, byKey);
      const toSt = this.resolveHistoryStageName(h.toStageId, h.toStatus, idToStage, byKey);
      const actorEmp = h.changedById ? userIdToEmployee.get(h.changedById) : undefined;
      const customerName = `${h.lead?.firstName || ''} ${h.lead?.lastName || ''}`.trim() || h.lead?.title || `Lead #${h.leadId}`;
      return {
        id: h.id,
        leadId: h.leadId,
        customerName,
        businessName: h.lead?.companyName || '—',
        previousStage: fromSt.name,
        previousStageKey: fromSt.key,
        newStage: toSt.name,
        newStageKey: toSt.key,
        employeeName: personDisplayName(actorEmp, personDisplayName(h.lead?.employee, personDisplayName(h.lead?.assignedTo, 'System'))),
        changedAt: h.createdAt,
        changedAtFormatted: formatIstDateTime(h.createdAt),
        notes: h.notes || '',
      };
    });

    return {
      success: true,
      data: {
        dateRange: {
          preset: range.preset,
          from: range.fromStr,
          to: range.toStr,
          dayOfWeek: query.dayOfWeek || 'ALL',
          timezone: 'Asia/Kolkata',
        },
        stages,
        departments,
        employees: employees.map((e) => ({
          id: e.id,
          name: personDisplayName(e, personDisplayName(e.user, `Employee #${e.id}`)),
          employeeCode: e.employeeCode,
          departmentId: e.departmentId,
          departmentName: e.department?.name || 'General',
        })),
        summary: {
          totalAssignedLeads: totalAssigned,
          newLeads: newLeadIds.size,
          totalLeadsWorkedOn: workedLeadIds.size,
          hotDeals: hotDealIds.size,
          followUpLeads: followUpIds.size,
          visitsScheduled: visitScheduledIds.size,
          visitsCompleted: visitCompletedIds.size,
          wonLeads: totalWon,
          lostLeads: lostLeadIds.size,
          conversionRate,
        },
        employeeRows,
        charts: {
          employeePerformance: employeeRows.slice(0, 12).map((r) => ({
            name: r.name,
            assigned: r.totalAssignedLeads,
            workedOn: r.totalLeadsWorkedOn,
            won: r.wonLeads,
            hotDeals: r.hotDeals,
          })),
          stageDistribution,
          dailyTrend,
          conversionRates: employeeRows.slice(0, 12).map((r) => ({
            name: r.name,
            conversionRate: r.conversionRate,
            won: r.wonLeads,
            total: r.totalAssignedLeads,
          })),
          hotVsWon: employeeRows.slice(0, 12).map((r) => ({
            name: r.name,
            hotDeals: r.hotDeals,
            wonLeads: r.wonLeads,
          })),
        },
        stageHistory,
      },
    };
  }

  async getDrilldown(customerId: number, query: EmployeeLeadStageQuery, user?: any) {
    const range = this.resolveIstDateRange(query.preset, query.dateFrom, query.dateTo);
    const dayFilter = query.dayOfWeek && query.dayOfWeek !== 'ALL' ? WEEKDAY_MAP[query.dayOfWeek.toUpperCase()] : undefined;
    const drillEmpId = query.drillEmployeeId ? Number(query.drillEmployeeId) : undefined;
    const drillStageKey = query.drillStageKey && query.drillStageKey !== 'ALL' ? normalizeKey(query.drillStageKey) : undefined;
    const mode = query.mode === 'transition' ? 'transition' : 'current';
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const search = String(query.search || '').trim().toLowerCase();

    const [{ idToStage, byKey }, { allEmployees }] = await Promise.all([
      this.getActiveStages(customerId),
      this.getEmployeesAndDepartments(customerId, user),
    ]);

    const userIdToEmployee = new Map<number, any>();
    for (const emp of allEmployees) {
      if (emp.userId) userIdToEmployee.set(emp.userId, emp);
    }

    const admin = isUserAdmin(user);
    const scopedEmpId = !admin ? (user?.employee?.id ?? user?.employeeId) : undefined;
    const effectiveEmpId = scopedEmpId ? Number(scopedEmpId) : drillEmpId;

    let rows: any[] = [];

    if (mode === 'transition') {
      const history = await this.prisma.leadStatusHistory.findMany({
        where: {
          lead: { customerId, deletedAt: null },
          createdAt: { gte: range.start, lte: range.end },
        },
        include: {
          lead: {
            include: { stage: true, employee: true, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const seenLeadIds = new Set<number>();
      for (const h of history) {
        if (dayFilter !== undefined && getIstWeekday(h.createdAt) !== dayFilter) continue;
        const actorEmp = h.changedById ? userIdToEmployee.get(h.changedById) : undefined;
        const empId = actorEmp?.id ?? h.lead?.employeeId;
        if (effectiveEmpId && empId !== effectiveEmpId) continue;

        const toSt = this.resolveHistoryStageName(h.toStageId, h.toStatus, idToStage, byKey);
        if (drillStageKey && toSt.key !== drillStageKey) continue;
        if (seenLeadIds.has(h.leadId)) continue;
        seenLeadIds.add(h.leadId);

        const fromSt = this.resolveHistoryStageName(h.fromStageId, h.fromStatus, idToStage, byKey);
        const curSt = this.resolveLeadStageKey(h.lead, idToStage);
        rows.push({
          leadId: h.leadId,
          customerName: `${h.lead?.firstName || ''} ${h.lead?.lastName || ''}`.trim() || h.lead?.title || `Lead #${h.leadId}`,
          businessName: h.lead?.companyName || '—',
          contactNumber: h.lead?.phone || '—',
          currentStage: curSt.name,
          currentStageKey: curSt.key,
          previousStage: fromSt.name,
          assignedEmployee: personDisplayName(actorEmp, personDisplayName(h.lead?.employee, personDisplayName(h.lead?.assignedTo, 'Unassigned'))),
          stageUpdatedAt: h.createdAt,
          stageUpdatedAtFormatted: formatIstDateTime(h.createdAt),
          followUpDate: h.lead?.nextFollowUpDate,
          followUpDateFormatted: formatIstDate(h.lead?.nextFollowUpDate),
          leadValue: Number(h.lead?.value || 0),
          isHotLead: curSt.key === 'HOT_LEAD' || curSt.key === 'HOT_DEAL',
        });
      }
    } else {
      const leads = await this.prisma.lead.findMany({
        where: {
          customerId,
          deletedAt: null,
          createdAt: { gte: range.start, lte: range.end },
        },
        include: {
          stage: true,
          employee: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          statusHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
      });

      for (const lead of leads) {
        if (dayFilter !== undefined && getIstWeekday(lead.createdAt) !== dayFilter) continue;
        const empId = lead.employeeId ?? (lead.assignedToId ? userIdToEmployee.get(lead.assignedToId)?.id : undefined);
        if (effectiveEmpId && empId !== effectiveEmpId) continue;

        const curSt = this.resolveLeadStageKey(lead, idToStage);
        if (drillStageKey && curSt.key !== drillStageKey) continue;

        const lastHist = lead.statusHistory?.[0];
        const prevSt = lastHist
          ? this.resolveHistoryStageName(lastHist.fromStageId, lastHist.fromStatus, idToStage, byKey)
          : { name: '—' };

        rows.push({
          leadId: lead.id,
          customerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || `Lead #${lead.id}`,
          businessName: lead.companyName || '—',
          contactNumber: lead.phone || '—',
          currentStage: curSt.name,
          currentStageKey: curSt.key,
          previousStage: prevSt.name,
          assignedEmployee: personDisplayName(lead.employee, personDisplayName(lead.assignedTo, 'Unassigned')),
          stageUpdatedAt: lastHist?.createdAt || lead.updatedAt,
          stageUpdatedAtFormatted: formatIstDateTime(lastHist?.createdAt || lead.updatedAt),
          followUpDate: lead.nextFollowUpDate,
          followUpDateFormatted: formatIstDate(lead.nextFollowUpDate),
          leadValue: Number(lead.value || 0),
          isHotLead: curSt.key === 'HOT_LEAD' || curSt.key === 'HOT_DEAL',
        });
      }
    }

    if (search) {
      rows = rows.filter((r) =>
        `${r.customerName} ${r.businessName} ${r.contactNumber} ${r.assignedEmployee} ${r.currentStage}`
          .toLowerCase()
          .includes(search),
      );
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = rows.slice((page - 1) * limit, page * limit);

    return {
      success: true,
      data: {
        rows: paged,
        pagination: { page, limit, total, totalPages },
      },
    };
  }

  private sanitizePdfText(input: any): string {
    return String(input ?? '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '-';
  }

  private getLogoBuffer(): Buffer | null {
    const candidates = [
      path.resolve(__dirname, '../../assets/logo.png'),
      path.resolve(process.cwd(), 'dist/src/assets/logo.png'),
      path.resolve(process.cwd(), 'src/assets/logo.png'),
      path.resolve(process.cwd(), 'uploads/logo.png'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return fs.readFileSync(p);
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  private async getAllDetailedLeadRecords(
    customerId: number,
    query: EmployeeLeadStageQuery,
    user?: any,
  ) {
    const range = this.resolveIstDateRange(query.preset, query.dateFrom, query.dateTo);
    const dayFilter = query.dayOfWeek && query.dayOfWeek !== 'ALL' ? WEEKDAY_MAP[query.dayOfWeek.toUpperCase()] : undefined;
    const deptFilter = query.departmentId && query.departmentId !== 'ALL' ? Number(query.departmentId) : undefined;
    const stageFilter = query.stageKey && query.stageKey !== 'ALL' ? normalizeKey(query.stageKey) : undefined;
    const exportEmpId = query.exportEmployeeId ? Number(query.exportEmployeeId) : undefined;
    const selectedEmpIds = exportEmpId
      ? [exportEmpId]
      : String(query.employeeIds || '')
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);

    const [{ idToStage, byKey }, { employees, allEmployees }] = await Promise.all([
      this.getActiveStages(customerId),
      this.getEmployeesAndDepartments(customerId, user),
    ]);

    let targetEmployees = employees;
    if (deptFilter) targetEmployees = targetEmployees.filter((e) => e.departmentId === deptFilter);
    if (selectedEmpIds.length > 0) {
      const set = new Set(selectedEmpIds);
      targetEmployees = targetEmployees.filter((e) => set.has(e.id));
    }

    const targetEmpIds = new Set(targetEmployees.map((e) => e.id));
    const userIdToEmployee = new Map<number, any>();
    for (const emp of allEmployees) {
      if (emp.userId) userIdToEmployee.set(emp.userId, emp);
    }
    const targetUserIds = new Set(targetEmployees.map((e) => e.userId).filter((id): id is number => Boolean(id)));
    const admin = isUserAdmin(user);

    const matchesEmp = (empId?: number | null, userId?: number | null) => {
      if (!admin || selectedEmpIds.length > 0 || deptFilter) {
        return Boolean((empId && targetEmpIds.has(empId)) || (userId && targetUserIds.has(userId)));
      }
      return true;
    };

    const records: any[] = [];
    const seenLeadIds = new Set<number>();

    if (query.mode === 'transition') {
      const history = await this.prisma.leadStatusHistory.findMany({
        where: {
          lead: { customerId, deletedAt: null },
          createdAt: { gte: range.start, lte: range.end },
        },
        include: {
          lead: {
            include: {
              stage: true,
              employee: true,
              assignedTo: { select: { id: true, firstName: true, lastName: true } },
              visits: { orderBy: { date: 'desc' }, take: 1 },
              notes: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      for (const h of history) {
        if (dayFilter !== undefined && getIstWeekday(h.createdAt) !== dayFilter) continue;
        const actorEmp = h.changedById ? userIdToEmployee.get(h.changedById) : undefined;
        const empId = actorEmp?.id ?? h.lead?.employeeId;
        if (!matchesEmp(empId, h.changedById ?? h.lead?.assignedToId)) continue;
        const toSt = this.resolveHistoryStageName(h.toStageId, h.toStatus, idToStage, byKey);
        if (stageFilter && toSt.key !== stageFilter) continue;
        if (seenLeadIds.has(h.leadId)) continue;
        seenLeadIds.add(h.leadId);

        const fromSt = this.resolveHistoryStageName(h.fromStageId, h.fromStatus, idToStage, byKey);
        const curSt = this.resolveLeadStageKey(h.lead, idToStage);
        const empName = personDisplayName(actorEmp, personDisplayName(h.lead?.employee, personDisplayName(h.lead?.assignedTo, 'Unassigned')));
        records.push({
          leadId: h.leadId,
          employeeId: empId || 0,
          assignedEmployee: empName,
          customerName: `${h.lead?.firstName || ''} ${h.lead?.lastName || ''}`.trim() || h.lead?.title || `Lead #${h.leadId}`,
          businessName: h.lead?.companyName || '—',
          mobileNumber: h.lead?.phone || '—',
          emailAddress: h.lead?.email || '—',
          leadSource: h.lead?.source || '—',
          currentStage: curSt.name,
          currentStageKey: curSt.key,
          previousStage: fromSt.name,
          leadAssignedDate: formatIstDate(h.lead?.createdAt),
          stageUpdatedAtFormatted: formatIstDateTime(h.createdAt),
          followUpDateFormatted: formatIstDate(h.lead?.nextFollowUpDate),
          visitDateFormatted: formatIstDate(h.lead?.visits?.[0]?.date),
          leadValue: Number(h.lead?.value || 0),
          latestRemarks: h.notes || h.lead?.notes?.[0]?.content || h.lead?.workNotes || '—',
        });
      }
    } else {
      const leads = await this.prisma.lead.findMany({
        where: {
          customerId,
          deletedAt: null,
          createdAt: { gte: range.start, lte: range.end },
        },
        include: {
          stage: true,
          employee: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          statusHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
          visits: { orderBy: { date: 'desc' }, take: 1 },
          notes: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ employeeId: 'asc' }, { updatedAt: 'desc' }],
      });

      for (const lead of leads) {
        if (dayFilter !== undefined && getIstWeekday(lead.createdAt) !== dayFilter) continue;
        const empId = lead.employeeId ?? (lead.assignedToId ? userIdToEmployee.get(lead.assignedToId)?.id : undefined);
        if (!matchesEmp(empId, lead.assignedToId)) continue;
        const curSt = this.resolveLeadStageKey(lead, idToStage);
        if (stageFilter && curSt.key !== stageFilter) continue;
        if (seenLeadIds.has(lead.id)) continue;
        seenLeadIds.add(lead.id);

        const lastHist = lead.statusHistory?.[0];
        const prevSt = lastHist
          ? this.resolveHistoryStageName(lastHist.fromStageId, lastHist.fromStatus, idToStage, byKey)
          : { name: '—' };

        records.push({
          leadId: lead.id,
          employeeId: empId || 0,
          assignedEmployee: personDisplayName(lead.employee, personDisplayName(lead.assignedTo, 'Unassigned')),
          customerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || `Lead #${lead.id}`,
          businessName: lead.companyName || '—',
          mobileNumber: lead.phone || '—',
          emailAddress: lead.email || '—',
          leadSource: lead.source || '—',
          currentStage: curSt.name,
          currentStageKey: curSt.key,
          previousStage: prevSt.name,
          leadAssignedDate: formatIstDate(lead.createdAt),
          stageUpdatedAtFormatted: formatIstDateTime(lastHist?.createdAt || lead.updatedAt),
          followUpDateFormatted: formatIstDate(lead.nextFollowUpDate),
          visitDateFormatted: formatIstDate(lead.visits?.[0]?.date),
          leadValue: Number(lead.value || 0),
          latestRemarks: lead.notes?.[0]?.content || lastHist?.notes || lead.workNotes || '—',
        });
      }
    }

    return records;
  }

  async exportReport(
    customerId: number,
    query: EmployeeLeadStageQuery & { format?: 'pdf' | 'excel' | 'csv' },
    user?: any,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const format = (query.format || 'pdf').toLowerCase();
    const scope: ExportScope = query.exportScope || (query.exportEmployeeId ? 'individual' : 'all_complete');
    const scopedQuery: EmployeeLeadStageQuery = {
      ...query,
      ...(query.exportEmployeeId ? { employeeIds: String(query.exportEmployeeId) } : {}),
    };

    const [reportRes, allLeads] = await Promise.all([
      this.getReport(customerId, scopedQuery, user),
      this.getAllDetailedLeadRecords(customerId, scopedQuery, user),
    ]);

    const report = reportRes.data;
    const fileDate = report.dateRange.to || getBusinessDate(new Date());
    const scopeSlug = scope === 'individual' && report.employeeRows[0]
      ? `Employee_${report.employeeRows[0].name.replace(/[^a-zA-Z0-9]+/g, '_')}`
      : scope;

    const leadColumns = [
      'Lead ID', 'Customer Name', 'Business Name', 'Mobile Number', 'Email Address',
      'Lead Source', 'Current Stage', 'Previous Stage', 'Lead Assigned Date',
      'Stage Updated Date & Time', 'Follow-Up Date', 'Visit Date', 'Lead Value', 'Latest Remarks',
    ];
    const leadRowValues = (l: any) => [
      l.leadId, l.customerName, l.businessName, l.mobileNumber, l.emailAddress,
      l.leadSource, l.currentStage, l.previousStage, l.leadAssignedDate,
      l.stageUpdatedAtFormatted, l.followUpDateFormatted, l.visitDateFormatted, l.leadValue, l.latestRemarks,
    ];

    if (format === 'csv') {
      const esc = (v: any) => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const lines: string[] = [];
      lines.push(['QuikBoom Employee-Wise Lead & Stage Report', `Scope: ${scope}`, `Period (IST): ${report.dateRange.from} to ${report.dateRange.to}`].map(esc).join(','));
      lines.push('');

      if (scope !== 'stage_wise') {
        lines.push(['Employee', 'Department', 'Assigned Leads', 'Worked On', 'Hot Deals', 'Won', 'Lost', 'Conversion %', ...report.stages.map((s) => s.name)].map(esc).join(','));
        for (const r of report.employeeRows) {
          lines.push([
            r.name, r.departmentName, r.totalAssignedLeads, r.totalLeadsWorkedOn,
            r.hotDeals, r.wonLeads, r.lostLeads, `${r.conversionRate}%`,
            ...report.stages.map((s) => r.stageCounts[s.key] || 0),
          ].map(esc).join(','));
        }
        lines.push('');
      }

      if (scope === 'stage_wise') {
        lines.push(['Stage', 'Lead Count'].map(esc).join(','));
        for (const s of report.charts.stageDistribution || []) {
          lines.push([s.stageName, s.count].map(esc).join(','));
        }
        lines.push('');
      }

      if (scope !== 'summary_only') {
        lines.push(['Assigned Employee', ...leadColumns].map(esc).join(','));
        for (const l of allLeads) {
          lines.push([l.assignedEmployee, ...leadRowValues(l)].map(esc).join(','));
        }
      }

      return {
        buffer: Buffer.from('\uFEFF' + lines.join('\n'), 'utf8'),
        filename: `QuikBoom_Lead_Report_${scopeSlug}_${fileDate}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    if (format === 'excel' || format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'QuikBoom CRM';
      wb.created = new Date();

      const styleHeader = (row: ExcelJS.Row) => {
        row.height = 22;
        row.eachCell((c) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163A2E' } };
          c.alignment = { vertical: 'middle', horizontal: 'left' };
        });
      };

      // 1. Overall Summary
      const overall = wb.addWorksheet('Overall Summary');
      overall.columns = [{ header: 'Metric', key: 'm', width: 32 }, { header: 'Value', key: 'v', width: 38 }];
      styleHeader(overall.getRow(1));
      overall.addRow({ m: 'Report Scope', v: scope });
      overall.addRow({ m: 'Date Range (IST)', v: `${report.dateRange.from} to ${report.dateRange.to}` });
      overall.addRow({ m: 'Day Filter', v: report.dateRange.dayOfWeek });
      overall.addRow({ m: 'Total Assigned Leads', v: report.summary.totalAssignedLeads });
      overall.addRow({ m: 'New Leads', v: report.summary.newLeads });
      overall.addRow({ m: 'Total Leads Worked On', v: report.summary.totalLeadsWorkedOn });
      overall.addRow({ m: 'Hot Deals', v: report.summary.hotDeals });
      overall.addRow({ m: 'Follow-Up Leads', v: report.summary.followUpLeads });
      overall.addRow({ m: 'Visits Scheduled', v: report.summary.visitsScheduled });
      overall.addRow({ m: 'Visits Completed', v: report.summary.visitsCompleted });
      overall.addRow({ m: 'Won Leads', v: report.summary.wonLeads });
      overall.addRow({ m: 'Lost Leads', v: report.summary.lostLeads });
      overall.addRow({ m: 'Conversion Rate (%)', v: report.summary.conversionRate });

      // 2. Employee-Wise Summary
      const empSummary = wb.addWorksheet('Employee-Wise Summary');
      const empHeaders = ['Employee', 'Department', 'Assigned Leads', 'Worked On', 'Hot Deals', 'Won', 'Lost', 'Conversion %', ...report.stages.map((s) => s.name)];
      styleHeader(empSummary.addRow(empHeaders));
      empSummary.views = [{ state: 'frozen', ySplit: 1 }];
      for (const r of report.employeeRows) {
        empSummary.addRow([
          r.name, r.departmentName, r.totalAssignedLeads, r.totalLeadsWorkedOn,
          r.hotDeals, r.wonLeads, r.lostLeads, r.conversionRate,
          ...report.stages.map((s) => r.stageCounts[s.key] || 0),
        ]);
      }
      empHeaders.forEach((_, i) => { empSummary.getColumn(i + 1).width = i < 2 ? 24 : 15; });

      // 3. Stage-Wise Breakdown
      const stageSheet = wb.addWorksheet('Stage-Wise Breakdown');
      styleHeader(stageSheet.addRow(['Stage Name', 'Stage Key', 'Lead Count', 'Total Lead Value (INR)']));
      for (const s of report.charts.stageDistribution || []) {
        const stageVal = allLeads.filter((l) => l.currentStageKey === s.stageKey).reduce((sum, l) => sum + Number(l.leadValue || 0), 0);
        stageSheet.addRow([s.stageName, s.stageKey, s.count, stageVal]);
      }
      [26, 20, 14, 22].forEach((w, i) => { stageSheet.getColumn(i + 1).width = w; });

      // 4. All Lead Records
      if (scope !== 'summary_only') {
        const allSheet = wb.addWorksheet('All Lead Records');
        styleHeader(allSheet.addRow(['Assigned Employee', ...leadColumns]));
        allSheet.views = [{ state: 'frozen', ySplit: 1 }];
        allSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, allLeads.length + 1), column: leadColumns.length + 1 } };
        for (const l of allLeads) {
          allSheet.addRow([l.assignedEmployee, ...leadRowValues(l)]);
        }
        for (let i = 1; i <= leadColumns.length + 1; i++) {
          allSheet.getColumn(i).width = i === 1 || i === 3 || i === 4 || i === 15 ? 24 : 16;
        }
      }

      // 5. Individual Employee Sheets (for all_complete, detailed, individual)
      if (scope === 'all_complete' || scope === 'detailed' || scope === 'individual') {
        const usedNames = new Set<string>(['Overall Summary', 'Employee-Wise Summary', 'Stage-Wise Breakdown', 'All Lead Records']);
        for (const emp of report.employeeRows) {
          const empLeads = allLeads.filter((l) => l.employeeId === emp.employeeId);
          if (scope !== 'individual' && empLeads.length === 0 && emp.totalAssignedLeads === 0) continue;
          let baseName = emp.name.replace(/[\\/*?:[\]]/g, '').trim().slice(0, 26) || `Emp_${emp.employeeId}`;
          let sheetName = baseName;
          let n = 1;
          while (usedNames.has(sheetName)) {
            sheetName = `${baseName.slice(0, 24)}_${n++}`;
          }
          usedNames.add(sheetName);

          const ws = wb.addWorksheet(sheetName);
          ws.addRow([`Employee: ${emp.name} (${emp.employeeCode})`, `Department: ${emp.departmentName}`]);
          ws.addRow([`Assigned: ${emp.totalAssignedLeads}`, `Worked On: ${emp.totalLeadsWorkedOn}`, `Hot Deals: ${emp.hotDeals}`, `Won: ${emp.wonLeads}`, `Lost: ${emp.lostLeads}`, `Conversion: ${emp.conversionRate}%`]);
          ws.addRow([]);
          styleHeader(ws.addRow(leadColumns));
          ws.views = [{ state: 'frozen', ySplit: 4 }];
          for (const l of empLeads) {
            ws.addRow(leadRowValues(l));
          }
          for (let i = 1; i <= leadColumns.length; i++) {
            ws.getColumn(i).width = i === 2 || i === 3 || i === 14 ? 24 : 15;
          }
        }
      }

      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      return {
        buffer: buf,
        filename: `QuikBoom_Lead_Report_${scopeSlug}_${fileDate}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    // Default: Branded Landscape PDF with Employee-Wise Summary + Detailed Lead Tables
    const logo = this.getLogoBuffer();
    const pdfBuf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 28, size: 'A4', layout: 'landscape', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const margin = 28;
      const bottomLimit = pageH - 40;
      const contentW = pageW - margin * 2;

      doc.rect(0, 0, pageW, 74).fill('#163A2E');
      doc.rect(0, 74, pageW, 3.5).fill('#20C466');

      let titleX = margin;
      if (logo) {
        try {
          doc.roundedRect(margin, 14, 46, 46, 8).fill('#FFFFFF');
          doc.image(logo, margin + 4, 18, { fit: [38, 38], align: 'center', valign: 'center' });
          titleX = margin + 58;
        } catch {
          /* ignore */
        }
      }

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#FFFFFF').text('Employee-Wise Lead & Stage Report', titleX, 18);
      doc.font('Helvetica').fontSize(9).fillColor('#CBD5E1').text(
        `Period: ${report.dateRange.from} to ${report.dateRange.to} (Asia/Kolkata)  |  Day: ${report.dateRange.dayOfWeek}  |  Mode: ${scope.replace('_', ' ').toUpperCase()}`,
        titleX,
        42,
      );

      let y = 90;
      const kpis = [
        ['Assigned', report.summary.totalAssignedLeads],
        ['Worked On', report.summary.totalLeadsWorkedOn],
        ['Hot Deals', report.summary.hotDeals],
        ['Follow-Ups', report.summary.followUpLeads],
        ['Won', report.summary.wonLeads],
        ['Conversion', `${report.summary.conversionRate}%`],
      ];
      const boxW = (contentW - 25) / 6;
      kpis.forEach(([label, val], idx) => {
        const x = margin + idx * (boxW + 5);
        doc.roundedRect(x, y, boxW, 40, 6).fillAndStroke('#F0F7F4', '#CBE5D6');
        doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(String(label), x + 8, y + 7, { width: boxW - 16 });
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#163A2E').text(String(val), x + 8, y + 19, { width: boxW - 16 });
      });
      y += 52;

      const pdfCols = [
        { key: 'leadId', label: 'ID', w: 34 },
        { key: 'customerName', label: 'Customer', w: 74 },
        { key: 'businessName', label: 'Business', w: 88 },
        { key: 'mobileNumber', label: 'Mobile', w: 66 },
        { key: 'leadSource', label: 'Source', w: 58 },
        { key: 'currentStage', label: 'Current Stage', w: 68 },
        { key: 'previousStage', label: 'Prev Stage', w: 62 },
        { key: 'leadAssignedDate', label: 'Assigned', w: 56 },
        { key: 'stageUpdatedAtFormatted', label: 'Updated (IST)', w: 78 },
        { key: 'followUpDateFormatted', label: 'Follow-Up', w: 56 },
        { key: 'visitDateFormatted', label: 'Visit Date', w: 54 },
        { key: 'leadValue', label: 'Value', w: 46 },
        { key: 'latestRemarks', label: 'Remarks', w: contentW - 740 },
      ];

      const drawLeadTableHeader = (topY: number) => {
        doc.rect(margin, topY, contentW, 20).fill('#163A2E');
        let cx = margin;
        for (const c of pdfCols) {
          doc.save();
          doc.rect(cx, topY, c.w, 20).clip();
          doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF').text(c.label, cx + 3, topY + 6, { width: c.w - 6, lineBreak: false, ellipsis: true });
          doc.restore();
          cx += c.w;
        }
        return topY + 20;
      };

      const drawLeadRows = (leadsSubset: any[], startY: number): number => {
        let curY = drawLeadTableHeader(startY);
        leadsSubset.forEach((l, idx) => {
          const textHeights = pdfCols.map((c) => {
            const rawVal = c.key === 'leadValue' ? `INR ${Number(l[c.key] || 0).toLocaleString('en-IN')}` : l[c.key];
            return doc.font('Helvetica').fontSize(6.8).heightOfString(this.sanitizePdfText(rawVal), { width: Math.max(12, c.w - 6) });
          });
          const rowH = Math.max(18, Math.min(44, Math.ceil(Math.max(...textHeights)) + 8));

          if (curY + rowH > bottomLimit) {
            doc.addPage();
            curY = drawLeadTableHeader(margin);
          }
          doc.rect(margin, curY, contentW, rowH).fillAndStroke(idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF', '#E2E8E5');
          let cx = margin;
          for (const c of pdfCols) {
            const rawVal = c.key === 'leadValue' ? `INR ${Number(l[c.key] || 0).toLocaleString('en-IN')}` : l[c.key];
            const txt = this.sanitizePdfText(rawVal);
            doc.save();
            doc.rect(cx, curY, c.w, rowH).clip();
            doc.font('Helvetica').fontSize(6.8).fillColor('#0F172A').text(txt, cx + 3, curY + 4, { width: Math.max(12, c.w - 6), height: rowH - 6, ellipsis: true });
            doc.restore();
            cx += c.w;
          }
          curY += rowH;
          doc.y = curY;
        });
        return curY + 8;
      };

      if (scope === 'summary_only') {
        const stageCols = report.stages.slice(0, 6);
        const colWidths = [130, 80, 55, 55, 50, 55, ...stageCols.map(() => Math.floor((contentW - 425) / Math.max(1, stageCols.length)))];
        const headers = ['Employee', 'Department', 'Assigned', 'Worked', 'Won', 'Conv %', ...stageCols.map((s) => s.name)];
        const drawSummaryHeader = (topY: number) => {
          doc.rect(margin, topY, contentW, 20).fill('#163A2E');
          let cx = margin + 4;
          headers.forEach((h, i) => {
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF').text(this.sanitizePdfText(h), cx, topY + 6, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true });
            cx += colWidths[i];
          });
          return topY + 20;
        };
        y = drawSummaryHeader(y);
        report.employeeRows.forEach((r, idx) => {
          if (y + 18 > bottomLimit) { doc.addPage(); y = drawSummaryHeader(margin); }
          if (idx % 2 === 1) doc.rect(margin, y, contentW, 18).fill('#F8FAFC');
          const vals = [r.name, r.departmentName, r.totalAssignedLeads, r.totalLeadsWorkedOn, r.wonLeads, `${r.conversionRate}%`, ...stageCols.map((s) => r.stageCounts[s.key] || 0)];
          let rx = margin + 4;
          vals.forEach((v, i) => {
            doc.font('Helvetica').fontSize(7.5).fillColor('#0F172A').text(this.sanitizePdfText(v), rx, y + 5, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true });
            rx += colWidths[i];
          });
          y += 18;
          doc.y = y;
        });
      } else if (scope === 'stage_wise') {
        for (const st of report.stages) {
          const stLeads = allLeads.filter((l) => l.currentStageKey === st.key);
          if (!stLeads.length) continue;
          // Keep stage heading + table header + at least first row together
          if (y + 68 > bottomLimit) { doc.addPage(); y = margin; }
          doc.roundedRect(margin, y, contentW, 22, 5).fillAndStroke('#F0F7F4', '#CBE5D6');
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#163A2E').text(`${this.sanitizePdfText(st.name)}  (${stLeads.length} Leads)`, margin + 10, y + 6, { lineBreak: false });
          y += 26;
          y = drawLeadRows(stLeads, y);
        }
      } else {
        // all_complete, detailed, individual: Group by Employee with Summary + Detailed Table
        for (const emp of report.employeeRows) {
          const empLeads = allLeads.filter((l) => l.employeeId === emp.employeeId);
          if (scope !== 'individual' && empLeads.length === 0 && emp.totalAssignedLeads === 0) continue;
          const neededHeight = empLeads.length > 0 ? 74 : 46;
          if (y + neededHeight > bottomLimit) { doc.addPage(); y = margin; }

          doc.roundedRect(margin, y, contentW, 30, 6).fillAndStroke('#F0F7F4', '#CBE5D6');
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#163A2E').text(
            `${this.sanitizePdfText(emp.name)} (${this.sanitizePdfText(emp.departmentName)})`,
            margin + 10,
            y + 5,
            { lineBreak: false },
          );
          doc.font('Helvetica').fontSize(8).fillColor('#334155').text(
            `Assigned: ${emp.totalAssignedLeads}  |  Worked On: ${emp.totalLeadsWorkedOn}  |  Hot Deals: ${emp.hotDeals}  |  Won: ${emp.wonLeads}  |  Lost: ${emp.lostLeads}  |  Conversion: ${emp.conversionRate}%`,
            margin + 10,
            y + 17,
            { lineBreak: false },
          );
          y += 34;
          doc.y = y;

          if (empLeads.length > 0) {
            y = drawLeadRows(empLeads, y);
          } else {
            doc.font('Helvetica').fontSize(8).fillColor('#64748B').text('No detailed lead records match the selected filters.', margin + 8, y + 2, { lineBreak: false });
            y += 18;
            doc.y = y;
          }
        }
      }

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(
          `Generated by QuikBoom CRM (Asia/Kolkata)   |   Page ${i + 1} of ${range.count}`,
          margin,
          pageH - 22,
          { align: 'right', width: contentW, lineBreak: false },
        );
      }
      doc.end();
    });

    return {
      buffer: pdfBuf,
      filename: `QuikBoom_Lead_Report_${scopeSlug}_${fileDate}.pdf`,
      contentType: 'application/pdf',
    };
  }
}
