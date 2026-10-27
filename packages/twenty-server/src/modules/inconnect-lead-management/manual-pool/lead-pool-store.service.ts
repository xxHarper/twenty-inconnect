import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { isLeadPoolStorageLayoutReady } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-storage-layout';
import { discardLeadPoolConnection } from 'src/modules/inconnect-lead-management/manual-pool/discard-lead-pool-connection';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import {
  parsePoolInput,
  storedPoolSchema,
  type StoredLeadPool,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-contract';

export type LeadPoolStoredRow = {
  id: string;
  requestHash: string;
  state: StoredLeadPool;
};
const TABLE = '"core"."inconnectLeadPoolOperation"';

@Injectable()
export class LeadPoolStoreService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orm: GlobalWorkspaceOrmManager,
  ) {}

  async ready(): Promise<boolean> {
    try {
      await this.dataSource.query(
        `SELECT "id", "workspaceId", "actorUserId", "actorWorkspaceMemberId", "intentionId", "requestHash", "state", "createdAt", "updatedAt" FROM ${TABLE} LIMIT 0`,
      );
      const rows: { layout: unknown }[] = await this.dataSource.query(`
        SELECT jsonb_build_object(
          'schema', namespace_row.nspname, 'table', table_row.relname,
          'kind', table_row.relkind, 'rowSecurity', table_row.relrowsecurity,
          'columns', (SELECT jsonb_agg(jsonb_build_object(
            'name', attribute.attname, 'type', CASE WHEN type_namespace.nspname = 'pg_catalog' THEN type_row.typname ELSE type_namespace.nspname || '.' || type_row.typname END,
            'notNull', attribute.attnotnull,
            'defaultExpression', pg_get_expr(default_value.adbin, default_value.adrelid),
            'generated', attribute.attgenerated, 'identity', attribute.attidentity
          )) FROM pg_attribute attribute JOIN pg_type type_row ON type_row.oid = attribute.atttypid
          JOIN pg_namespace type_namespace ON type_namespace.oid = type_row.typnamespace
          LEFT JOIN pg_attrdef default_value ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
          WHERE attribute.attrelid = table_row.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped),
          'constraints', (SELECT jsonb_agg(jsonb_build_object(
            'kind', constraint_row.contype, 'deferrable', constraint_row.condeferrable,
            'validated', constraint_row.convalidated,
            'columns', (SELECT jsonb_agg(attribute.attname ORDER BY key.ordinality)
              FROM unnest(constraint_row.conkey) WITH ORDINALITY key(number, ordinality)
              JOIN pg_attribute attribute ON attribute.attrelid = table_row.oid AND attribute.attnum = key.number),
            'indexValid', (SELECT index_row.indisvalid AND index_row.indisready AND index_row.indisunique
              AND index_row.indpred IS NULL AND index_row.indexprs IS NULL FROM pg_index index_row WHERE index_row.indexrelid = constraint_row.conindid),
            'definition', pg_get_constraintdef(constraint_row.oid)
          )) FROM pg_constraint constraint_row WHERE constraint_row.conrelid = table_row.oid)
        ) AS layout FROM pg_class table_row
        JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
        WHERE namespace_row.nspname = 'core' AND table_row.relname = 'inconnectLeadPoolOperation'`);
      return rows.length === 1 && isLeadPoolStorageLayoutReady(rows[0].layout);
    } catch {
      return false;
    }
  }

  async transaction<TValue>(
    auth: WorkspaceAuthContext,
    callback: (runner: WorkspaceQueryRunner) => Promise<TValue>,
    onConfirmedRollback?: (error: unknown) => void,
  ): Promise<TValue> {
    if (!(await this.ready()))
      throw new ServiceUnavailableException(
        'Lead operation storage is not installed or unavailable',
      );
    return this.orm.executeInWorkspaceContext(async () => {
      const source = await this.orm.getGlobalWorkspaceDataSource();
      const runner = source.createQueryRunner('master');
      let committing = false;
      let uncertain = false;
      try {
        await runner.connect();
        await runner.startTransaction('READ COMMITTED');
        await runner.query("SET LOCAL lock_timeout = '2s'");
        await runner.query("SET LOCAL statement_timeout = '10s'");
        const result = await callback(runner);
        committing = true;
        await runner.commitTransaction();
        if (runner.isTransactionActive)
          throw new Error('Lead Pool transaction remained active after commit');
        return result;
      } catch (error) {
        if (committing) {
          // Even a later successful ROLLBACK cannot establish whether COMMIT applied.
          uncertain = true;
        } else if (runner.isTransactionActive) {
          try {
            await runner.rollbackTransaction();
            if (runner.isTransactionActive) uncertain = true;
            else onConfirmedRollback?.(error);
          } catch {
            uncertain = true;
          }
        }
        throw error;
      } finally {
        if (uncertain) await discardLeadPoolConnection(runner);
        // Workspace release also clears buffered events; the discarded pg runner
        // is already released, so its underlying release is an idempotent no-op.
        await runner.release();
      }
    }, auth);
  }

  async lockOrigin(
    runner: WorkspaceQueryRunner,
    workspaceId: string,
    objectId: string,
  ): Promise<void> {
    // All distributor writers serialize per origin, including overlap admission.
    await runner.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`inconnect-lead-pool:${workspaceId}:${objectId}`],
    );
  }

  async intentionExists(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    intentionId: string,
  ): Promise<boolean> {
    if (auth.type !== 'user') throw new Error('Human required');
    const rows: { exists: boolean }[] = await runner.query(
      `SELECT EXISTS(SELECT 1 FROM ${TABLE} WHERE "workspaceId" = $1 AND "actorUserId" = $2 AND "intentionId" = $3) AS "exists"`,
      [auth.workspace.id, auth.user.id, intentionId],
    );
    // A historical member identity can hide the row from find(), but cannot
    // establish absence of the durable (workspace, user, intention) identity.
    return rows.length !== 1 || rows[0].exists !== false;
  }

  async find(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    key: { operationId: string } | { intentionId: string },
    lock = true,
  ): Promise<LeadPoolStoredRow | null> {
    if (auth.type !== 'user') return null;
    const rows: LeadPoolStoredRow[] = await runner.query(
      `SELECT "id", "requestHash", "state" FROM ${TABLE}
       WHERE "workspaceId" = $1 AND "actorUserId" = $2 AND "actorWorkspaceMemberId" = $3
         AND ${'operationId' in key ? '"id"' : '"intentionId"'} = $4 ${lock ? 'FOR UPDATE' : ''}`,
      [
        auth.workspace.id,
        auth.user.id,
        auth.workspaceMemberId,
        'operationId' in key ? key.operationId : key.intentionId,
      ],
    );
    if (rows.length > 1) throw new Error('Invalid operation identity');
    return rows[0]
      ? { ...rows[0], state: parsePoolInput(storedPoolSchema, rows[0].state) }
      : null;
  }

  async assertNoOverlap(
    runner: WorkspaceQueryRunner,
    workspaceId: string,
    objectId: string,
    recordIds: string[],
  ): Promise<void> {
    if (!recordIds.length) return;
    const rows: { id: string }[] = await runner.query(
      `SELECT "id" FROM ${TABLE}
       WHERE "workspaceId" = $1 AND "state"->'input'->>'objectId' = $2
         AND "state"->>'status' IN ('PREVIEW', 'RUNNING')
         AND ("state"->>'expiresAt')::timestamptz > now()
         AND EXISTS (SELECT 1 FROM jsonb_array_elements("state"->'items') item
                     WHERE item->>'recordId' = ANY($3::text[]) AND item->>'status' = 'PENDING') LIMIT 1`,
      [workspaceId, objectId, recordIds],
    );
    if (rows.length)
      throw new ConflictException(
        'An active operation already reserves part of this selection',
      );
  }

  async insert(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    row: LeadPoolStoredRow,
  ): Promise<void> {
    if (auth.type !== 'user') throw new Error('Human required');
    await runner.query(
      `INSERT INTO ${TABLE} ("id", "workspaceId", "actorUserId", "actorWorkspaceMemberId", "intentionId", "requestHash", "state") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        row.id,
        auth.workspace.id,
        auth.user.id,
        auth.workspaceMemberId,
        row.state.input.intentionId,
        row.requestHash,
        JSON.stringify(row.state),
      ],
    );
  }

  async save(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    row: LeadPoolStoredRow,
  ): Promise<void> {
    if (auth.type !== 'user') throw new Error('Human required');
    const rows: { id: string }[] = await runner.query(
      `UPDATE ${TABLE} SET "state" = $1::jsonb, "updatedAt" = now() WHERE "id" = $2 AND "workspaceId" = $3 AND "actorUserId" = $4 AND "actorWorkspaceMemberId" = $5 RETURNING "id"`,
      [
        JSON.stringify(row.state),
        row.id,
        auth.workspace.id,
        auth.user.id,
        auth.workspaceMemberId,
      ],
    );
    if (rows.length !== 1) throw new Error('Operation persistence failed');
  }
}
