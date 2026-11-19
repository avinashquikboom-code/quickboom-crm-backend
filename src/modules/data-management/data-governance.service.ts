import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createLeadCreatedOutbox } from '../lead/lead-stage-outbox';
import {
  PROTECTED_RECORDS,
  RESET_MODULES,
  TableRule,
  availableModules,
  moduleById,
  resolveModuleId,
  tablesForModules,
  whereFor,
  assertCatalogSafe,
} from './data-governance.catalog';

const MAX_ROWS = 10000;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const SENSITIVE_KEY = /password|secret|token|apiKey|credential/i;
const matchesConfirmation = (provided: string | undefined, expected: string) =>
  String(provided || '').trim().toUpperCase() === expected;

const scopedCustomer = (customerId: number | null) => customerId == null ? {} : { customerId };

type PreviewRecord = {
  customerId: number | null;
  scope: 'tenant' | 'global';
  modules: string[];
  counts: Record<string, number>;
  estimatedRecords: number;
  totalEligibleRecords: number;
  dependencySnapshot: string;
  protectedDesignationIds: number[];
  protectedRoleIds: number[];
  expiresAt: number;
};

type DesignationPreservation = {
  designationIds: number[];
  roles: Array<{ id: number; designationId: number; customerId: number | null; type: string; name: string }>;
  roleOwnership: { system: number; tenant: number; otherTenant: number };
  roleTypes: Record<string, number>;
};

type BackupPayload = {
  version: 1;
  backupId: string;
  customerId: number | null;
  scope: 'tenant' | 'global';
  modules: string[];
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
};

@Injectable()
export class DataGovernanceService {
  private readonly logger = new Logger(DataGovernanceService.name);
  private readonly active = new Map<string, string>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly consumingPreviews = new Set<string>();
  private readonly jobs = new Map<string, Record<string, unknown>>();

  constructor(private readonly prisma: PrismaService) {
    assertCatalogSafe();
  }

  async overview(customerId: number | string | null | undefined) {
    const tenantId = this.optionalTenant(customerId);
    const meta = await this.databaseMeta();
    // The reset catalog spans optional feature tables and can be ahead of a
    // rolling database migration. Keep the overview available when one such
    // count fails, while preserving tenant scoping for every successful count.
    let tenantRecordsComplete = true;
    const modules = tenantId
      ? await this.countModules(tenantId, () => { tenantRecordsComplete = false; })
      : [];
    let tenantRecords = 0;
    if (tenantId) {
      const uniqueTables = tablesForModules(availableModules().map((item) => item.id));
      const tableCounts = await Promise.all(uniqueTables.map((table) => this.countOverviewTable(table, tenantId, () => { tenantRecordsComplete = false; })));
      tenantRecords = tableCounts.reduce((sum, count) => sum + count, 0);
    }
    const [lastBackup, lastReset] = await Promise.all([
      this.latestAudit(tenantId, 'DATA_BACKUP'),
      this.latestAudit(tenantId, 'DATA_RESET'),
    ]);
    return {
      databaseType: 'PostgreSQL',
      databaseName: meta.name,
      totalTables: meta.tables,
      databaseSizeBytes: meta.bytes,
      databaseSize: formatBytes(meta.bytes),
      estimatedDatabaseRows: meta.estimate,
      tenantRecords,
      tenantRecordsComplete,
      modules,
      lastBackup: lastBackup?.createdAt || null,
      lastReset: lastReset?.createdAt || null,
      health: meta.healthy ? 'Healthy' : 'Unavailable',
      protected: PROTECTED_RECORDS,
    };
  }

