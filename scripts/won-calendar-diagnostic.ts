/** Explicit-ID diagnostic. Never instantiate Nest or application services. */
import 'dotenv/config';
import { PrismaClient, WorkType, WorkStatus } from '@prisma/client';
import { workTypesForDesignation, workMatchesDesignation } from '../src/modules/work/calendar-query.util';
// Only constants and a pure function are used; no service is instantiated.
import { DEFAULT_ROLE_WORK_MAPPINGS, WORK_MODULE_TO_ACTIVITY_TYPES, normalizeActivityType } from '../src/modules/work/work-permission.service';
import { isUserAdmin, isUserSuperAdmin } from '../src/common/utils/role.util';

export function parseArgs(args: string[]) {
  const permitted = ['lead', 'customer', 'subscription', 'employee', 'team', 'tenant', 'working-customer', 'from', 'to', 'mode', 'status', 'work-type'];
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !permitted.includes(key) || values[key] || !args[i + 1]) throw new Error('Invalid or duplicate argument');
    values[key] = args[i + 1];
  }
  for (const key of permitted.slice(0, 7)) {
    if (!/^[1-9]\d*$/.test(values[key] || '') || !Number.isSafeInteger(Number(values[key]))) throw new Error(`Required positive ID: --${key}`);
  }
  for (const key of ['from', 'to']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values[key] || '') || new Date(values[key]).toISOString().slice(0, 10) !== values[key]) throw new Error(`Required valid date: --${key}`);
  }
  if (values.from > values.to) throw new Error('Date range is reversed');
  if (!['calendar', 'assigned'].includes(values.mode)) throw new Error('Required --mode calendar|assigned (actual authenticated route mode)');
  if (values.customer === values['working-customer']) throw new Error('Comparison requires a different working customer');
  if (values['work-type'] && !Object.values(WorkType).includes(values['work-type'] as WorkType)) throw new Error('Invalid WorkType');
  if (values.status && !['PENDING', 'BLOCKED', ...Object.values(WorkStatus)].includes(values.status)) throw new Error('Invalid status');
  return values;
}

function defaults(role: string): string[] {
  const upper = role.toUpperCase().replace(/\s+/g, '_');
  if (DEFAULT_ROLE_WORK_MAPPINGS[role] || DEFAULT_ROLE_WORK_MAPPINGS[upper]) return DEFAULT_ROLE_WORK_MAPPINGS[role] || DEFAULT_ROLE_WORK_MAPPINGS[upper];
  const lower = role.toLowerCase();
  if (/telecall|telesales|sales|lead|bpo/.test(lower)) return ['leads', 'data_capture'];
  if (/video edit|editor/.test(lower)) return ['video_edit'];
  if (/graphic|designer/.test(lower)) return ['post_design', 'story_design'];
  if (/photo|shoot|videograph/.test(lower)) return ['reel_shoot'];
  if (/social|smm/.test(lower)) return ['reel_post', 'story_post', 'post_publish'];
  if (/influencer/.test(lower)) return ['influencer_promo'];
  if (/admin/.test(lower)) return ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'];
  return [];
}

export function dateKey(date: Date | null): string | null {
  return date ? new Date(date.getTime() + 19800000).toISOString().slice(0, 10) : null;
}

export function statusPass(status: string, requested?: string) {
  const groups = { PENDING: ['SCHEDULED', 'ASSIGNED'], IN_PROGRESS: ['IN_PROGRESS', 'PROCESSING'], COMPLETED: ['COMPLETED', 'APPROVED'] };
  return requested ? (groups[requested] || [requested]).includes(status) : status !== 'CANCELLED';
}

