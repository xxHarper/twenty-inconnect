import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { GraphQLError } from 'graphql';
import { randomUUID } from 'crypto';
import {
  type LeadPoolCatalog,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolItemStatus,
} from 'twenty-shared/types';

import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import {
  denyLeadPool,
  hashLeadPoolValue,
  LeadPoolAuthorityService,
  type LeadPoolAuthority,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import {
  parsePoolInput,
  poolExecuteSchema,
  poolListSchema,
  poolOperationSchema,
  poolPreviewSchema,
  poolPreviewIdentitySchema,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-contract';
import { LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import {
  LeadPoolStoreService,
  type LeadPoolStoredRow,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { planExplicitLeadPool } from 'src/modules/inconnect-lead-management/manual-pool/plan-explicit-lead-pool';

@Injectable()
export class LeadPoolService {
  constructor(
    private readonly authority: LeadPoolAuthorityService,
    private readonly queries: LeadPoolQueryService,
    private readonly store: LeadPoolStoreService,
    private readonly update: CommonUpdateManyQueryRunnerService,
  ) {}

  async catalog(auth: WorkspaceAuthContext): Promise<LeadPoolCatalog> {
    const objects: LeadPoolCatalog['objects'] = [];
    for (const id of await this.authority.getManagedObjectIds(auth)) {
      try {
        const authority = await this.authority.resolve(auth, id);
        objects.push({
          id,
          label: authority.context.flatObjectMetadata.labelPlural,
        });
      } catch {
        /* Unavailable authority never produces a selectable origin. */
      }
    }
    const storageReady = await this.store.ready();
    return {
      objects,
      storageReady,
      allMatchingReady: false,
      messagingClassification: 'NOT_READY',
      blockedReason: !storageReady
        ? 'El almacenamiento durable de operaciones no está instalado o disponible.'
        : objects.length === 0
          ? 'No hay un origen administrado con permiso de lectura y transferencia y metadata compatible.'
          : null,
    };
  }

  async list(auth: WorkspaceAuthContext, raw: unknown): Promise<LeadPoolPage> {
    const input = parsePoolInput(poolListSchema, raw);
    const authority = await this.authority.resolve(auth, input.objectId);
    const query = await this.queries.build(auth, authority, input.filter);
    const total = await this.queries.count(query);
    const records = await query
      .offset(input.offset)
      .limit(input.first)
      .getRawMany<{
        id: string;
        label: string | null;
        ownerId: string | null;
      }>();
    return {
      total,
      records: records.map(({ id, label, ownerId }) => ({
        id,
        label,
        ownerId,
      })),
      offset: input.offset,
      fields: authority.publicFields,
      recipients: authority.recipients,
    };
  }

  async preview(
    auth: WorkspaceAuthContext,
    raw: unknown,
  ): Promise<LeadPoolOperation> {
    const identity = parsePoolInput(poolPreviewIdentitySchema, raw);
    await this.authority.assertHuman(auth);
    let absent = false;
    let rolledBack = false;
    let row: LeadPoolStoredRow;
    try {
      row = await this.store.transaction(
        auth,
        async (runner) => {
          await this.store.lockOrigin(
            runner,
            auth.workspace.id,
            identity.objectId,
          );
          await runner.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [
              `inconnect-lead-intention:${auth.workspace.id}:${auth.type === 'user' ? auth.user.id : ''}:${identity.intentionId}`,
            ],
          );
          const existing = await this.store.find(runner, auth, {
            intentionId: identity.intentionId,
          });
          absent =
            existing === null &&
            !(await this.store.intentionExists(
              runner,
              auth,
              identity.intentionId,
            ));
          const input = parsePoolInput(poolPreviewSchema, raw);
          const authority = await this.authority.resolve(auth, input.objectId);
          const requestHash = hashLeadPoolValue(input);
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw new ConflictException(
                'Intention already belongs to a different request',
              );
            return existing;
          }
          this.authority.assertRecipients(authority, input.recipientIds);
          const records = await this.queries.selected(
            auth,
            authority,
            input.filter,
            input.recordIds,
            runner,
          );
          if (records.length !== input.recordIds.length) return denyLeadPool();
          const query = await this.queries.build(
            auth,
            authority,
            input.filter,
            runner,
          );
          const found = await this.queries.count(query);
          await this.store.assertNoOverlap(
            runner,
            auth.workspace.id,
            input.objectId,
            input.recordIds,
          );
          const created: LeadPoolStoredRow = {
            id: randomUUID(),
            requestHash,
            state: {
              input,
              found,
              authorityHash: authority.hash,
              items: planExplicitLeadPool(input, records),
              status: 'PREVIEW',
              version: 0,
              lastBatchError: null,
              consecutiveFailures: 0,
              batches: [],
              expiresAt: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          };
          await this.store.insert(runner, auth, created);
          return created;
        },
        () => {
          rolledBack = true;
        },
      );
    } catch (error) {
      if (
        absent &&
        rolledBack &&
        (error instanceof BadRequestException ||
          error instanceof ForbiddenException)
      )
        throw new GraphQLError(error.message, {
          extensions: {
            code:
              error instanceof ForbiddenException
                ? 'FORBIDDEN'
                : 'BAD_USER_INPUT',
            leadPoolPreview: {
              outcome: 'REJECTED',
              intentionId: identity.intentionId,
              reason:
                error instanceof ForbiddenException
                  ? 'PERMISSION'
                  : 'VALIDATION',
            },
          },
        });
      throw error;
    }
    return this.view(auth, row);
  }

  async result(
    auth: WorkspaceAuthContext,
    raw: unknown,
  ): Promise<LeadPoolOperation> {
    const input = parsePoolInput(poolOperationSchema, raw);
    await this.authority.assertHuman(auth);
    const row = await this.store.transaction(auth, async (runner) =>
      this.requireRow(runner, auth, input.operationId),
    );
    return this.view(auth, row);
  }

  async execute(
    auth: WorkspaceAuthContext,
    raw: unknown,
  ): Promise<LeadPoolOperation> {
    const input = parsePoolInput(poolExecuteSchema, raw);
    await this.authority.assertHuman(auth);
    let attempted: string[] = [];
    let row: LeadPoolStoredRow;
    try {
      row = await this.store.transaction(auth, async (runner) => {
        const locator = await this.store.find(
          runner,
          auth,
          { operationId: input.operationId },
          false,
        );
        if (!locator) throw new NotFoundException('Operation unavailable');
        await this.store.lockOrigin(
          runner,
          auth.workspace.id,
          locator.state.input.objectId,
        );
        const stored = await this.requireRow(runner, auth, input.operationId);
        const state = stored.state;
        const authority = await this.authority.resolve(
          auth,
          state.input.objectId,
        );
        if (
          input.expectedVersion < state.version ||
          state.status === 'COMPLETED' ||
          state.status === 'CANCELLED'
        )
          return stored;
        if (input.expectedVersion !== state.version)
          throw new ConflictException('Invalid operation version');
        if (Date.parse(state.expiresAt) <= Date.now())
          throw new ConflictException(
            'Preview expired; cancel and prepare a new selection',
          );
        if (authority.hash !== state.authorityHash)
          throw new ConflictException(
            'Authority or metadata changed; prepare a new preview',
          );
        this.authority.assertRecipients(authority, state.input.recipientIds);
        const batch = state.items
          .filter((item) => item.status === 'PENDING')
          .slice(0, state.input.batchSize);
        attempted = batch.map((item) => item.recordId);
        for (const item of batch) {
          const current = await this.authority.resolve(
            auth,
            state.input.objectId,
          );
          if (current.hash !== state.authorityHash)
            throw new ConflictException('Authority changed during the batch');
          this.authority.assertRecipients(current, state.input.recipientIds);
          const [record] = await this.queries.selected(
            auth,
            current,
            state.input.filter,
            [item.recordId],
            runner,
          );
          if (!record) {
            item.status = 'REJECTED';
            continue;
          }
          if (
            record.ownerId !== item.expectedOwnerId ||
            record.updatedAt !== item.expectedUpdatedAt
          ) {
            item.status = 'CONFLICT';
            continue;
          }
          if (record.ownerId === item.recipientId) {
            item.status = 'UNCHANGED';
            continue;
          }
          const { results } = await this.update.executeWithQueryRunner(
            {
              filter: {
                id: { eq: item.recordId },
                [current.ownerColumn]:
                  item.expectedOwnerId === null
                    ? { is: 'NULL' }
                    : { eq: item.expectedOwnerId },
              },
              data: {
                [current.owner.name]: {
                  connect: { where: { id: item.recipientId } },
                },
              },
              selectedFields: { id: true },
            },
            current.context,
            runner,
          );
          if (results.length !== 1 || results[0].id !== item.recordId)
            throw new ConflictException(
              'Scoped owner update did not affect the expected record',
            );
          item.status = 'CHANGED';
        }
        const finalAuthority = await this.authority.resolve(
          auth,
          state.input.objectId,
        );
        if (finalAuthority.hash !== state.authorityHash)
          throw new ConflictException('Authority changed during the batch');
        this.authority.assertRecipients(
          finalAuthority,
          state.input.recipientIds,
        );
        // Acquire member locks after facade reads, which use their own short validity queries.
        await this.lockMembers(
          runner,
          auth,
          finalAuthority,
          state.input.recipientIds,
        );
        state.lastBatchError = null;
        state.consecutiveFailures = 0;
        state.batches.push({
          version: state.version,
          attempted: batch.length,
          outcome: 'COMMITTED',
        });
        state.version++;
        state.status = state.items.some((item) => item.status === 'PENDING')
          ? 'RUNNING'
          : 'COMPLETED';
        await this.store.save(runner, auth, stored);
        return stored;
      });
    } catch (failure) {
      if (attempted.length === 0) throw failure;
      // A primary reread under the same locks reconciles an uncertain COMMIT.
      // Never blindly replay transfers after a lost response.
      try {
        row = await this.store.transaction(auth, async (runner) => {
          const locator = await this.store.find(
            runner,
            auth,
            { operationId: input.operationId },
            false,
          );
          if (!locator) throw new NotFoundException('Operation unavailable');
          await this.store.lockOrigin(
            runner,
            auth.workspace.id,
            locator.state.input.objectId,
          );
          const stored = await this.requireRow(runner, auth, input.operationId);
          await this.authority.resolve(auth, stored.state.input.objectId);
          if (stored.state.version !== input.expectedVersion) return stored;
          stored.state.lastBatchError =
            'El lote se revirtió. Consulta el resultado y confirma un nuevo intento. Máximo tres intentos fallidos por lote.';
          stored.state.consecutiveFailures++;
          stored.state.batches.push({
            version: stored.state.version,
            attempted: attempted.length,
            outcome: 'ROLLED_BACK',
          });
          if (stored.state.consecutiveFailures >= 3) {
            for (const item of stored.state.items)
              if (
                attempted.includes(item.recordId) &&
                item.status === 'PENDING'
              )
                item.status = 'FAILED';
            stored.state.consecutiveFailures = 0;
          }
          stored.state.version++;
          stored.state.status = stored.state.items.some(
            (item) => item.status === 'PENDING',
          )
            ? 'RUNNING'
            : 'COMPLETED';
          await this.store.save(runner, auth, stored);
          return stored;
        });
      } catch {
        throw new ServiceUnavailableException(
          'No se pudo reconciliar el lote. Conserva el identificador y consulta la operación antes de reintentar.',
        );
      }
    }
    return this.view(auth, row);
  }

  async cancel(
    auth: WorkspaceAuthContext,
    raw: unknown,
  ): Promise<LeadPoolOperation> {
    const input = parsePoolInput(poolExecuteSchema, raw);
    await this.authority.assertHuman(auth);
    const row = await this.store.transaction(auth, async (runner) => {
      const stored = await this.requireRow(runner, auth, input.operationId);
      if (
        input.expectedVersion < stored.state.version ||
        ['COMPLETED', 'CANCELLED'].includes(stored.state.status)
      )
        return stored;
      if (input.expectedVersion !== stored.state.version)
        throw new ConflictException('Invalid operation version');
      for (const item of stored.state.items)
        if (item.status === 'PENDING') item.status = 'REMAINING';
      stored.state.version++;
      stored.state.status = 'CANCELLED';
      await this.store.save(runner, auth, stored);
      return stored;
    });
    return this.view(auth, row);
  }

  private async requireRow(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    operationId: string,
  ) {
    const row = await this.store.find(runner, auth, { operationId });
    if (!row) throw new NotFoundException('Operation unavailable');
    return row;
  }

  private async lockMembers(
    runner: WorkspaceQueryRunner,
    auth: WorkspaceAuthContext,
    authority: LeadPoolAuthority,
    recipientIds: string[],
  ) {
    if (auth.type !== 'user') return denyLeadPool();
    const ids = [...new Set([auth.workspaceMemberId, ...recipientIds])].sort();
    const rows: { id: string; userId: string; userWorkspaceId: string }[] =
      await runner.query(
        `SELECT member."id", member."userId", membership."id" AS "userWorkspaceId"
       FROM ${escapeIdentifier(authority.schema)}."workspaceMember" member
       JOIN "core"."userWorkspace" membership ON membership."userId" = member."userId" AND membership."workspaceId" = $2 AND membership."deletedAt" IS NULL
       JOIN "core"."user" workspace_user ON workspace_user."id" = member."userId" AND workspace_user."deletedAt" IS NULL
       WHERE member."id" = ANY($1::uuid[]) AND member."deletedAt" IS NULL
       ORDER BY member."id" FOR SHARE OF member, membership, workspace_user`,
        [ids, auth.workspace.id],
      );
    if (
      rows.length !== ids.length ||
      !rows.some(
        (row) =>
          row.id === auth.workspaceMemberId &&
          row.userId === auth.user.id &&
          row.userWorkspaceId === auth.userWorkspaceId,
      )
    )
      return denyLeadPool();
  }

  private async view(
    auth: WorkspaceAuthContext,
    row: LeadPoolStoredRow,
  ): Promise<LeadPoolOperation> {
    const { state } = row;
    const authority = await this.authority.resolve(auth, state.input.objectId, {
      requireRecipientRead: false,
    });
    const readable = new Set(
      (
        await this.queries.selected(
          auth,
          authority,
          {},
          state.items.map((item) => item.recordId),
        )
      ).map((record) => record.id),
    );
    const counts: Record<LeadPoolItemStatus, number> = {
      CHANGED: 0,
      UNCHANGED: 0,
      CONFLICT: 0,
      REJECTED: 0,
      FAILED: 0,
      REMAINING: 0,
      PENDING: 0,
    };
    for (const item of state.items) counts[item.status]++;
    const plannedChanges = state.items.filter(
      (item) =>
        item.recipientId !== null && item.recipientId !== item.expectedOwnerId,
    ).length;
    const plannedUnchanged = state.items.filter(
      (item) =>
        item.recipientId !== null && item.recipientId === item.expectedOwnerId,
    ).length;
    return {
      id: row.id,
      intentionId: state.input.intentionId,
      objectId: state.input.objectId,
      mode: state.input.mode,
      status: state.status,
      version: state.version,
      found: state.found,
      selected: state.items.length,
      authorized: state.items.length,
      plannedChanges,
      plannedUnchanged,
      plannedRemaining: state.items.length - plannedChanges - plannedUnchanged,
      processed: state.items.length - counts.PENDING - counts.REMAINING,
      counts,
      lastBatchError: state.lastBatchError,
      batchFailures: state.batches.filter(
        (batch) => batch.outcome === 'ROLLED_BACK',
      ).length,
      recipients: state.input.recipientIds.map((id) => ({
        id,
        label:
          authority.recipients.find((recipient) => recipient.id === id)
            ?.label || null,
        assignable: authority.recipients.some(
          (recipient) =>
            recipient.id === id && recipient.label.trim().length > 0,
        ),
        quantity: state.items.filter((item) => item.recipientId === id).length,
      })),
      canExecute:
        state.input.recipientIds.every((id) =>
          authority.recipients.some(
            (recipient) =>
              recipient.id === id && recipient.label.trim().length > 0,
          ),
        ) &&
        authority.hash === state.authorityHash &&
        Date.parse(state.expiresAt) > Date.now(),
      items: state.items
        .filter((item) => readable.has(item.recordId))
        .map((item) => ({ recordId: item.recordId, status: item.status })),
      hiddenItems: state.items.filter((item) => !readable.has(item.recordId))
        .length,
      expiresAt: state.expiresAt,
    };
  }
}