  listModules() {
    return {
      modules: RESET_MODULES.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        available: item.available,
        reason: item.reason || null,
        tables: item.tables.map((table) => ({ model: table.model, label: table.label })),
      })),
      protected: PROTECTED_RECORDS,
    };
  }

  async previewReset(
    customerId: number | string | null | undefined,
    body: { modules?: string[] | string; scope?: string } = {},
  ) {
    const scope = body.scope === 'global' ? 'global' : body.scope === 'application' ? 'application' : 'selected';
    const tenantId = scope === 'global' ? null : this.requireTenant(customerId);
    const modules = this.selectedModules(body.modules, scope === 'application' || scope === 'global');
    const counts: Record<string, number> = {};
    const tables = [];
    for (const table of tablesForModules(modules.map((item) => item.id))) {
      const records = await this.countTable(table, tenantId);
      counts[table.model] = records;
      tables.push({ model: table.model, label: table.label, records });
    }
    const designationPreservation = modules.some((item) => item.id === 'designations')
      ? await this.designationPreservation(this.prisma, tenantId)
      : { designationIds: [], roles: [], roleOwnership: { system: 0, tenant: 0, otherTenant: 0 }, roleTypes: {} };
    const preservedDesignationIds = designationPreservation.designationIds;
    const preservedDesignationCount = preservedDesignationIds.length;
    for (const table of tables) {
      if (table.model !== 'designation') continue;
      table.preservedRecords = preservedDesignationCount;
      table.eligibleRecords = Math.max(0, table.records - preservedDesignationCount);
      table.preservationReason = preservedDesignationCount
        ? 'Linked designations remain so protected Role records are not cascade-deleted.'
        : null;
    }
    const dependencyWarnings = await this.dependencyWarnings(modules.map((item) => item.id), tenantId);
    const dependencySnapshot = this.dependencySnapshot(dependencyWarnings);
    const estimatedRecords = tables.reduce((sum, table) => sum + table.records, 0);
    const totalEligibleRecords = estimatedRecords - preservedDesignationCount;
    const preservation = designationPreservation.roles.length
      ? [
        {
          model: 'role', label: 'Roles', records: designationPreservation.roles.length,
          reason: 'Roles are protected. Their linked designation records are preserved to prevent ON DELETE CASCADE from deleting the roles.',
          roleOwnership: designationPreservation.roleOwnership,
          roleTypes: designationPreservation.roleTypes,
          roles: designationPreservation.roles.map(({ id, name, type, customerId: roleCustomerId }) => ({
            id, name, type, owner: roleCustomerId == null ? 'system' : roleCustomerId === tenantId ? 'current tenant' : 'other tenant',
          })),
        },
        {
          model: 'designation', label: 'Linked designations', records: preservedDesignationCount,
          reason: 'These designations are referenced by protected roles and are excluded from deletion.',
        },
      ]
      : [];
    const previewToken = randomUUID();
    const protectedCounts = await this.countProtectedRecords(tenantId);
    this.previews.set(previewToken, {
      customerId: tenantId,
      scope: scope === 'global' ? 'global' : 'tenant',
      modules: modules.map((item) => item.id),
      counts,
      estimatedRecords,
      totalEligibleRecords,
      dependencySnapshot,
      protectedDesignationIds: preservedDesignationIds,
      protectedRoleIds: designationPreservation.roles.map((role) => role.id).sort((a, b) => a - b),
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
    return {
      previewToken,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      scope: scope === 'global' ? 'global' : 'tenant',
      modules: modules.map((item) => {
        const totalRecords = item.tables.reduce((sum, table) => sum + (counts[table.model] || 0), 0);
        const preservedRecords = item.id === 'designations' ? preservedDesignationCount : 0;
        return { id: item.id, name: item.name, records: totalRecords - preservedRecords, totalRecords, preservedRecords };
      }),
      tables,
      estimatedRecords,
      totalEligibleRecords,
      totalPreservedRecords: preservation.reduce((sum, item) => sum + item.records, 0),
      preservation,
      protectedCounts,
      dependencies: this.dependencies(modules.map((item) => item.id)),
      dependencyWarnings,
      protected: PROTECTED_RECORDS,
    };
  }

  async executeReset(
    customerId: number | string | null | undefined,
    userId: number | string,
    role: string,
    body: {
      modules?: string[];
      scope?: string;
      previewToken?: string;
      confirmation?: string;
      acknowledgement?: string;
      globalConfirmation?: string;
      idempotencyKey?: string;
      reason?: string;
    },
  ) {
    this.assertSuperAdmin(role);
    const scope = body.scope === 'global' ? 'global' : body.scope === 'application' ? 'application' : 'selected';
    const tenantId = scope === 'global' ? null : this.requireTenant(customerId);
    if (!matchesConfirmation(body.confirmation, 'RESET')) {
      throw new BadRequestException('Type RESET to confirm deletion.');
    }
    if (scope !== 'selected' && !matchesConfirmation(body.acknowledgement, 'RESET ALL DATA')) {
      throw new BadRequestException('Type RESET ALL DATA to confirm a full data reset.');
    }
    if (scope === 'global' && !matchesConfirmation(body.globalConfirmation, 'RESET GLOBAL')) {
      throw new BadRequestException('Type RESET GLOBAL to confirm a reset across every tenant.');
    }
    const key = this.requireIdempotency(body.idempotencyKey);
    const previous = await this.findIdempotent(tenantId, key, 'DATA_RESET');
    if (previous) return previous;
    const previewToken = String(body.previewToken || '');
    if (this.consumingPreviews.has(previewToken)) {
      throw new BadRequestException('This reset preview is already being used by another operation.');
    }
    const previewRecord = this.previews.get(previewToken);
    const preview = this.takePreview(body.previewToken, tenantId, scope === 'global' ? 'global' : 'tenant');
    const modules = this.selectedModules(body.modules, scope === 'application' || scope === 'global');
    const moduleIds = modules.map((item) => item.id).sort();
    if ([...preview.modules].sort().join(',') !== moduleIds.join(',')) {
      throw new BadRequestException('The preview does not match the selected modules. Run the preview again.');
    }
    const operationId = randomUUID();
    this.consumingPreviews.add(previewToken);
    return this.withLock(tenantId, operationId, async () => {
      const deleted: Record<string, number> = {};
      const countsBefore: Record<string, number> = {};
      const countsAfter: Record<string, number> = {};
      const failures: string[] = [];
      let resetTransactionCommitted = false;
      let taskHistoryDiagnostic: {
        expectedCount: number;
        matchingBeforeDelete: number;
        deletedCount?: number;
        parentTaskIds: number[];
        reason?: string;
      } | null = null;
      let visitPhotoDiagnostic: {
        expectedCount: number;
        matchingBeforeDelete: number;
        deletedCount?: number;
        visitIds: number[];
        deletionFilter: Record<string, unknown>;
        reason?: string;
      } | null = null;
      try {
        if (!previewRecord || this.previews.get(previewToken) !== previewRecord) {
          throw new BadRequestException('The reset preview is no longer available. Run it again.');
        }
        await this.prisma.$transaction(async (tx) => {
          await this.acquireResetAdvisoryLock(tx, tenantId);
          await this.lockResetRoots(tx, moduleIds, tenantId);
          const dependencyWarnings = await this.dependencyWarnings(moduleIds, tenantId, tx);
          if (this.dependencySnapshot(dependencyWarnings) !== previewRecord.dependencySnapshot) {
            throw new BadRequestException('Dependencies changed after the preview. Run a fresh preview before deleting.');
          }
          const blockers = dependencyWarnings.filter((item) => item.blocking);
          if (blockers.length) {
            throw new BadRequestException(`Deletion is blocked by dependencies: ${blockers.map((item) => `${item.label}: ${item.records} records${item.crossTenantRecords ? ` (${item.crossTenantRecords} reference other tenants)` : ''}`).join('; ')}.`);
          }
          const currentDesignationPreservation = moduleIds.includes('designations')
            ? await this.designationPreservation(tx, tenantId)
            : { designationIds: [], roles: [], roleOwnership: { system: 0, tenant: 0, otherTenant: 0 }, roleTypes: {} };
          const protectedDesignationIds = currentDesignationPreservation.designationIds;
          const protectedRoleIds = currentDesignationPreservation.roles.map((item) => item.id).sort((a, b) => a - b);
          if (protectedDesignationIds.join(',') !== [...previewRecord.protectedDesignationIds].sort((a, b) => a - b).join(',')
            || protectedRoleIds.join(',') !== [...previewRecord.protectedRoleIds].sort((a, b) => a - b).join(',')) {
            throw new BadRequestException('Protected role/designation links changed after the preview. Run the preview again.');
          }
          const recount = await this.countTables(tablesForModules(moduleIds), tenantId, tx);
          const changedTables = Object.entries(recount.counts)
            .filter(([model, records]) => records !== (preview.counts[model] || 0))
            .map(([model]) => model);
          if (recount.total !== preview.estimatedRecords || changedTables.length) {
            throw new BadRequestException('Records changed after the preview. Run the preview again before deleting.');
          }
          Object.assign(countsBefore, recount.counts);
          const deletionLedger = new Set<string>();

          if (moduleIds.includes('employees')) {
            const customerReferenceFilters = this.customerEmployeeReferenceFilters(tenantId);
            const employeeIds = await tx.employee.findMany({
              where: tenantId == null ? {} : { customerId: tenantId },
              select: { id: true },
            });
            const ids = employeeIds.map((item) => item.id);
            if (ids.length) {
              // These tenant-owned customer records are protected, but their
              // optional employee links use ON DELETE SET NULL. Clear only
              // same-tenant links; dependencyWarnings rejects cross-tenant refs.
              await tx.customer.updateMany({
                where: { ...customerReferenceFilters.sameTenantTarget, assignedEmployeeId: { in: ids } },
                data: { assignedEmployeeId: null },
              });
              await tx.customer.updateMany({
                where: { ...customerReferenceFilters.sameTenantTarget, createdByEmployeeId: { in: ids } },
                data: { createdByEmployeeId: null },
              });
              if (!moduleIds.includes('departments')) {
                await tx.department.updateMany({
                  where: { ...(tenantId == null ? {} : { customerId: tenantId }), headId: { in: ids } },
                  data: { headId: null },
                });
              }
              if (!moduleIds.includes('visits-tasks')) {
                await tx.taskProof.updateMany({
                  where: { employeeId: { in: ids }, ...(tenantId == null ? {} : { task: { customerId: tenantId } }) },
                  data: { employeeId: null },
                });
              }
            }
          }

          for (const table of tablesForModules(moduleIds)) {
            const delegate = this.delegate(tx, table.model);
            const baseWhere = whereFor(table.where, tenantId);
            const where = table.model === 'designation' && protectedDesignationIds.length
              ? { ...baseWhere, id: { notIn: protectedDesignationIds } }
              : baseWhere;
            if (deletionLedger.has(table.model)) {
              const remaining = await delegate.count({ where });
              if (remaining !== 0) {
                throw new Error(`${table.label}: duplicate deletion step found ${remaining} eligible records still present.`);
              }
              continue;
            }
            const expected = recount.counts[table.model] || 0;
            if (table.model === 'visitPhoto') {
              const matchingRows = await tx.visitPhoto.findMany({
                where,
                select: { id: true, visitId: true },
              });
              visitPhotoDiagnostic = {
                expectedCount: expected,
                matchingBeforeDelete: matchingRows.length,
                visitIds: [...new Set(matchingRows.map((row) => Number(row.visitId)).filter(Number.isInteger))],
                deletionFilter: where,
              };
              this.logger.log(`Visit photos reset step ${JSON.stringify({
                operationId,
                tenantId,
                selectedModules: moduleIds,
                ...visitPhotoDiagnostic,
                transactionStatus: 'IN_PROGRESS',
              })}`);
              if (visitPhotoDiagnostic.matchingBeforeDelete !== expected) {
                visitPhotoDiagnostic.reason = 'The matching rows immediately before deletion differ from the transaction recount.';
                this.logger.error(`Visit photos reset mismatch ${JSON.stringify({
                  operationId,
                  tenantId,
                  selectedModules: moduleIds,
                  ...visitPhotoDiagnostic,
                  transactionStatus: 'ROLLBACK_PENDING',
                })}`);
                throw new Error(`Visit photos: expected ${expected} rows immediately before deletion but found ${visitPhotoDiagnostic.matchingBeforeDelete}.`);
              }
            }
            if (table.model === 'taskHistory') {
              const matchingRows = await tx.taskHistory.findMany({ where, select: { id: true, taskId: true } });
              taskHistoryDiagnostic = {
                expectedCount: expected,
                matchingBeforeDelete: matchingRows.length,
                parentTaskIds: [...new Set(matchingRows.map((row) => Number(row.taskId)).filter(Number.isInteger))],
              };
              this.logger.log(`Task history reset step ${JSON.stringify({
                operationId,
                tenantId,
                selectedModules: moduleIds,
                ...taskHistoryDiagnostic,
                transactionStatus: 'IN_PROGRESS',
              })}`);
              if (taskHistoryDiagnostic.matchingBeforeDelete !== expected) {
                taskHistoryDiagnostic.reason = 'The matching rows immediately before deletion differ from the transaction recount.';
                this.logger.error(`Task history reset mismatch ${JSON.stringify({
                  operationId,
                  tenantId,
                  selectedModules: moduleIds,
                  ...taskHistoryDiagnostic,
                  transactionStatus: 'ROLLBACK_PENDING',
                })}`);
                throw new Error(`Task history: expected ${expected} rows immediately before deletion but found ${taskHistoryDiagnostic.matchingBeforeDelete}.`);
              }
            }
            const expectedToDelete = table.model === 'designation'
              ? Math.max(0, expected - protectedDesignationIds.length)
              : expected;
            const result = await delegate.deleteMany({ where });
            const deletedCount = Number(result?.count || 0);
            if (table.model === 'visitPhoto' && visitPhotoDiagnostic) {
              visitPhotoDiagnostic.deletedCount = deletedCount;
              if (deletedCount !== expectedToDelete) {
                visitPhotoDiagnostic.reason = 'The deleteMany affected-row count differs from the expected eligible count.';
                this.logger.error(`Visit photos reset mismatch ${JSON.stringify({
                  operationId,
                  tenantId,
                  selectedModules: moduleIds,
                  ...visitPhotoDiagnostic,
                  transactionStatus: 'ROLLBACK_PENDING',
                })}`);
              } else {
                this.logger.log(`Visit photos reset deleted ${JSON.stringify({
                  operationId,
                  tenantId,
                  selectedModules: moduleIds,
                  ...visitPhotoDiagnostic,
                  transactionStatus: 'IN_PROGRESS',
                })}`);
              }
            }
            if (table.model === 'taskHistory' && taskHistoryDiagnostic) {
              taskHistoryDiagnostic.deletedCount = deletedCount;
              if (deletedCount !== expectedToDelete) {
                taskHistoryDiagnostic.reason = taskHistoryDiagnostic.matchingBeforeDelete !== expected
                  ? 'The matching rows immediately before deletion differ from the transaction recount.'
                  : 'The deleteMany affected-row count differs from the expected eligible count.';
              }
            }
            if (deletedCount !== expectedToDelete) {
              if (table.model === 'taskHistory' && taskHistoryDiagnostic) {
                taskHistoryDiagnostic.reason ||= 'The deleteMany affected-row count differs from the expected eligible count.';
                this.logger.error(`Task history reset mismatch ${JSON.stringify({
                  operationId,
                  tenantId,
                  selectedModules: moduleIds,
                  ...taskHistoryDiagnostic,
                  transactionStatus: 'ROLLBACK_PENDING',
                })}`);
              }
              throw new Error(
                `${table.label}: expected to delete ${expectedToDelete} eligible records but deleted ${deletedCount}.`,
              );
            }
            const remaining = await delegate.count({ where });
            if (remaining !== 0) {
              throw new Error(`${table.label}: ${remaining} records remain after deletion.`);
            }
            deletionLedger.add(table.model);
            deleted[table.model] = deletedCount;
          }
          if (moduleIds.includes('employees')) {
            const { references } = this.customerEmployeeReferenceFilters(tenantId);
            const remainingCustomerReferences = await tx.customer.count({ where: references });
            if (remainingCustomerReferences !== 0) {
              throw new Error(`Customer employee references: ${remainingCustomerReferences} records remain after reset cleanup.`);
            }
          }
          if (protectedDesignationIds.length) {
            const remainingProtectedDesignations = await tx.designation.count({
              where: { ...(tenantId == null ? {} : { customerId: tenantId }), id: { in: protectedDesignationIds } },
            });
            if (remainingProtectedDesignations !== protectedDesignationIds.length) {
              throw new Error('Protected designations did not remain intact after reset.');
            }
          }
        }, { timeout: 120000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        resetTransactionCommitted = true;

        if (taskHistoryDiagnostic) {
          this.logger.log(`Task history reset committed ${JSON.stringify({
            operationId,
            tenantId,
            selectedModules: moduleIds,
            ...taskHistoryDiagnostic,
            transactionStatus: 'COMMITTED',
          })}`);
        }
        if (visitPhotoDiagnostic) {
          this.logger.log(`Visit photos reset committed ${JSON.stringify({
            operationId,
            tenantId,
            selectedModules: moduleIds,
            ...visitPhotoDiagnostic,
            transactionStatus: 'COMMITTED',
          })}`);
        }

        // Run a fresh query after PostgreSQL commits, so success reflects committed state.
        for (const table of tablesForModules(moduleIds)) {
          const remaining = await this.delegate(this.prisma, table.model).count({
            where: whereFor(table.where, tenantId),
          });
          countsAfter[table.model] = remaining;
          const expectedPreserved = table.model === 'designation' ? previewRecord.protectedDesignationIds.length : 0;
          if (remaining !== expectedPreserved) {
            throw new Error(`${table.label}: ${remaining} records remain after the committed deletion.`);
          }
        }
        if (moduleIds.includes('employees')) {
          const customerReferenceFilters = this.customerEmployeeReferenceFilters(tenantId);
          const [remainingReferences, remainingSameTenantReferences, remainingCrossTenantReferences] = await Promise.all([
            this.prisma.customer.count({ where: customerReferenceFilters.references }),
            customerReferenceFilters.sameTenant
              ? this.prisma.customer.count({ where: customerReferenceFilters.sameTenant })
              : Promise.resolve(0),
            customerReferenceFilters.crossTenant
              ? this.prisma.customer.count({ where: customerReferenceFilters.crossTenant })
              : Promise.resolve(0),
          ]);
          countsAfter.customerEmployeeReferences = remainingReferences;
          countsAfter.customerSameTenantReferences = remainingSameTenantReferences;
          countsAfter.customerCrossTenantReferences = remainingCrossTenantReferences;
          if (remainingReferences !== 0 || remainingSameTenantReferences !== 0 || remainingCrossTenantReferences !== 0) {
            throw new Error(`Customer employee references remain after the committed deletion (total ${remainingReferences}, same tenant ${remainingSameTenantReferences}, cross tenant ${remainingCrossTenantReferences}).`);
          }
        }
        const preservedCounts = {
          role: previewRecord.protectedRoleIds.length,
          designation: previewRecord.protectedDesignationIds.length,
        };
        const recordsPreserved = Object.values(preservedCounts).reduce((sum, count) => sum + count, 0);
        await this.writeAudit(tenantId, userId, role, 'DATA_RESET', 'SUCCESS', {
          operationId,
          scope,
          modules: moduleIds,
          recordsDeleted: Object.values(deleted).reduce((sum, count) => sum + count, 0),
          tables: deleted,
          countsBefore,
          countsAfter,
          preservedCounts,
          recordsPreserved,
          idempotencyKey: key,
          reason: body.reason || 'Admin data reset',
          verified: true,
          status: 'SUCCESS',
        });
        this.previews.delete(previewToken);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Reset failed');
        if (taskHistoryDiagnostic) {
          this.logger.warn(`Task history reset rolled back or failed ${JSON.stringify({
            operationId,
            tenantId,
            selectedModules: moduleIds,
            ...taskHistoryDiagnostic,
            transactionStatus: resetTransactionCommitted ? 'COMMITTED_POST_COMMIT_FAILURE' : 'ROLLED_BACK',
          })}`);
        }
        if (visitPhotoDiagnostic) {
          this.logger.warn(`Visit photos reset rolled back or failed ${JSON.stringify({
            operationId,
            tenantId,
            selectedModules: moduleIds,
            ...visitPhotoDiagnostic,
            transactionStatus: resetTransactionCommitted ? 'COMMITTED_POST_COMMIT_FAILURE' : 'ROLLED_BACK',
            error: failures[0],
          })}`);
        }
        this.logger.error(`Data reset operation failed ${JSON.stringify({
          operationId,
          tenantId,
          selectedModules: moduleIds,
          transactionStatus: resetTransactionCommitted ? 'COMMITTED_POST_COMMIT_FAILURE' : 'ROLLED_BACK',
          error: failures[0],
        })}`);
        await this.writeAudit(tenantId, userId, role, 'DATA_RESET', 'FAILED', {
          operationId,
          scope,
          modules: moduleIds,
          recordsDeleted: Object.values(deleted).reduce((sum, count) => sum + count, 0),
          tables: deleted,
          countsBefore,
          countsAfter,
          preservedCounts: {
            role: previewRecord.protectedRoleIds.length,
            designation: previewRecord.protectedDesignationIds.length,
          },
          recordsPreserved: previewRecord.protectedRoleIds.length + previewRecord.protectedDesignationIds.length,
          idempotencyKey: key,
          verified: false,
          partial: Object.values(deleted).some((count) => count > 0),
          status: 'FAILED',
          error: failures[0],
        });
        throw new BadRequestException(`Reset did not complete successfully. Operation ${operationId}. ${failures[0]}`);
      } finally {
        this.consumingPreviews.delete(previewToken);
      }
      const recordsDeleted = Object.values(deleted).reduce((sum, count) => sum + count, 0);
      const preservedCounts = {
        role: previewRecord.protectedRoleIds.length,
        designation: previewRecord.protectedDesignationIds.length,
      };
      const recordsPreserved = Object.values(preservedCounts).reduce((sum, count) => sum + count, 0);
      this.logger.log(`Data reset ${operationId} removed ${recordsDeleted} records`);
      return {
        success: true,
        operationId,
        status: 'SUCCESS',
        scope,
        modules: moduleIds,
        recordsDeleted,
        recordsPreserved,
        preservedCounts,
        eligibleRecords: preview.totalEligibleRecords,
        tables: deleted,
        countsBefore,
        countsAfter,
        verified: true,
        verifiedTables: Object.keys(deleted),
        failures,
        completedAt: new Date().toISOString(),
      };
    });
  }

  async createBackup(
    customerId: number | string | null | undefined,
    userId: number | string,
    role: string,
    body: { name?: string; description?: string; modules?: string[]; scope?: string },
  ) {
    this.assertSuperAdmin(role);
    const global = body.scope === 'global';
    const tenantId = global ? null : this.requireTenant(customerId);
    const modules = this.selectedModules(body.modules, !body.modules?.length || global);
    const moduleIds = modules.map((item) => item.id);
    const operationId = randomUUID();
    return this.withLock(tenantId, operationId, () => this.performBackup(tenantId, userId, role, operationId, moduleIds, global, body));
  }

  private async performBackup(
    tenantId: number | null,
    userId: number | string,
    role: string,
    operationId: string,
    moduleIds: string[],
    global: boolean,
    body: { name?: string; description?: string },
  ) {
    const backupId = randomUUID();
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    let recordCount = 0;
    for (const table of tablesForModules(moduleIds)) {
      const total = await this.countTable(table, tenantId);
      if (total > MAX_ROWS) {
        throw new BadRequestException(`${table.label} has ${total} records. A single backup can include up to ${MAX_ROWS} rows per table.`);
      }
      const rows = await this.delegate(this.prisma, table.model).findMany({ where: whereFor(table.where, tenantId) });
      tables[table.model] = (rows as Array<Record<string, unknown>>).map(sanitizeRow);
      recordCount += tables[table.model].length;
    }
    const payload: BackupPayload = {
      version: 1,
      backupId,
      customerId: tenantId,
      scope: global ? 'global' : 'tenant',
      modules: moduleIds,
      createdAt: new Date().toISOString(),
      tables,
    };
    const file = await this.writeBackup(tenantId, backupId, payload);
    const verified = await this.verifyFile(file.path, file.checksum, tenantId, backupId);
    if (!verified.ok) {
      await rm(file.path, { force: true });
      throw new BadRequestException(`Backup verification failed. ${verified.reason}`);
    }
    await this.writeAudit(tenantId, userId, role, 'DATA_BACKUP', 'SUCCESS', {
      operationId,
      backupId,
      name: String(body.name || `Backup ${payload.createdAt}`).slice(0, 120),
      description: String(body.description || '').slice(0, 500),
      scope: payload.scope,
      modules: moduleIds,
      size: file.size,
      checksum: file.checksum,
      recordCount,
      status: 'VERIFIED',
      fileName: file.fileName,
      createdAt: payload.createdAt,
    });
    return {
      success: true,
      operationId,
      backupId,
      status: 'VERIFIED',
      name: String(body.name || `Backup ${payload.createdAt}`).slice(0, 120),
      scope: payload.scope,
      modules: moduleIds,
      size: file.size,
      checksum: file.checksum,
      recordCount,
      createdAt: payload.createdAt,
    };
  }

  async listBackups(customerId: number | string | null | undefined) {
    const tenantId = this.optionalTenant(customerId);
    const logs = await this.prisma.auditLog.findMany({
      where: { action: 'DATA_BACKUP', ...(tenantId ? { customerId: tenantId } : { customerId: null }) },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const rows = [];
    for (const log of logs) {
      const details = asObject(log.details);
      if (!details.backupId) continue;
      const file = this.backupPath(tenantId, String(details.backupId));
      const exists = await stat(file).then((info) => info.size > 0).catch(() => false);
      const check = exists && details.status === 'VERIFIED'
        ? await this.verifyFile(file, String(details.checksum || ''), tenantId, String(details.backupId))
        : { ok: false, reason: exists ? 'Backup is not marked verified.' : 'Backup file is missing.' };
      rows.push({
        id: details.backupId,
        operationId: details.operationId || log.id,
        name: details.name || 'Backup',
        description: details.description || '',
        scope: details.scope || 'tenant',
        modules: details.modules || [],
        status: check.ok ? 'VERIFIED' : exists ? 'INVALID' : 'MISSING',
        verificationReason: check.ok ? null : check.reason,
        size: details.size || 0,
        checksum: details.checksum || '',
        recordCount: details.recordCount || 0,
        createdAt: log.createdAt,
        createdBy: log.user ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email : 'Super Admin',
      });
    }
    return rows;
  }

  async backupDetails(customerId: number | string | null | undefined, backupId: string) {
    const row = (await this.listBackups(customerId)).find((item) => item.id === backupId);
    if (!row) throw new NotFoundException('Backup not found for this tenant.');
    return row;
  }

  async verifyBackup(customerId: number | string | null | undefined, backupId: string) {
    const tenantId = this.optionalTenant(customerId);
    const meta = await this.backupMeta(tenantId, backupId);
    const file = this.backupPath(meta.customerId, backupId);
    const checked = await this.verifyFile(file, String(meta.checksum || ''), meta.customerId, backupId);
    if (!checked.ok) throw new BadRequestException(`Backup verification failed. ${checked.reason}`);
    return { backupId, status: 'VERIFIED', size: checked.size, checksum: meta.checksum, modules: meta.modules, scope: meta.scope };
  }

  async backupFile(customerId: number | string | null | undefined, backupId: string) {
    const verified = await this.verifyBackup(customerId, backupId);
    const tenantId = verified.scope === 'global' ? null : this.requireTenant(customerId);
    const path = this.backupPath(tenantId, backupId);
    return { path, fileName: `qb-backup-${backupId}.json.gz`, stream: createReadStream(path) };
  }

  async previewRestore(customerId: number | string | null | undefined, backupId: string) {
    const tenantId = this.optionalTenant(customerId);
    const verified = await this.verifyBackup(tenantId, backupId);
    const payload = await this.readPayload(this.backupPath(verified.scope === 'global' ? null : tenantId, backupId));
    const tables = Object.entries(payload.tables).map(([model, rows]) => ({ model, records: rows.length }));
    return {
      backupId,
      scope: payload.scope,
      modules: payload.modules,
      tables,
      estimatedRecords: tables.reduce((sum, table) => sum + table.records, 0),
      protected: PROTECTED_RECORDS,
      requiresPreRestoreBackup: true,
      status: 'VERIFIED',
    };
  }

  async executeRestore(
    customerId: number | string | null | undefined,
    userId: number | string,
    role: string,
    backupId: string,
    body: { confirmation?: string; idempotencyKey?: string },
  ) {
    this.assertSuperAdmin(role);
    if (String(body.confirmation || '').trim() !== 'RESTORE') {
      throw new BadRequestException('Type RESTORE to confirm restoration.');
    }
    const key = this.requireIdempotency(body.idempotencyKey);
    const verified = await this.verifyBackup(customerId, backupId);
    const tenantId = verified.scope === 'global' ? null : this.requireTenant(customerId);
    const previous = await this.findIdempotent(tenantId, key, 'DATA_RESTORE');
    if (previous) return previous;
    const payload = await this.readPayload(this.backupPath(tenantId, backupId));
    if (payload.customerId !== tenantId) throw new ForbiddenException('This backup belongs to a different tenant.');
    const operationId = randomUUID();
    return this.withLock(tenantId, operationId, async () => {
      const pre = await this.performBackup(tenantId, userId, role, randomUUID(), payload.modules, payload.scope === 'global', {
        name: `Pre-restore ${new Date().toISOString()}`,
        description: `Automatic backup before restoring ${backupId}`,
      });
      const rules = tablesForModules(payload.modules);
      const restored: Record<string, number> = {};
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const table of rules) {
            await this.delegate(tx, table.model).deleteMany({ where: whereFor(table.where, tenantId) });
          }
          for (const table of [...rules].reverse()) {
            const rows = payload.tables[table.model] || [];
            for (const row of rows) {
              await this.delegate(tx, table.model).create({ data: row });
            }
            restored[table.model] = rows.length;
            if (/^[A-Za-z0-9_]+$/.test(table.table)) {
              await tx.$executeRawUnsafe(
                `SELECT setval(pg_get_serial_sequence('"${table.table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table.table}"), 1), true)`,
              );
            }
          }
          await tx.auditLog.create({
            data: this.auditData(tenantId, userId, role, 'DATA_RESTORE', 'SUCCESS', {
              operationId,
              backupId,
              preRestoreBackupId: pre.backupId,
              modules: payload.modules,
              recordsRestored: Object.values(restored).reduce((sum, count) => sum + count, 0),
              tables: restored,
              idempotencyKey: key,
              status: 'SUCCESS',
            }),
          });
        }, { timeout: 180000, maxWait: 10000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Restore failed';
        await this.writeAudit(tenantId, userId, role, 'DATA_RESTORE', 'FAILED', {
          operationId,
          backupId,
          preRestoreBackupId: pre.backupId,
          idempotencyKey: key,
          status: 'FAILED',
          error: message,
        });
        throw new BadRequestException(`Restore failed and the data changes were rolled back. Pre-restore backup ${pre.backupId} is still available. Operation ${operationId}. ${message}`);
      }
      return {
        success: true,
        operationId,
        status: 'SUCCESS',
        backupId,
        preRestoreBackupId: pre.backupId,
        modules: payload.modules,
        recordsRestored: Object.values(restored).reduce((sum, count) => sum + count, 0),
        tables: restored,
        failures: [],
        completedAt: new Date().toISOString(),
      };
    });
  }

  cleanupCatalog() {
    return [
      { id: 'expired-refresh-tokens', name: 'Expired refresh tokens', description: 'Removes refresh tokens that are already past their expiry for users in this tenant.', destructive: true },
      { id: 'stale-sessions', name: 'Stale sessions', description: 'Removes sessions last seen more than 30 days ago for users in this tenant.', destructive: true },
      { id: 'stale-failed-captures', name: 'Expired failed captures', description: 'Removes data-capture rows that failed import more than 30 days ago.', destructive: true },
      { id: 'old-email-logs', name: 'Email logs older than 180 days', description: 'Removes tenant email delivery logs. Audit history stays.', destructive: true },
      { id: 'duplicate-leads', name: 'Duplicate leads', description: 'Lists leads that share a phone number. Nothing is deleted.', destructive: false },
    ];
  }

  async previewCleanup(customerId: number | string | null | undefined, operation: string) {
    const tenantId = this.requireTenant(customerId);
    const records = await this.cleanupCount(tenantId, operation);
    return { operation, records, destructive: operation !== 'duplicate-leads', protected: ['Audit logs', 'Payroll', 'Salary slips', 'Invoices', 'Claims', 'Loans'] };
  }

  async executeCleanup(
    customerId: number | string | null | undefined,
    userId: number | string,
    role: string,
    body: { operation?: string; confirmation?: string; idempotencyKey?: string },
  ) {
    this.assertSuperAdmin(role);
    const tenantId = this.requireTenant(customerId);
    const operation = String(body.operation || '');
    if (operation === 'duplicate-leads') {
      throw new BadRequestException('Duplicate leads are listed for review. This cleanup does not delete them.');
    }
    if (String(body.confirmation || '').trim() !== 'CLEANUP') throw new BadRequestException('Type CLEANUP to confirm.');
    const key = this.requireIdempotency(body.idempotencyKey);
    const previous = await this.findIdempotent(tenantId, key, 'DATA_CLEANUP');
    if (previous) return previous;
    const operationId = randomUUID();
    const expected = await this.cleanupCount(tenantId, operation);
    return this.withLock(tenantId, operationId, async () => {
      let deleted = 0;
      try {
        deleted = await this.cleanupDelete(tenantId, operation);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cleanup failed';
        await this.writeAudit(tenantId, userId, role, 'DATA_CLEANUP', 'FAILED', { operationId, operation, idempotencyKey: key, status: 'FAILED', error: message });
        throw new BadRequestException(`Cleanup failed. Operation ${operationId}. ${message}`);
      }
      await this.writeAudit(tenantId, userId, role, 'DATA_CLEANUP', 'SUCCESS', {
        operationId,
        operation,
        recordsDeleted: deleted,
        previewRecords: expected,
        idempotencyKey: key,
        status: 'SUCCESS',
      });
      return { success: true, operationId, status: 'SUCCESS', operation, recordsDeleted: deleted, failures: [], completedAt: new Date().toISOString() };
    });
  }

  async exportModule(customerId: number | string | null | undefined, moduleId: string, format: string) {
    const tenantId = this.requireTenant(customerId);
    const table = this.exportTable(moduleId);
    const total = await this.countTable(table, tenantId);
    if (total > MAX_ROWS) throw new BadRequestException(`Export is limited to ${MAX_ROWS} rows.`);
    const rows = (await this.delegate(this.prisma, table.model).findMany({ where: whereFor(table.where, tenantId) })).map(sanitizeRow);
    const safeFormat = format === 'excel' ? 'excel' : format === 'json' ? 'json' : 'csv';
    if (safeFormat === 'json') {
      return { fileName: `${table.model}.json`, contentType: 'application/json', body: Buffer.from(JSON.stringify(rows)) };
    }
    if (safeFormat === 'excel') {
      return { fileName: `${table.model}.xls`, contentType: 'application/vnd.ms-excel', body: Buffer.from(toExcel(rows)) };
    }
    return { fileName: `${table.model}.csv`, contentType: 'text/csv', body: Buffer.from(toCsv(rows)) };
  }

  async previewImport(customerId: number | string | null | undefined, csv: string) {
    const tenantId = this.requireTenant(customerId);
    const rows = parseCsv(csv).slice(0, 500);
    const existing = await this.prisma.lead.findMany({
      where: { customerId: tenantId, deletedAt: null },
      select: { email: true, phone: true },
      take: 5000,
    });
    const phones = new Set(existing.map((row) => normalize(row.phone)).filter(Boolean));
    const emails = new Set(existing.map((row) => normalize(row.email)).filter(Boolean));
    const seenPhone = new Set<string>();
    const seenEmail = new Set<string>();
    const preview = rows.map((row, index) => {
      const errors: string[] = [];
      if (!row.firstName || !row.lastName || !row.title) errors.push('title, firstName, and lastName are required');
      const phone = normalize(row.phone);
      const email = normalize(row.email);
      let duplicate = false;
      if (phone && (phones.has(phone) || seenPhone.has(phone))) duplicate = true;
      if (email && (emails.has(email) || seenEmail.has(email))) duplicate = true;
      if (phone) seenPhone.add(phone);
      if (email) seenEmail.add(email);
      if (duplicate) errors.push('Duplicate phone or email');
      return { row: index + 1, title: row.title || '', firstName: row.firstName || '', lastName: row.lastName || '', email: row.email || '', phone: row.phone || '', duplicate, errors };
    });
    return {
      module: 'leads',
      total: preview.length,
      valid: preview.filter((row) => row.errors.length === 0).length,
      invalid: preview.filter((row) => row.errors.length > 0).length,
      rows: preview,
      unsupported: 'Only leads can be imported. Other modules can be exported. Employee, payroll, and invoice imports are not available because they require their own business workflows.',
    };
  }

  async executeImport(
    customerId: number | string | null | undefined,
    userId: number | string,
    role: string,
    body: { csv?: string; confirmation?: string; idempotencyKey?: string },
  ) {
    this.assertSuperAdmin(role);
    const tenantId = this.requireTenant(customerId);
    if (String(body.confirmation || '').trim() !== 'IMPORT') throw new BadRequestException('Type IMPORT to confirm.');
    const key = this.requireIdempotency(body.idempotencyKey);
    const previous = await this.findIdempotent(tenantId, key, 'DATA_IMPORT');
    if (previous) return previous;
    const preview = await this.previewImport(tenantId, String(body.csv || ''));
    const ready = preview.rows.filter((row) => row.errors.length === 0);
    if (!ready.length) throw new BadRequestException('No valid lead rows to import.');
    const operationId = randomUUID();
    const createdById = Number(userId);
    if (!createdById) throw new BadRequestException('The signed-in user could not be resolved.');
    return this.withLock(tenantId, operationId, async () => {
      let created = 0;
      try {
        await this.prisma.$transaction(async (tx) => {
          let newStage = await tx.leadStage.findFirst({
            where: { customerId: tenantId, key: 'NEW', deletedAt: null, isActive: true },
            orderBy: { sortOrder: 'asc' },
          });
          if (!newStage) {
            newStage = await tx.leadStage.findFirst({
              where: { customerId: null, key: 'NEW', deletedAt: null, isActive: true },
              orderBy: { sortOrder: 'asc' },
            });
          }
          for (const row of ready) {
            const lead = await tx.lead.create({
              data: {
                customerId: tenantId,
                title: row.title.slice(0, 180),
                firstName: row.firstName.slice(0, 80),
                lastName: row.lastName.slice(0, 80),
                email: row.email || null,
                phone: row.phone || null,
                source: 'IMPORT',
                status: 'NEW',
                stageId: newStage?.id || null,
                createdById,
              },
            });
            await createLeadCreatedOutbox(tx, {
              customerId: tenantId,
              leadId: Number(lead.id),
              userId: createdById,
              stageId: newStage?.id ?? null,
              stageName: newStage?.name || 'New',
              leadName: lead.title,
              email: lead.email,
              phone: lead.phone,
            });
            created += 1;
          }
          await tx.auditLog.create({
            data: this.auditData(tenantId, userId, role, 'DATA_IMPORT', 'SUCCESS', {
              operationId,
              module: 'leads',
              recordsCreated: created,
              idempotencyKey: key,
              status: 'SUCCESS',
            }),
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed';
        await this.writeAudit(tenantId, userId, role, 'DATA_IMPORT', 'FAILED', { operationId, idempotencyKey: key, status: 'FAILED', error: message });
        throw new BadRequestException(`Import failed and was rolled back. Operation ${operationId}. ${message}`);
      }
      return { success: true, operationId, status: 'SUCCESS', recordsCreated: created, skipped: preview.invalid, failures: [], completedAt: new Date().toISOString() };
    });
  }

  async history(customerId: number | string | null | undefined) {
    const tenantId = this.optionalTenant(customerId);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: { in: ['DATA_RESET', 'DATA_BACKUP', 'DATA_RESTORE', 'DATA_CLEANUP', 'DATA_IMPORT'] },
        customerId: tenantId,
      },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return logs.map((log) => {
      const details = asObject(log.details);
      const verifiedReset = log.action === 'DATA_RESET'
        && details.verified === true
        && Array.isArray(details.modules)
        && details.modules.length > 0;
      return {
        id: details.operationId || log.id,
        operationType: log.action,
        modules: Array.isArray(details.modules) ? details.modules : (details.operation ? [details.operation] : []),
        requestedBy: log.user ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email : 'Super Admin',
        approvedBy: null,
        createdAt: log.createdAt,
        recordsAffected: log.action === 'DATA_RESET' ? (verifiedReset ? Number(details.recordsDeleted || 0) : null) : (details.recordsDeleted ?? details.recordsRestored ?? details.recordsCreated ?? 0),
        backupId: details.backupId || details.preRestoreBackupId || null,
        status: log.action === 'DATA_RESET' && log.status !== 'FAILED' && !verifiedReset
          ? 'UNVERIFIED'
          : log.status || details.status || 'UNVERIFIED',
        failureReason: details.error || null,
        verified: log.action === 'DATA_RESET' ? verifiedReset : details.verified === true,
      };
    });
  }

  job(jobId: string) {
    return this.jobs.get(jobId) || null;
  }

  private selectedModules(ids: string[] | string | undefined, all: boolean) {
    if (all) return availableModules();
    const rawIds = Array.isArray(ids)
      ? ids
      : typeof ids === 'string'
        ? ids.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const modules = [...new Set(rawIds.map(resolveModuleId))].map((id) => moduleById(id)).filter(Boolean);
    if (!modules.length) throw new BadRequestException('Select at least one module.');
    const blocked = modules.filter((item) => !item.available);
    if (blocked.length) throw new BadRequestException(blocked.map((item) => `${item.name}: ${item.reason}`).join(' '));
    return modules as typeof RESET_MODULES;
  }

  private async countModules(customerId: number | null, onUnavailable?: () => void) {
    const result = [];
    for (const item of availableModules()) {
      let records = 0;
      let complete = true;
      for (const table of item.tables) {
        try {
          records += await this.countTable(table, customerId);
        } catch (error) {
          complete = false;
          onUnavailable?.();
          this.logger.warn(`Overview count unavailable for ${table.model}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      result.push({ id: item.id, name: item.name, records, complete });
    }
    return result;
  }

  private async designationPreservation(client: object, customerId: number | null): Promise<DesignationPreservation> {
    const designationRows = await this.delegate(client, 'designation').findMany({
      where: scopedCustomer(customerId),
      select: { id: true },
    }) as Array<{ id: number }>;
    const designationIds = designationRows.map((row) => Number(row.id)).filter(Number.isInteger);
    if (!designationIds.length) {
      return { designationIds: [], roles: [], roleOwnership: { system: 0, tenant: 0, otherTenant: 0 }, roleTypes: {} };
    }
    const roleRows = await this.delegate(client, 'role').findMany({
      where: { designationId: { in: designationIds } },
      select: { id: true, designationId: true, customerId: true, type: true, name: true },
    }) as Array<{ id: number; designationId: number; customerId: number | null; type: string; name: string }>;
    const protectedDesignationIds = [...new Set(roleRows.map((role) => Number(role.designationId)).filter(Number.isInteger))].sort((a, b) => a - b);
    const roleOwnership = {
      system: roleRows.filter((role) => role.customerId == null).length,
      tenant: customerId == null ? 0 : roleRows.filter((role) => Number(role.customerId) === customerId).length,
      otherTenant: customerId == null ? roleRows.filter((role) => role.customerId != null).length : roleRows.filter((role) => role.customerId != null && Number(role.customerId) !== customerId).length,
    };
    const roleTypes = roleRows.reduce<Record<string, number>>((counts, role) => {
      const type = String(role.type || 'UNKNOWN');
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    return {
      designationIds: protectedDesignationIds,
      roles: roleRows.map((role) => ({ ...role, id: Number(role.id), designationId: Number(role.designationId), type: String(role.type || 'UNKNOWN') })),
      roleOwnership,
      roleTypes,
    };
  }

  private async countOverviewTable(table: TableRule, customerId: number, onUnavailable: () => void) {
    try {
      return await this.countTable(table, customerId);
    } catch (error) {
      onUnavailable();
      this.logger.warn(`Overview count unavailable for ${table.model}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    }
  }

  private async countProtectedRecords(customerId: number | null) {
    const tenant = customerId == null ? {} : { customerId };
    const byUserTenant = customerId == null ? {} : { user: { customerId } };
    const byRoleTenant = customerId == null ? {} : { role: { customerId } };
    const [customer, users, roles, userRoles, rolePermissions, sessions, refreshTokens, subscriptions, auditLogs,
      attendancePolicies, leavePolicies] = await Promise.all([
      this.prisma.customer.count({ where: customerId == null ? {} : { id: customerId } }),
      this.prisma.user.count({ where: tenant }),
      this.prisma.role.count({ where: tenant }),
      this.prisma.userRole.count({ where: byUserTenant }),
      this.prisma.rolePermission.count({ where: byRoleTenant }),
      this.prisma.session.count({ where: byUserTenant }),
      this.prisma.refreshToken.count({ where: byUserTenant }),
      this.prisma.customerSubscription.count({ where: tenant }),
      this.prisma.auditLog.count({ where: tenant }),
      this.prisma.attendancePolicy.count({ where: tenant }),
      this.prisma.leavePolicy.count({ where: tenant }),
    ]);
    const systemCritical = {
      customer,
      users,
      roles,
      userRoles,
      rolePermissions,
      sessions,
      refreshTokens,
      subscriptions,
      auditLogs,
    };
    const remainingTenantConfiguration = {
      attendancePolicies,
      leavePolicies,
    };
    return {
      systemCritical: {
        tables: systemCritical,
        records: Object.values(systemCritical).reduce((sum, count) => sum + count, 0),
      },
      remainingTenantConfiguration: {
        tables: remainingTenantConfiguration,
        records: Object.values(remainingTenantConfiguration).reduce((sum, count) => sum + count, 0),
      },
      note: 'Counts are row totals per protected table and are informational; shared permissions, plans, and singleton integration/payment configuration are excluded from tenant-scoped totals.',
    };
  }

  private async countTables(tables: TableRule[], customerId: number | null, client: object = this.prisma) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const table of tables) {
      const records = await this.countTable(table, customerId, client);
      counts[table.model] = records;
      total += records;
    }
    return { counts, total };
  }

  private async countTable(table: TableRule, customerId: number | null, client: object = this.prisma) {
    return this.delegate(client, table.model).count({ where: whereFor(table.where, customerId) });
  }

  /**
   * Customer is the tenant root in this schema: Employee.customerId is an FK
   * to Customer.id. Converted customer records carry their owning tenant via
   * originLead.customerId. These filters distinguish tenant ownership from
   * employee ownership (Employee.customerId).
   * An OR across both optional employee relations counts a Customer once even
   * when both references point at employees from the selected tenant.
   */
  private customerEmployeeReferenceFilters(customerId: number | null): {
    references: Prisma.CustomerWhereInput;
    tenantRoot: Prisma.CustomerWhereInput;
    sameTenantTarget: Prisma.CustomerWhereInput;
    sameTenant?: Prisma.CustomerWhereInput;
    crossTenant?: Prisma.CustomerWhereInput;
  } {
    const employeeReferences: Prisma.CustomerWhereInput[] = customerId == null
      ? [
          { assignedEmployeeRel: { isNot: null } },
          { createdByEmployeeRel: { isNot: null } },
        ]
      : [
          { assignedEmployeeRel: { customerId } },
          { createdByEmployeeRel: { customerId } },
        ];
    const references: Prisma.CustomerWhereInput = { OR: employeeReferences };

    if (customerId == null) {
      return {
        references,
        tenantRoot: {},
        sameTenantTarget: {},
      };
    }

    // A customer belongs to this tenant if:
    // 1. Root tenant record itself (id === customerId)
    // 2. Converted from a lead owned by this tenant (originLead.customerId === customerId)
    // 3. Assigned to a team belonging to this tenant (assignedTeam.customerId === customerId)
    // 4. Directly created or assigned customer referencing this tenant's employees
    //    and NOT owned by another tenant (no foreign originLead, foreign team, or foreign employees).
    const sameTenantOwnership: Prisma.CustomerWhereInput[] = [
      { id: customerId },
      { originLead: { customerId } },
      { assignedTeam: { customerId } },
      {
        AND: [
          references,
          {
            NOT: [
              { originLead: { customerId: { not: customerId } } },
              { assignedTeam: { customerId: { not: customerId } } },
              { employees: { some: { customerId: { not: customerId } } } },
            ],
          },
        ],
      },
    ];

    // Genuine cross-tenant customer: A record that references this tenant's employee,
    // but belongs to another tenant (foreign originLead, foreign assigned team, or foreign root tenant organization).
    const crossTenant: Prisma.CustomerWhereInput = {
      id: { not: customerId },
      OR: [
        { originLead: { customerId: { not: customerId } } },
        { assignedTeam: { customerId: { not: customerId } } },
        { employees: { some: { customerId: { not: customerId } } } },
      ],
      AND: [references],
    };

    return {
      references,
      tenantRoot: { id: customerId },
      sameTenantTarget: { OR: sameTenantOwnership },
      sameTenant: {
        OR: sameTenantOwnership,
        AND: [references],
      },
      crossTenant,
    };
  }

  private async acquireResetAdvisoryLock(tx: Prisma.TransactionClient, customerId: number | null) {
    const namespace = 1397771313;
    if (customerId == null) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::integer, 0::integer)`;
      return;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${namespace}::integer, 0::integer)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::integer, ${customerId}::integer)`;
  }

  private async lockResetRoots(tx: Prisma.TransactionClient, moduleIds: string[], customerId: number | null) {
    const lock = async (table: string) => {
      if (customerId == null) {
        await tx.$queryRaw(Prisma.raw(`SELECT "id" FROM "${table}" FOR UPDATE`));
      } else {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "customerId" = ${customerId} FOR UPDATE`);
      }
    };
    if (moduleIds.includes('employees')) await lock('Employee');
    if (moduleIds.includes('designations')) await lock('Designation');
    if (moduleIds.includes('departments')) await lock('Department');
  }

  private delegate(client: object, model: string) {
    const target = (client as Record<string, { count?: Function; deleteMany?: Function; findMany?: Function; create?: Function }>)[model];
    if (!target?.count || !target?.deleteMany || !target?.findMany) {
      throw new BadRequestException(`The ${model} table is not available in this database client.`);
    }
    return target as {
      count: Function;
      deleteMany: Function;
      findMany: Function;
      create: Function;
    };
  }

  private async databaseMeta() {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ name: string; bytes: bigint; tables: bigint; estimate: bigint }>>`
        SELECT current_database()::text AS name,
               pg_database_size(current_database()) AS bytes,
               (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
               (SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables) AS estimate
      `;
      const row = rows[0];
      return {
        name: row?.name || 'PostgreSQL',
        bytes: Number(row?.bytes || 0),
        tables: Number(row?.tables || 0),
        estimate: Number(row?.estimate || 0),
        healthy: true,
      };
    } catch (error) {
      this.logger.error(`Database overview failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { name: 'PostgreSQL', bytes: 0, tables: 0, estimate: 0, healthy: false };
    }
  }

  private async cleanupCount(customerId: number, operation: string) {
    const now = new Date();
    if (operation === 'expired-refresh-tokens') {
      return this.prisma.refreshToken.count({ where: { expiresAt: { lt: now }, user: { customerId } } });
    }
    if (operation === 'stale-sessions') {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return this.prisma.session.count({ where: { lastSeen: { lt: cutoff }, user: { customerId } } });
    }
    if (operation === 'stale-failed-captures') {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return this.prisma.dataCapturePlace.count({ where: { customerId, status: 'IMPORT_FAILED', updatedAt: { lt: cutoff } } });
    }
    if (operation === 'old-email-logs') {
      const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      return this.prisma.emailLog.count({ where: { customerId, createdAt: { lt: cutoff } } });
    }
    if (operation === 'duplicate-leads') {
      const leads = await this.prisma.lead.findMany({ where: { customerId, deletedAt: null, phone: { not: null } }, select: { phone: true }, take: 5000 });
      const counts = new Map<string, number>();
      leads.forEach((lead) => {
        const phone = normalize(lead.phone);
        if (!phone) return;
        counts.set(phone, (counts.get(phone) || 0) + 1);
      });
      return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
    }
    throw new BadRequestException('Unknown cleanup operation.');
  }

  private async cleanupDelete(customerId: number, operation: string) {
    const now = new Date();
    if (operation === 'expired-refresh-tokens') {
      const result = await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now }, user: { customerId } } });
      return result.count;
    }
    if (operation === 'stale-sessions') {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await this.prisma.session.deleteMany({ where: { lastSeen: { lt: cutoff }, user: { customerId } } });
      return result.count;
    }
    if (operation === 'stale-failed-captures') {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await this.prisma.dataCapturePlace.deleteMany({ where: { customerId, status: 'IMPORT_FAILED', updatedAt: { lt: cutoff } } });
      return result.count;
    }
    if (operation === 'old-email-logs') {
      const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      const result = await this.prisma.emailLog.deleteMany({ where: { customerId, createdAt: { lt: cutoff } } });
      return result.count;
    }
    throw new BadRequestException('This cleanup cannot be executed.');
  }

  private exportTable(moduleId: string): TableRule {
    const map: Record<string, string> = {
      leads: 'lead',
      'sales-crm': 'lead',
      attendance: 'attendance',
      leave: 'leaveRequest',
      expenses: 'employeeClaim',
      notifications: 'notification',
      'data-capture': 'dataCapturePlace',
    };
    const model = map[resolveModuleId(moduleId)] || map[moduleId];
    const table = RESET_MODULES.flatMap((item) => item.tables).find((item) => item.model === model);
    if (!table) throw new BadRequestException('This module cannot be exported. Supported exports: leads, attendance, leave, expenses, notifications, and data capture.');
    return table;
  }

  private takePreview(token: string | undefined, customerId: number | null, scope: 'tenant' | 'global') {
    const preview = token ? this.previews.get(token) : undefined;
    if (!preview || preview.expiresAt < Date.now()) throw new BadRequestException('The reset preview expired. Run it again.');
    if (preview.customerId !== customerId || preview.scope !== scope) throw new ForbiddenException('The reset preview belongs to a different tenant.');
    return { ...preview, modules: [...preview.modules].sort() };
  }

  private async findIdempotent(customerId: number | null, key: string, action: string) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        ...(customerId ? { customerId } : { customerId: null }),
        action,
        status: 'SUCCESS',
        details: { path: ['idempotencyKey'], equals: key },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) return null;
    const details = asObject(existing.details);
    if (action === 'DATA_RESET'
      && (details.verified !== true || !Array.isArray(details.modules) || details.modules.length === 0)) {
      return null;
    }
    return {
      success: true,
      duplicate: true,
      operationId: details.operationId || existing.id,
      status: 'SUCCESS',
      ...(action === 'DATA_RESET' ? {
        scope: details.scope,
        modules: details.modules,
        recordsDeleted: Number(details.recordsDeleted || 0),
        tables: details.tables || {},
        countsBefore: details.countsBefore || {},
        countsAfter: details.countsAfter || {},
        verified: true,
        verifiedTables: Object.keys(details.tables || {}),
        backupId: details.backupId || null,
      } : {}),
      completedAt: existing.createdAt,
    };
  }

  private async latestAudit(customerId: number | null, action: string) {
    return this.prisma.auditLog.findFirst({
      where: { action, customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async backupMeta(customerId: number | null, backupId: string) {
    this.assertBackupId(backupId);
    const log = await this.prisma.auditLog.findFirst({
      where: {
        action: 'DATA_BACKUP',
        ...(customerId ? { customerId } : { customerId: null }),
        details: { path: ['backupId'], equals: backupId },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!log) throw new NotFoundException('Backup not found for this tenant.');
    const details = asObject(log.details);
    return {
      checksum: String(details.checksum || ''),
      modules: Array.isArray(details.modules) ? details.modules as string[] : [],
      scope: String(details.scope || 'tenant'),
      status: String(details.status || ''),
      customerId: log.customerId,
      createdAt: details.createdAt || log.createdAt,
    };
  }

  private async writeBackup(customerId: number | null, backupId: string, payload: BackupPayload) {
    const body = Buffer.from(JSON.stringify(payload));
    const compressed = gzipSync(body);
    const checksum = createHash('sha256').update(compressed).digest('hex');
    const directory = this.backupDirectory(customerId);
    await mkdir(directory, { recursive: true });
    const fileName = `${backupId}.json.gz`;
    const path = join(directory, fileName);
    const temporary = `${path}.partial`;
    await writeFile(temporary, compressed);
    await rename(temporary, path);
    const info = await stat(path);
    if (info.size <= 0) throw new BadRequestException('Backup file is empty.');
    return { path, fileName, checksum, size: info.size };
  }

  private async verifyFile(path: string, checksum: string, customerId: number | null, backupId: string) {
    try {
      const info = await stat(path);
      if (info.size <= 0) return { ok: false, reason: 'Backup file is empty.', size: 0 };
      const compressed = await readFile(path);
      const actual = createHash('sha256').update(compressed).digest('hex');
      if (!checksum || actual !== checksum) return { ok: false, reason: 'Checksum does not match.', size: info.size };
      const payload = JSON.parse(gunzipSync(compressed).toString('utf8')) as BackupPayload;
      if (payload.version !== 1 || payload.backupId !== backupId || payload.customerId !== customerId) {
        return { ok: false, reason: 'Backup metadata does not match this tenant.', size: info.size };
      }
      return { ok: true, reason: '', size: info.size };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Backup file is unreadable.', size: 0 };
    }
  }

  private async readPayload(path: string) {
    const compressed = await readFile(path);
    return JSON.parse(gunzipSync(compressed).toString('utf8')) as BackupPayload;
  }

  private backupDirectory(customerId: number | null) {
    return join(process.cwd(), 'storage', 'data-backups', customerId == null ? 'global' : String(customerId));
  }

  private backupPath(customerId: number | null, backupId: string) {
    this.assertBackupId(backupId);
    return join(this.backupDirectory(customerId), `${backupId}.json.gz`);
  }

  private assertBackupId(backupId: string) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(backupId || ''))) throw new BadRequestException('Invalid backup id.');
  }

  private requireIdempotency(value: string | undefined) {
    const key = String(value || '').trim();
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new BadRequestException('A unique idempotency key is required.');
    return key;
  }

  private requireTenant(customerId: number | string | null | undefined) {
    const tenantId = Number(customerId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Select a tenant before managing data. This action is limited to one organization.');
    }
    return tenantId;
  }

  private optionalTenant(customerId: number | string | null | undefined) {
    const tenantId = Number(customerId);
    return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
  }

  private assertSuperAdmin(role: string) {
    if (String(role || '').toUpperCase() !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can run this data operation.');
    }
  }

  private async withLock<T>(customerId: number | null, operationId: string, work: () => Promise<T>) {
    const lock = customerId == null ? 'global' : String(customerId);
    if (this.active.has(lock)) {
      throw new BadRequestException(`Another data operation is already running (${this.active.get(lock)}).`);
    }
    this.active.set(lock, operationId);
    this.jobs.set(operationId, { id: operationId, status: 'RUNNING' });
    try {
      const result = await work();
      this.jobs.set(operationId, { id: operationId, status: 'SUCCESS', result });
      return result;
    } catch (error) {
      this.jobs.set(operationId, { id: operationId, status: 'FAILED', error: error instanceof Error ? error.message : 'Failed' });
      throw error;
    } finally {
      this.active.delete(lock);
    }
  }

  private dependencies(moduleIds: string[]) {
    const notes = [
      'Child records are deleted before the records they belong to.',
      'Selecting overlapping modules does not delete the same table twice.',
    ];
    if (moduleIds.includes('sales-crm') || moduleIds.includes('leads-deals')) {
      notes.push('Deals and quotations that belong to the selected leads are included.');
    }
    if (moduleIds.includes('customers')) {
      notes.push('CRM companies and contacts are included. The tenant account, users, and subscription stay.');
    }
    if (moduleIds.includes('payroll') || moduleIds.includes('expenses')) {
      notes.push('Payroll slips, claims, and loans are included only because their module was selected. Cleanup never removes them for age alone.');
    }
    if (moduleIds.includes('employees')) {
      notes.push('Employee dependency counts are checked before deletion. Selected eligible dependent modules are deleted first; protected or unselected references block employee deletion.');
    }
    return notes;
  }

  private dependencySnapshot(warnings: Array<Record<string, unknown>>) {
    const snapshot = warnings.map((item) => {
      const resolutionModule = item.resolutionModule && typeof item.resolutionModule === 'object'
        ? item.resolutionModule as Record<string, unknown>
        : {};
      return {
        module: String(item.module || ''),
        model: String(item.model || ''),
        records: Number(item.records || 0),
        crossTenantRecords: Number(item.crossTenantRecords || 0),
        resolvedRecords: Number(item.resolvedRecords || 0),
        unresolvedRecords: Number(item.unresolvedRecords || 0),
        preservedRecords: Number(item.preservedRecords || 0),
        blocking: Boolean(item.blocking),
        policy: typeof item.policy === 'string' ? item.policy : null,
        willSetNull: Boolean(item.willSetNull),
        includedInSelectedModule: Boolean(item.includedInSelectedModule),
        preserved: Boolean(item.preserved),
        untracked: Boolean(item.untracked),
        resolutionModuleId: typeof resolutionModule.id === 'string' ? resolutionModule.id : null,
      };
    }).sort((left, right) => `${left.module}:${left.model}`.localeCompare(`${right.module}:${right.model}`));
    return JSON.stringify(snapshot);
  }

  private async dependencyWarnings(moduleIds: string[], customerId: number | null, client: object = this.prisma) {
    const selected = new Set(tablesForModules(moduleIds).map((table) => table.model));
    const checks: Array<{
      parent: string; model: string; label: string; where: Record<string, unknown>;
      crossTenantWhere?: Record<string, unknown>; policy?: 'cascade' | 'set-null' | 'protected'; allowSameModelSelection?: boolean;
    }> = [];
    const scoped = scopedCustomer(customerId);
    const employeeRelation = { employee: customerId == null ? {} : { customerId } };
    const designationState = moduleIds.includes('designations')
      ? await this.designationPreservation(client, customerId)
      : null;
    const protectedDesignationSet = new Set(designationState?.designationIds || []);
    if (moduleIds.includes('employees')) {
      for (const [model, label] of [
        ['attendance', 'Attendance'], ['leaveRequest', 'Leave applications'], ['salaryStructure', 'Salary structures'],
        ['salarySlip', 'Payslips'], ['payrollItem', 'Payroll transactions'], ['employeeLoan', 'Employee loans'],
        ['commission', 'Commissions'], ['commissionWithdrawal', 'Commission withdrawals'], ['employeeClaim', 'Employee claims'],
        ['employeeLocation', 'Location history'], ['remoteRequest', 'Remote work requests'], ['overtimeRequest', 'Overtime requests'], ['visit', 'Visits'],
        ['overtimeNotificationEvent', 'Overtime notification events'], ['workAccessRequest', 'Work access requests'],
        ['employeeDeduction', 'Payroll deductions'], ['employeeLeaveBalance', 'Leave balances'], ['leaveAdjustmentHistory', 'Leave adjustments'],
        ['teamMember', 'Team memberships'], ['employeeModuleOverride', 'Employee permission overrides'], ['employeeLeadLimit', 'Employee lead limits'],
        ['salaryTargetPolicy', 'Salary target policies'], ['salaryTargetReview', 'Salary target reviews'],
        ['hrmEmployeeMonthlyReport', 'Employee report history'], ['hrmLeaveMonthlySnapshot', 'Leave snapshots'],
        ['hrmNotificationDelivery', 'Notification history'], ['hrmCommissionMonthlySnapshot', 'Commission snapshots'],
        ['dataCaptureSearch', 'Data capture searches'], ['commissionConfig', 'Employee commission configuration'],
      ] as const) {
        // TeamMember has no customerId: tenant ownership is through Team.
        // Employee ownership identifies the memberships affected by an employee reset.
        const ownerRelation = model === 'teamMember'
          ? { employee: customerId == null ? {} : { customerId } }
          : employeeRelation;
        const crossTenantWhere = customerId == null
          ? undefined
          : model === 'teamMember'
            ? { team: { customerId: { not: customerId } }, employee: { customerId } }
            : model === 'commission'
              ? {
                  customerId: { not: customerId },
                  employee: { customerId },
                  NOT: [
                    { customer: { originLead: { customerId } } },
                    { customer: { assignedEmployeeRel: { customerId } } },
                    { customer: { createdByEmployeeRel: { customerId } } },
                    { customer: { assignedTeam: { customerId } } },
                    { lead: { customerId } },
                  ],
                }
              : { customerId: { not: customerId }, ...ownerRelation };
        checks.push({
          parent: 'employees', model, label, where: ownerRelation,
          ...(crossTenantWhere ? { crossTenantWhere } : {}),
          policy: 'cascade',
        });
      }
      checks.push({ parent: 'employees', model: 'overtimeApproval', label: 'Overtime approval history', where: { request: { employee: customerId == null ? {} : { customerId } } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, request: { employee: { customerId } } } }), policy: 'cascade' });
      checks.push({ parent: 'employees', model: 'workTask', label: 'Work task assignee references', where: { assignedTo: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { work: { customerId: { not: customerId } }, assignedTo: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'lead', label: 'Lead assignment and conversion references', where: { ...scoped, OR: [{ employee: customerId == null ? { isNot: null } : { customerId } }, { convertedByEmployee: customerId == null ? { isNot: null } : { customerId } }] }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, OR: [{ employee: { customerId } }, { convertedByEmployee: { customerId } }] } }), policy: 'set-null' });

      const employeeRows = await (client as Prisma.TransactionClient).employee.findMany({ where: scoped, select: { id: true } });
      const employeeIds = employeeRows.map((item) => Number(item.id)).filter(Number.isInteger);
      if (employeeIds.length) {
        checks.push({ parent: 'employees', model: 'taskProof', label: 'Task proof uploader references', where: { employeeId: { in: employeeIds }, ...(customerId == null ? {} : { task: { customerId } }) }, ...(customerId == null ? {} : { crossTenantWhere: { employeeId: { in: employeeIds }, task: { customerId: { not: customerId } } } }), policy: 'set-null' });
        checks.push({ parent: 'employees', model: 'locationTrackingSetting', label: 'Location tracking settings', where: { employeeId: { in: employeeIds } }, ...(customerId == null ? {} : { crossTenantWhere: { employeeId: { in: employeeIds }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'employees', model: 'department', label: 'Department head references', where: { headId: { in: employeeIds } }, ...(customerId == null ? {} : { crossTenantWhere: { headId: { in: employeeIds }, customerId: { not: customerId } } }), policy: 'set-null' });
        const shareRows = await (client as Prisma.TransactionClient).$queryRaw<Array<{ records: number | bigint }>>(Prisma.sql`SELECT COUNT(*)::int AS records FROM "commission_shares" WHERE "employeeId" IN (${Prisma.join(employeeIds)})`);
        const shareCount = Number(shareRows[0]?.records || 0);
        if (shareCount) checks.push({ parent: 'employees', model: 'commission_shares', label: 'Commission shares (protected financial records)', where: {}, policy: 'protected' });
        if (shareCount) checks[checks.length - 1].where.records = shareCount;
      }
      const customerReferenceFilters = this.customerEmployeeReferenceFilters(customerId);
      checks.push({
        parent: 'employees',
        model: 'customer',
        label: 'Customer employee assignments and creator references',
        where: customerReferenceFilters.references,
        ...(customerReferenceFilters.crossTenant
          ? { crossTenantWhere: customerReferenceFilters.crossTenant }
          : {}),
        policy: 'set-null',
      });
      checks.push({ parent: 'employees', model: 'work', label: 'Work assignee references', where: { assignedTo: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, assignedTo: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'work', label: 'Work editor references', where: { editor: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, editor: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'team', label: 'Team leader references', where: { leader: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, leader: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'monthlySchedule', label: 'Monthly schedule assignee references', where: { assignedEmployee: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, assignedEmployee: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'task', label: 'Task employee references', where: { employee: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, employee: { customerId } } }), policy: 'set-null' });
      checks.push({ parent: 'employees', model: 'visitPhoto', label: 'Visit photo employee references', where: { employee: customerId == null ? {} : { customerId } }, ...(customerId == null ? {} : { crossTenantWhere: { customerId: { not: customerId }, employee: { customerId } } }), policy: 'set-null' });
    }
    if (moduleIds.includes('departments')) {
      const rows = await (client as Prisma.TransactionClient).department.findMany({ where: scoped, select: { id: true } });
      const ids = rows.map((item) => Number(item.id)).filter(Number.isInteger);
      if (ids.length) {
        checks.push({ parent: 'departments', model: 'employee', label: 'Employees assigned to departments', where: { departmentId: { in: ids } }, ...(customerId == null ? {} : { crossTenantWhere: { departmentId: { in: ids }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'departments', model: 'designation', label: 'Designations assigned to departments', where: { departmentId: { in: ids } }, ...(customerId == null ? {} : { crossTenantWhere: { departmentId: { in: ids }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'departments', model: 'task', label: 'Tasks assigned to departments', where: { departmentId: { in: ids } }, ...(customerId == null ? {} : { crossTenantWhere: { departmentId: { in: ids }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'departments', model: 'announcement', label: 'Department announcements', where: { departmentId: { in: ids } }, ...(customerId == null ? {} : { crossTenantWhere: { departmentId: { in: ids }, customerId: { not: customerId } } }), policy: 'cascade' });
      }
    }
    if (moduleIds.includes('designations')) {
      const rows = await (client as Prisma.TransactionClient).designation.findMany({ where: scoped, select: { id: true } });
      const ids = rows.map((item) => Number(item.id)).filter(Number.isInteger);
      const eligibleIds = ids.filter((id) => !protectedDesignationSet.has(id));
      if (eligibleIds.length) {
        checks.push({ parent: 'designations', model: 'employee', label: 'Employees assigned to designations', where: { designationId: { in: eligibleIds } }, ...(customerId == null ? {} : { crossTenantWhere: { designationId: { in: eligibleIds }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'designations', model: 'task', label: 'Tasks assigned to designations', where: { designationId: { in: eligibleIds } }, ...(customerId == null ? {} : { crossTenantWhere: { designationId: { in: eligibleIds }, customerId: { not: customerId } } }), policy: 'cascade' });
        checks.push({ parent: 'designations', model: 'customer', label: 'Customer mobile-role references (protected)', where: { mobileRoleId: { in: eligibleIds } }, ...(customerId == null ? {} : { crossTenantWhere: { id: { not: customerId }, NOT: { originLead: { customerId } }, mobileRoleId: { in: eligibleIds } } }), policy: 'protected' });
      }
    }
    if (moduleIds.includes('commission-configurations')) {
      const configs = await (client as Prisma.TransactionClient).commissionConfig.findMany({
        where: scoped,
        select: { id: true },
      });
      const configIds = configs.map((row) => Number(row.id)).filter(Number.isInteger);
      if (configIds.length) {
        checks.push({
          parent: 'commission-configurations', model: 'commissionSlab', label: 'Slabs linked to employee commission configurations',
          where: { configurationId: { in: configIds } },
          ...(customerId == null ? {} : { crossTenantWhere: { configurationId: { in: configIds }, customerId: { not: customerId } } }),
          policy: 'cascade',
        });
      }
      if (customerId != null) {
        checks.push({
          parent: 'commission-configurations', model: 'commissionSlab', label: 'Commission slabs linked to another tenant configuration',
          where: { customerId, configuration: { customerId: { not: customerId } } },
          policy: 'protected',
        });
      }
    }
    const warnings: Array<Record<string, unknown>> = [];
    for (const check of checks) {
      if (check.model === 'commission_shares') {
        const records = Number(check.where.records || 0);
        warnings.push({ module: check.parent, model: check.model, label: check.label, records, blocking: true, willSetNull: false, includedInSelectedModule: false, untracked: true });
        continue;
      }
      const scopedRecords = Number(await this.delegate(client, check.model).count({ where: check.where }));
      const crossTenantRecords = check.crossTenantWhere
        ? Number(await this.delegate(client, check.model).count({ where: check.crossTenantWhere }))
        : 0;
      // The primary predicate follows the referenced employee/designation and can include
      // rows owned by other tenants. Cross-tenant rows are a subset of that total.
      const records = Math.max(scopedRecords, crossTenantRecords);
      if (!records) continue;
      const included = selected.has(check.model) && (check.parent !== check.model || check.allowSameModelSelection === true);
      const policy = check.policy || 'cascade';
      const blocking = policy === 'protected' || crossTenantRecords > 0 || (policy === 'cascade' && !included);
      const sameTenantRecords = Math.max(0, scopedRecords - crossTenantRecords);
      const resolvedRecords = policy === 'protected'
        ? 0
        : policy === 'set-null'
          ? sameTenantRecords
          : included
            ? sameTenantRecords
            : 0;
      const unresolvedRecords = Math.max(0, records - resolvedRecords);
      const resolutionModule = !included && policy === 'cascade'
        ? RESET_MODULES.find((item) => item.tables.some((table) => table.model === check.model))
        : undefined;
      const moduleName = resolutionModule?.name || check.parent;
      const isProtected = policy === 'protected';
      const reason = blocking
        ? crossTenantRecords > 0
          ? `${crossTenantRecords.toLocaleString()} cross-tenant reference${crossTenantRecords === 1 ? '' : 's'} belong to other tenant-owned records.`
          : isProtected
            ? 'Protected record; excluded from deletion.'
            : policy === 'cascade' && !included
              ? `Select ${moduleName} to include ${sameTenantRecords.toLocaleString()} dependent record${sameTenantRecords === 1 ? '' : 's'}.`
              : 'Unresolved dependency must be resolved before reset.'
        : 'Resolved for this reset.';
      const recommendedAction = blocking
        ? crossTenantRecords > 0
          ? 'The administrator of each owning tenant must reassign or remove the employee reference; this reset will leave those records unchanged.'
          : isProtected
            ? 'Leave the protected module out of this reset or manage references through authorized administrative tools.'
            : policy === 'cascade' && !included
              ? `Select ${moduleName} in the reset module selection to include and clean up dependent records.`
              : 'Resolve all dependent references before executing reset.'
        : null;

      warnings.push({
        module: check.parent,
        model: check.model,
        label: check.label,
        records,
        crossTenantRecords,
        sameTenantRecords,
        blocking,
        resolvedRecords,
        unresolvedRecords,
        policy,
        ...(resolutionModule ? { resolutionModule: { id: resolutionModule.id, name: resolutionModule.name } } : {}),
        willSetNull: policy === 'set-null' && sameTenantRecords > 0,
        includedInSelectedModule: included,
        reason,
        recommendedAction,
        owningTenantInfo: crossTenantRecords > 0 ? 'Other Tenant Accounts' : null,
      });
    }
    if (designationState?.roles.length) {
      warnings.push({
        module: 'designations',
        model: 'role',
        label: 'Roles linked to designations (protected; designation preserved)',
        records: designationState.roles.length,
        resolvedRecords: 0,
        unresolvedRecords: 0,
        preservedRecords: designationState.roles.length,
        preserved: true,
        blocking: false,
        policy: 'protected',
        reason: 'Role.designationId uses ON DELETE CASCADE. The linked designations are excluded from deletion to preserve these roles.',
        roleOwnership: designationState.roleOwnership,
          roleTypes: designationState.roleTypes,
          roles: designationState.roles.map(({ id, name, type, customerId: roleCustomerId }) => ({
            id,
            name,
            type,
            owner: roleCustomerId == null ? 'system' : roleCustomerId === customerId ? 'current tenant' : 'other tenant',
          })),
      });
    }
    return warnings;
  }

  private auditData(
    customerId: number | null,
    userId: number | string,
    role: string,
    action: string,
    status: string,
    details: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    const numericUser = Number(userId);
    return {
      customerId,
      userId: Number.isInteger(numericUser) && numericUser > 0 ? numericUser : null,
      userRole: role || 'SUPER_ADMIN',
      action,
      module: 'DATA_MANAGEMENT',
      status,
      description: `${action} ${status}`,
      details: details as Prisma.InputJsonValue,
    };
  }

  private async writeAudit(
    customerId: number | null,
    userId: number | string,
    role: string,
    action: string,
    status: string,
    details: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({ data: this.auditData(customerId, userId, role, action, status, details) });
  }
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return {};
}

function sanitizeRow(row: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    if (SENSITIVE_KEY.test(key)) return;
    if (value instanceof Date) next[key] = value.toISOString();
    else if (value && typeof value === 'object' && typeof (value as { toFixed?: unknown }).toFixed === 'function' && (value as object).constructor?.name === 'Decimal') next[key] = String(value);
    else next[key] = value;
  });
  return next;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] || {});
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  });
  return lines.join('\n');
}

function csvCell(value: unknown) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toExcel(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] || {});
  const header = `<Row>${headers.map((item) => `<Cell><Data ss:Type="String">${escapeXml(item)}</Data></Cell>`).join('')}</Row>`;
  const body = rows.map((row) => `<Row>${headers.map((item) => `<Cell><Data ss:Type="String">${escapeXml(row[item] == null ? '' : typeof row[item] === 'object' ? JSON.stringify(row[item]) : String(row[item]))}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Export"><Table>${header}${body}</Table></Worksheet></Workbook>`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseCsv(csv: string) {
  const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsv(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsv(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = cells[index] || ''; });
    return row;
  });
}

function splitCsv(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}