export async function diagnose(tx: any, args: Record<string, string>) {
  const id = (key: string) => Number(args[key]);
  const customerSelect = {
    id: true, leadId: true, source: true, deletedAt: true, isActive: true,
    assignedTeamId: true, assignedEmployeeId: true, createdByEmployeeId: true,
    originLead: { select: { id: true, customerId: true, status: true, deletedAt: true, employeeId: true, assignedToId: true, convertedByEmployeeId: true } },
    assignedEmployeeRel: { select: { customerId: true } }, createdByEmployeeRel: { select: { customerId: true } },
    assignedTeam: { select: { id: true, customerId: true, isActive: true, leaderId: true, members: { select: { employeeId: true } } } },
    leads: { where: { customerId: id('tenant'), deletedAt: null }, select: { id: true, customerId: true } },
  };
  const [lead, customer, working, subscription, employee, team] = await Promise.all([
    tx.lead.findUnique({ where: { id: id('lead') }, select: { id: true, status: true, customerId: true, deletedAt: true, convertedCustomer: { select: { id: true } } } }),
    tx.customer.findUnique({ where: { id: id('customer') }, select: customerSelect }),
    tx.customer.findUnique({ where: { id: id('working-customer') }, select: customerSelect }),
    tx.customerSubscription.findUnique({ where: { id: id('subscription') }, select: { id: true, customerId: true, planId: true, status: true, deletedAt: true, startDate: true, endDate: true } }),
    tx.employee.findUnique({ where: { id: id('employee') }, select: {
      id: true, userId: true, customerId: true, status: true, designation: { select: { name: true } },
      user: { select: { userRoles: { select: { role: { select: { name: true, type: true } } } } } },
      employeeModuleOverrides: { select: { customerId: true, moduleKey: true, override: true } },
      teamMembers: { select: { teamId: true } },
    } }),
    tx.team.findUnique({ where: { id: id('team') }, select: { id: true, customerId: true, isActive: true, leaderId: true, members: { select: { employeeId: true } } } }),
  ]);
  const missing = Object.entries({ lead, customer, working, subscription, employee, team }).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) return { blocked: true, missing, reason: 'Explicit records missing; no substitute records selected.' };
  const tenantEvidence = (c: any) => ({
    self: c.id, originLead: c.originLead?.customerId ?? null, assignedTeam: c.assignedTeam?.customerId ?? null,
    assignedStaff: c.assignedEmployeeRel?.customerId ?? null, createdStaff: c.createdByEmployeeRel?.customerId ?? null,
    hasTenantLead: c.leads.length > 0,
  });
  const tenantMatches = (c: any) => c.id === id('tenant') || [c.originLead?.customerId, c.assignedTeam?.customerId, c.assignedEmployeeRel?.customerId, c.createdByEmployeeRel?.customerId].includes(id('tenant')) || c.leads.length > 0;
  if (lead.customerId !== id('tenant') || employee.customerId !== id('tenant') || team.customerId !== id('tenant') || !tenantMatches(customer) || !tenantMatches(working)) {
    return { blocked: true, reason: 'Explicit records do not share the requested tenant evidence. No activity records read.' };
  }
  const assignedOnly = args.mode === 'assigned';
  const viewerIds = assignedOnly || !employee.userId ? [employee.id] : [...new Set([employee.id, employee.userId])];
  const role = (isUserAdmin(employee.user) || isUserSuperAdmin(employee.user)) ? 'SUPER_ADMIN' : (employee.designation?.name || employee.user?.userRoles[0]?.role.name || 'Employee').trim();
  const [rolePermissions, requests, memberTeams, ledTeams] = await Promise.all([
    tx.roleWorkPermission.findMany({ where: { customerId: employee.customerId, roleName: role }, select: { workModule: true, isEnabled: true } }),
    tx.workAccessRequest.findMany({ where: { customerId: employee.customerId, employeeId: employee.id, status: 'APPROVED' }, select: { workModule: true } }),
    tx.teamMember.findMany({ where: { employeeId: { in: viewerIds }, team: { isActive: true, customerId: employee.customerId } }, select: { teamId: true } }),
    tx.team.findMany({ where: { leaderId: { in: viewerIds }, isActive: true, customerId: employee.customerId }, select: { id: true } }),
  ]);
  const modules = new Set<string>(rolePermissions.length ? rolePermissions.filter((p: any) => p.isEnabled).map((p: any) => p.workModule) : defaults(role));
  requests.forEach((r: any) => modules.add(r.workModule));
  employee.employeeModuleOverrides.forEach((o: any) => { if (o.override === 'ALLOW') modules.add(o.moduleKey); if (o.override === 'DENY') modules.delete(o.moduleKey); });
  const managerPattern = /PRODUCTION[ _]MANAGER|PROD[ _]MGR|PRODUCTION[ _]LEAD/;
  const manager = managerPattern.test(role.toUpperCase()) || managerPattern.test((employee.designation?.name || '').toUpperCase());
  const full = managerPattern.test(role.toUpperCase()) || /ADMIN|SUPER|DIRECTOR|OWNER/.test(role.toUpperCase()) || (role.toUpperCase().includes('MANAGER') && !role.toUpperCase().includes('SOCIAL'));
  const allowedTypes = new Set<string>(full ? ['REEL_SHOOT', 'REEL_EDIT', 'REEL_POST', 'STORY_DESIGN', 'STORY_POST', 'POST_DESIGN', 'INFLUENCER_PROMO', 'VIDEO_EDITING', 'SHOOT', 'UPLOADING', 'GRAPHIC_DESIGN'] : [...modules].flatMap(m => WORK_MODULE_TO_ACTIVITY_TYPES[m] || []));
  const enumTypes = new Set<string>(Object.values(WorkType));
  const visibleTypes = new Set(workTypesForDesignation(employee.designation?.name).filter(t => enumTypes.has(t)));
  if (!visibleTypes.size && !full && !manager) {
    allowedTypes.forEach(t => { if (enumTypes.has(t)) visibleTypes.add(t); });
    if (allowedTypes.has('REEL_EDIT') || visibleTypes.has('EDITING') || visibleTypes.has('VIDEO_EDITING')) ['EDITING', 'VIDEO_EDITING', 'VIDEO'].forEach(t => { if (enumTypes.has(t)) visibleTypes.add(t); });
  }
  const teamIds = [...new Set<number>([...memberTeams.map((m: any) => m.teamId), ...ledTeams.map((t: any) => t.id)])];
  const ids = [customer.id, working.id];
  const [intervals, works, tasks, subscriptions] = await Promise.all([
    tx.monthlySchedule.findMany({ where: { OR: [{ customerId: { in: ids } }, ...(subscription.customerId === customer.id ? [{ subscriptionId: subscription.id }] : [])] }, select: { id: true, customerId: true, subscriptionId: true, planId: true, startDate: true, endDate: true, status: true } }),
    tx.work.findMany({ where: { OR: [{ customerId: { in: ids } }, ...(subscription.customerId === customer.id ? [{ subscriptionId: subscription.id }] : [])] }, select: {
      id: true, customerId: true, subscriptionId: true, teamId: true, assignedToId: true, editorId: true, status: true, scheduledDate: true, workType: true,
      title: true, description: true, entitlement: { select: { serviceName: true } },
      tasks: { select: { id: true, workId: true, assignedToId: true, status: true } },
      team: { select: { id: true, isActive: true, customerId: true, leaderId: true, members: { select: { employeeId: true } } } },
    } }),
    tx.task.findMany({ where: { customerId: { in: ids } }, select: { id: true, customerId: true, employeeId: true, assignedToId: true, status: true, deletedAt: true, category: true, designationId: true, dueDate: true, startDate: true, dueAt: true } }),
    tx.customerSubscription.findMany({ where: { customerId: { in: ids } }, select: { id: true, customerId: true, planId: true, status: true, deletedAt: true, startDate: true, endDate: true } }),
  ]);
  const checks = {
    leadWon: lead.status === 'WON', conversionLink: lead.convertedCustomer?.id === customer.id && customer.leadId === lead.id,
    subscriptionCustomer: subscription.customerId === customer.id, subscriptionActive: subscription.status === 'ACTIVE' && !subscription.deletedAt,
    customerTeam: customer.assignedTeamId === team.id, workingCustomerTeam: working.assignedTeamId === team.id,
    activeTeam: team.isActive, canonicalEmployeeMembership: team.leaderId === employee.id || team.members.some((m: any) => m.employeeId === employee.id),
  };
  const inRange = (d: Date | null) => { const key = dateKey(d); return !!key && key >= args.from && key <= args.to; };
  const member = (t: any) => !!t && (viewerIds.includes(t.leaderId) || t.members.some((m: any) => viewerIds.includes(m.employeeId)));
  const cFor = (cid: number) => cid === customer.id ? customer : working;
  const incorrectlyLinkedWorks = works.filter((w: any) => !ids.includes(w.customerId)).map((w: any) => ({ id: w.id, customerId: w.customerId, subscriptionId: w.subscriptionId, reason: 'Selected subscription references work outside the selected customers; visibility evaluation withheld' }));
  const workResults = works.filter((w: any) => ids.includes(w.customerId)).map((w: any) => {
    const c = cFor(w.customerId);
    const direct = [w.assignedToId, w.editorId, c.assignedEmployeeId, c.createdByEmployeeId, ...w.tasks.map((t: any) => t.assignedToId), c.originLead?.employeeId, c.originLead?.assignedToId, c.originLead?.convertedByEmployeeId].some(value => value > 0 && viewerIds.includes(value));
    const onTeam = teamIds.includes(w.teamId) || teamIds.includes(c.assignedTeamId) || member(w.team) || member(c.assignedTeam);
    const otherAssignee = [w.assignedToId, w.editorId].some(value => value > 0 && !viewerIds.includes(value));
    const normalized = normalizeActivityType({ workType: w.workType, title: w.title, description: w.description });
    const designation = visibleTypes.has(w.workType) || workMatchesDesignation(employee.designation?.name, w.workType) || workMatchesDesignation(employee.designation?.name, normalized);
    const companyScope = c.id === employee.customerId || (c.assignedTeam?.isActive && c.assignedTeam.customerId === employee.customerId) || c.assignedEmployeeRel?.customerId === employee.customerId || c.createdByEmployeeRel?.customerId === employee.customerId || (c.originLead?.customerId === employee.customerId && !c.originLead.deletedAt) || c.leads.length > 0 || teamIds.includes(c.assignedTeamId);
    const companySchedule = !assignedOnly && visibleTypes.has(w.workType) && companyScope && ((w.assignedToId == null && w.editorId == null) || w.assignedToId === employee.id || w.editorId === employee.id);
    const directQuery = [w.assignedToId, w.editorId, c.assignedEmployeeId, c.createdByEmployeeId, ...w.tasks.map((t: any) => t.assignedToId)].some(value => value > 0 && viewerIds.includes(value)) || (!!c.originLead && !c.originLead.deletedAt && ([c.originLead.employeeId, c.originLead.assignedToId, c.originLead.convertedByEmployeeId].some(value => value > 0 && viewerIds.includes(value)) || c.originLead.assignedToId === employee.userId));
    const candidate = directQuery || (assignedOnly ? (teamIds.includes(w.teamId) || teamIds.includes(c.assignedTeamId)) : onTeam) || companySchedule;
    const visibility = manager && !assignedOnly || direct || (assignedOnly ? onTeam : ((!otherAssignee && designation) || (onTeam && (otherAssignee || full || !allowedTypes.size || allowedTypes.has(normalized)))));
    const filters = { assignmentQuery: candidate, postQueryVisibility: visibility, designation, permissionActivity: allowedTypes.has(normalized), status: statusPass(w.status, args.status), date: inRange(w.scheduledDate), customerNotDeleted: !c.deletedAt, requestedWorkType: !args['work-type'] || w.workType === args['work-type'], employeeGate: !assignedOnly || employee.status !== 'INACTIVE' };
    const included = ['assignmentQuery', 'postQueryVisibility', 'status', 'date', 'customerNotDeleted', 'requestedWorkType', 'employeeGate'].every(k => filters[k]);
    return { id: w.id, customerId: w.customerId, subscriptionId: w.subscriptionId, teamId: w.teamId, assignedToId: w.assignedToId, editorId: w.editorId, status: w.status, workType: w.workType, normalizedActivity: normalized, scheduledDate: w.scheduledDate, calendarDate: dateKey(w.scheduledDate), filters, predictedIncluded: included, excludedBy: Object.keys(filters).filter(k => !filters[k] && !['designation', 'permissionActivity'].includes(k)), assignmentOverridesCategoryGate: direct || assignedOnly || manager || (onTeam && otherAssignee), workTasks: w.tasks.map((t: any) => ({ ...t, calendarRepresentation: 'Nested in parent Work; not a standalone calendar row', parentPredictedIncluded: included, assignedToViewer: viewerIds.includes(t.assignedToId) })) };
  });
  const taskResults = tasks.map((t: any) => {
    const c = cFor(t.customerId);
    const onTeam = teamIds.includes(c.assignedTeamId);
    const assignment = t.employeeId === employee.id || (!!employee.userId && t.assignedToId === employee.userId) || onTeam;
    const taskTenant = assignedOnly || manager || c.id === employee.customerId || onTeam || (c.assignedTeam?.isActive && c.assignedTeam.customerId === employee.customerId);
    const filters = { assignment: manager && !assignedOnly || assignment, tenantQuery: taskTenant, status: args.status ? t.status === args.status : t.status !== 'CANCELLED', date: [t.dueDate, t.startDate, t.dueAt].some(inRange), notDeleted: !t.deletedAt && !c.deletedAt, requestedWorkType: !args['work-type'], employeeGate: !assignedOnly || employee.status !== 'INACTIVE' };
    return { ...t, calendarRepresentation: 'Standalone Task row', filters, designation: 'No separate designation filter on Task branch', predictedIncluded: Object.values(filters).every(Boolean) };
  });
  const customerReport = (c: any) => ({ id: c.id, leadId: c.leadId, source: c.source, isActive: c.isActive, deletedAt: c.deletedAt, assignedTeamId: c.assignedTeamId, tenantEvidence: tenantEvidence(c), subscriptionIds: subscriptions.filter((s: any) => s.customerId === c.id).map((s: any) => s.id), monthlyScheduleIds: intervals.filter((s: any) => s.customerId === c.id).map((s: any) => s.id), workIds: works.filter((w: any) => w.customerId === c.id).map((w: any) => w.id) });
  return {
    diagnosticOnly: true, authenticatedApiVerified: false, writesAllowed: false,
    caveats: ['Stored pre-sync/pre-carry-forward snapshot; service side effects deliberately skipped.', 'Route mode supplied explicitly; authenticated CALENDAR module permissions are not verified here.', 'Designation and permission flags are explanatory: current assignment/team branches can override category gates.', 'Customer tenant evidence is relational, not a dedicated tenant column. No result grants authorization.', 'Only dateFrom/dateTo range plus optional status/work-type filters are modeled; no employee/team query override.'],
    lead, customer: customerReport(customer), workingCustomer: customerReport(working), subscription, subscriptions,
    employee: { id: employee.id, userId: employee.userId, customerId: employee.customerId, status: employee.status, designation: employee.designation?.name, canonicalTeamIds: employee.teamMembers.map((m: any) => m.teamId), calendarCandidateIds: viewerIds, calendarTeamIds: teamIds, role, effectiveWorkModules: [...modules], allowedTypes: [...allowedTypes], visibleTypes: [...visibleTypes], manager, full },
    team, relationshipChecks: checks, firstInconsistentRelationship: Object.keys(checks).find(k => !checks[k]) || null,
    monthlySchedules: intervals, works: workResults, incorrectlyLinkedWorks, standaloneTasks: taskResults,
    lifecycle: ids.map(cid => ({ customerId: cid, monthlyIntervalsExist: intervals.some((s: any) => s.customerId === cid), individualWorksExist: works.some((w: any) => w.customerId === cid), nextEvidenceNeeded: works.some((w: any) => w.customerId === cid) ? 'Compare excludedBy and exact authenticated API IDs/dates' : 'Inspect subscription activation and deliverable generation logs; do not regenerate' })),
  };
}

async function main() {
  let args: Record<string, string>;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); process.exitCode = 2; return; }
  const prisma = new PrismaClient({ log: [] });
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
      return diagnose(tx, args);
    }, { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 5000 });
    console.log(JSON.stringify(result, null, 2));
    if (result.blocked) process.exitCode = 3;
  } catch { console.error('Read-only diagnostic failed. Check connection, schema, and access securely; database errors are suppressed to avoid credential disclosure.'); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
if (require.main === module) void main();
