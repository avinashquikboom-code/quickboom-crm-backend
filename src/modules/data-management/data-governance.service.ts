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
const BACKUP_TTL_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_KEY = /password|secret|token|apiKey|credential/i;

type PreviewRecord = {
  customerId: number | null;
  scope: 'tenant' | 'global';
  modules: string[];
  counts: Record<string, number>;
  estimatedRecords: number;
  expiresAt: number;
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
  private readonly jobs = new Map<string, Record<string, unknown>>();

  constructor(private readonly prisma: PrismaService) {
    assertCatalogSafe();
  }

  async overview(customerId: number | string | null | undefined) {
    const tenantId = this.optionalTenant(customerId);
    const meta = await this.databaseMeta();
    const modules = tenantId ? await this.countModules(tenantId) : [];
    const uniqueTables = tenantId ? tablesForModules(availableModules().map((item) => item.id)) : [];
    let tenantRecords = 0;
    for (const table of uniqueTables) tenantRecords += await this.countTable(table, tenantId);
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
    body: { modules?: string[]; scope?: string },
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
    const estimatedRecords = tables.reduce((sum, table) => sum + table.records, 0);
    const previewToken = randomUUID();
    this.previews.set(previewToken, {
      customerId: tenantId,
      scope: scope === 'global' ? 'global' : 'tenant',
      modules: modules.map((item) => item.id),
      counts,
      estimatedRecords,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
    const backup = await this.latestVerifiedBackup(tenantId, modules.map((item) => item.id), scope === 'global');
    return {
      previewToken,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      scope: scope === 'global' ? 'global' : 'tenant',
      modules: modules.map((item) => ({
        id: item.id,
        name: item.name,
        records: item.tables.reduce((sum, table) => sum + (counts[table.model] || 0), 0),
      })),
      tables,
      estimatedRecords,
      dependencies: this.dependencies(modules.map((item) => item.id)),
      protected: PROTECTED_RECORDS,
      backupStatus: backup
        ? { verified: true, backupId: backup.backupId, createdAt: backup.createdAt }
        : { verified: false, backupId: null, createdAt: null },
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
      backupId?: string;
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
    if (String(body.confirmation || '').trim() !== 'RESET') {
      throw new BadRequestException('Type RESET to confirm deletion.');
    }
    if (scope !== 'selected' && String(body.acknowledgement || '').trim() !== 'RESET ALL DATA') {
      throw new BadRequestException('Type RESET ALL DATA to confirm a full data reset.');
    }
    if (scope === 'global' && String(body.globalConfirmation || '').trim() !== 'RESET GLOBAL') {
      throw new BadRequestException('Type RESET GLOBAL to confirm a reset across every tenant.');
    }
    const key = this.requireIdempotency(body.idempotencyKey);
    const previous = await this.findIdempotent(tenantId, key);
    if (previous) return previous;
    const preview = this.takePreview(body.previewToken, tenantId, scope === 'global' ? 'global' : 'tenant');
    const modules = this.selectedModules(body.modules, scope === 'application' || scope === 'global');
    const moduleIds = modules.map((item) => item.id).sort();
    if (preview.modules.join(',') !== moduleIds.join(',')) {
      throw new BadRequestException('The preview does not match the selected modules. Run the preview again.');
    }
    await this.assertBackupCovers(tenantId, body.backupId, moduleIds, scope === 'global');
    const recount = await this.countTables(tablesForModules(moduleIds), tenantId);
    if (recount.total !== preview.estimatedRecords) {
      throw new BadRequestException('Records changed after the preview. Run the preview again before deleting.');
    }
    const operationId = randomUUID();
    this.previews.delete(body.previewToken as string);
    return this.withLock(tenantId, operationId, async () => {
      const deleted: Record<string, number> = {};
      const failures: string[] = [];
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const table of tablesForModules(moduleIds)) {
            const result = await this.delegate(tx, table.model).deleteMany({ where: whereFor(table.where, tenantId) });
            deleted[table.model] = Number(result?.count || 0);
          }
          await tx.auditLog.create({
            data: this.auditData(tenantId, userId, role, 'DATA_RESET', 'SUCCESS', {
              operationId,
              scope,
              modules: moduleIds,
              recordsDeleted: Object.values(deleted).reduce((sum, count) => sum + count, 0),
              tables: deleted,
              backupId: body.backupId,
              idempotencyKey: key,
              reason: body.reason || 'Admin data reset',
              status: 'SUCCESS',
            }),
          });
        }, { timeout: 120000, maxWait: 10000 });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Reset failed');
        await this.writeAudit(tenantId, userId, role, 'DATA_RESET', 'FAILED', {
          operationId,
          scope,
          modules: moduleIds,
          backupId: body.backupId,
          idempotencyKey: key,
          status: 'FAILED',
          error: failures[0],
        });
        throw new BadRequestException(`Reset failed and was rolled back. Operation ${operationId}. ${failures[0]}`);
      }
      const recordsDeleted = Object.values(deleted).reduce((sum, count) => sum + count, 0);
      this.logger.log(`Data reset ${operationId} removed ${recordsDeleted} records`);
      return {
        success: true,
        operationId,
        status: 'SUCCESS',
        scope,
        modules: moduleIds,
        recordsDeleted,
        tables: deleted,
        failures,
        backupId: body.backupId,
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
      rows.push({
        id: details.backupId,
        operationId: details.operationId || log.id,
        name: details.name || 'Backup',
        description: details.description || '',
        scope: details.scope || 'tenant',
        modules: details.modules || [],
        status: exists && details.status === 'VERIFIED' ? 'VERIFIED' : 'MISSING',
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
    const previous = await this.findIdempotent(tenantId, key);
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
    const previous = await this.findIdempotent(tenantId, key);
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
    const previous = await this.findIdempotent(tenantId, key);
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
          for (const row of ready) {
            await tx.lead.create({
              data: {
                customerId: tenantId,
                title: row.title.slice(0, 180),
                firstName: row.firstName.slice(0, 80),
                lastName: row.lastName.slice(0, 80),
                email: row.email || null,
                phone: row.phone || null,
                source: 'IMPORT',
                createdById,
              },
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
      return {
        id: details.operationId || log.id,
        operationType: log.action,
        modules: details.modules || (details.operation ? [details.operation] : []),
        requestedBy: log.user ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email : 'Super Admin',
        approvedBy: null,
        createdAt: log.createdAt,
        recordsAffected: details.recordsDeleted ?? details.recordsRestored ?? details.recordsCreated ?? details.recordCount ?? 0,
        backupId: details.backupId || details.preRestoreBackupId || null,
        status: log.status || details.status || 'SUCCESS',
        failureReason: details.error || null,
      };
    });
  }

  job(jobId: string) {
    return this.jobs.get(jobId) || null;
  }

  async assertBackupCovers(customerId: number | null, backupId: string | undefined, moduleIds: string[], global = false) {
    if (!backupId) throw new BadRequestException('A verified backup is required before this reset.');
    const meta = await this.backupMeta(global ? null : customerId, backupId);
    if (meta.status !== 'VERIFIED') throw new BadRequestException('The selected backup is not verified.');
    if (global && meta.scope !== 'global') throw new BadRequestException('A global reset requires a verified global backup.');
    if (!global && meta.scope === 'global') throw new BadRequestException('A tenant reset cannot use a global backup.');
    const createdAt = new Date(String(meta.createdAt || 0)).getTime();
    if (!createdAt || Date.now() - createdAt > BACKUP_TTL_MS) {
      throw new BadRequestException('The backup is older than 24 hours. Create a new backup before deleting data.');
    }
    const covered = new Set((meta.modules as string[]) || []);
    const missing = moduleIds.filter((id) => !covered.has(id));
    if (missing.length) throw new BadRequestException(`The backup does not include: ${missing.join(', ')}`);
    const file = this.backupPath(meta.customerId, backupId);
    const checked = await this.verifyFile(file, String(meta.checksum || ''), meta.customerId, backupId);
    if (!checked.ok) throw new BadRequestException(`Backup verification failed. ${checked.reason}`);
  }

  private async latestVerifiedBackup(customerId: number | null, moduleIds: string[], global: boolean) {
    const rows = await this.listBackups(customerId);
    return rows.find((row) => {
      if (row.status !== 'VERIFIED') return false;
      if (global && row.scope !== 'global') return false;
      if (!global && row.scope === 'global') return false;
      if (Date.now() - new Date(row.createdAt).getTime() > BACKUP_TTL_MS) return false;
      const covered = new Set(row.modules as string[]);
      return moduleIds.every((id) => covered.has(id));
    }) || null;
  }

  private selectedModules(ids: string[] | undefined, all: boolean) {
    if (all) return availableModules();
    const modules = [...new Set((ids || []).map(resolveModuleId))].map((id) => moduleById(id)).filter(Boolean);
    if (!modules.length) throw new BadRequestException('Select at least one module.');
    const blocked = modules.filter((item) => !item.available);
    if (blocked.length) throw new BadRequestException(blocked.map((item) => `${item.name}: ${item.reason}`).join(' '));
    return modules as typeof RESET_MODULES;
  }

  private async countModules(customerId: number | null) {
    const result = [];
    for (const item of availableModules()) {
      let records = 0;
      for (const table of item.tables) records += await this.countTable(table, customerId);
      result.push({ id: item.id, name: item.name, records });
    }
    return result;
  }

  private async countTables(tables: TableRule[], customerId: number | null) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const table of tables) {
      const records = await this.countTable(table, customerId);
      counts[table.model] = records;
      total += records;
    }
    return { counts, total };
  }

  private async countTable(table: TableRule, customerId: number | null) {
    return this.delegate(this.prisma, table.model).count({ where: whereFor(table.where, customerId) });
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

  private async findIdempotent(customerId: number | null, key: string) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        ...(customerId ? { customerId } : { customerId: null }),
        status: 'SUCCESS',
        details: { path: ['idempotencyKey'], equals: key },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) return null;
    const details = asObject(existing.details);
    return { success: true, duplicate: true, operationId: details.operationId || existing.id, status: 'SUCCESS', completedAt: existing.createdAt };
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
    return notes;
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
