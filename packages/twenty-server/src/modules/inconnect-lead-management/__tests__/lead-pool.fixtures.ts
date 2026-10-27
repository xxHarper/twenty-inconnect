import { EventEmitter } from 'events';
import { DataSource } from 'typeorm';
import { type LeadPoolPreviewInput } from 'twenty-shared/types';

import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  type CommonExtendedInput,
  type UpdateManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import {
  type UserWorkspaceAuthContext,
  type WorkspaceAuthContext,
} from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { validateInconnectRecordAccessUpdateValues } from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import {
  LeadPoolAuthorityService,
  type LeadPoolAuthority,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import { type LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import {
  LeadPoolStoreService,
  type LeadPoolStoredRow,
} from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';

export const poolId = (value: number) =>
  `99999999-1111-4111-8111-${String(value).padStart(12, '0')}`;
export const actor = {
  type: 'user',
  workspace: { id: poolId(1), databaseSchema: 'workspace_test' },
  user: { id: poolId(2) },
  userWorkspaceId: poolId(3),
  workspaceMemberId: poolId(4),
  workspaceMember: { id: poolId(4), userId: poolId(2) },
} as UserWorkspaceAuthContext;
export const originId = poolId(10);
export const recipientId = poolId(20);
export const poolInput = (count = 50): LeadPoolPreviewInput => ({
  intentionId: poolId(30),
  objectId: originId,
  recordIds: Array.from({ length: count }, (_, index) => poolId(100 + index)),
  recipientIds: [recipientId],
  mode: 'SINGLE',
  filter: {},
  batchSize: 50,
});

export const makePoolHarness = (count = 50) => {
  const rows = new Map(
    poolInput(count).recordIds.map((id) => [
      id,
      {
        id,
        ownerId: actor.workspaceMemberId as string | null,
        updatedAt: '2026-10-26 12:00:00.123456+00',
        label: `Lead ${id}`,
        visible: true,
      },
    ]),
  );
  let operations = new Map<
    string,
    LeadPoolStoredRow & {
      workspaceId: string;
      actorUserId: string;
      actorMemberId: string;
    }
  >();
  let writes = 0;
  let failWriteAt = -1;
  let loseCommitResponse = false;
  let unavailable = false;
  const sql: { query: string; parameters: unknown[] }[] = [];
  let authorized = true;
  const authority = {
    context: {
      flatObjectMetadata: {
        id: originId,
        nameSingular: 'customProspect',
        labelPlural: 'Prospectos',
        fieldIds: [],
      },
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatFieldMetadataMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      authContext: actor,
    },
    schema: 'workspace_test',
    owner: { name: 'commercialOwner' },
    ownerColumn: 'commercialOwnerId',
    labelField: { name: 'name' },
    fields: [],
    publicFields: [],
    recipients: [
      { id: recipientId, label: 'Ejecutivo A' },
      { id: poolId(21), label: 'Ejecutivo B' },
    ],
    hash: 'a'.repeat(64),
    decision: {
      kind: 'all-records',
      ownerFieldMetadataId: poolId(11),
      ownerFieldName: 'commercialOwner',
      ownerJoinColumnName: 'commercialOwnerId',
      authenticatedWorkspaceMemberId: actor.workspaceMemberId,
      assignableOwnerWorkspaceMemberIds: [recipientId, poolId(21)],
      ownerTransferPolicy: 'standardPermissionsOnly',
      ownerRequirement: 'required',
      createPolicy: 'denied',
      missingOwnerPolicy: 'requireExplicit',
      sourceRecordEffect: 'allRecords',
    },
  } as unknown as LeadPoolAuthority;
  const assertHuman = jest.fn(async (auth: WorkspaceAuthContext) => {
    if (!authorized || auth.type !== 'user') throw new Error('Access denied');
    return auth;
  });
  const resolve = jest.fn(
    async (auth: WorkspaceAuthContext, objectId: string) => {
      await assertHuman(auth);
      if (objectId !== originId) throw new Error('Origin unavailable');
      return authority;
    },
  );
  const authorities = {
    assertHuman,
    resolve,
    getManagedObjectIds: jest.fn(async () => [originId]),
    assertRecipients: LeadPoolAuthorityService.prototype.assertRecipients,
  } as unknown as LeadPoolAuthorityService;
  const filterRows = (
    ids?: string[],
    filter: { ownerId?: string; search?: string } = {},
  ) =>
    [...rows.values()].filter(
      (row) =>
        row.visible &&
        (!ids || ids.includes(row.id)) &&
        (!filter.ownerId || row.ownerId === filter.ownerId) &&
        (!filter.search || row.label.includes(filter.search)),
    );
  const query = {
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(
      async (): Promise<ReturnType<typeof filterRows>> =>
        filterRows().slice(
          query.offset.mock.calls[query.offset.mock.calls.length - 1]?.[0] ?? 0,
          (query.offset.mock.calls[query.offset.mock.calls.length - 1]?.[0] ??
            0) +
            (query.limit.mock.calls[query.limit.mock.calls.length - 1]?.[0] ??
              50),
        ),
    ),
  };
  const queries = {
    build: jest.fn(async () => query),
    count: jest.fn(async () => filterRows().length),
    selected: jest.fn(async (_auth, _authority, filter, ids: string[]) =>
      structuredClone(filterRows(ids, filter)),
    ),
  } as unknown as LeadPoolQueryService;
  const dataSource = {
    query: jest.fn(async () => {
      if (unavailable) throw new Error('storage unavailable');
      return [{ valid: true }];
    }),
  };
  const createRunner = () => {
    const oldOperations = structuredClone(operations);
    const oldRows = structuredClone(rows);
    const source = new DataSource({ type: 'postgres' });
    const transport = new EventEmitter();
    const query = jest.fn(
      async (statement: string, parameters: unknown[] = []) => {
        sql.push({ query: statement, parameters });
        if (statement.includes('FROM "workspace_test"."workspaceMember"'))
          return (parameters[0] as string[]).map((id) => ({
            id,
            userId: id === actor.workspaceMemberId ? actor.user.id : poolId(40),
            userWorkspaceId:
              id === actor.workspaceMemberId
                ? actor.userWorkspaceId
                : poolId(41),
          }));
        if (statement.startsWith('SELECT EXISTS'))
          return [
            {
              exists: [...operations.values()].some(
                (operation) =>
                  operation.workspaceId === parameters[0] &&
                  operation.actorUserId === parameters[1] &&
                  operation.state.input.intentionId === parameters[2],
              ),
            },
          ];
        if (statement.startsWith('SELECT "id", "requestHash"')) {
          return [...operations.values()]
            .filter(
              (operation) =>
                operation.workspaceId === parameters[0] &&
                operation.actorUserId === parameters[1] &&
                operation.actorMemberId === parameters[2] &&
                (statement.includes('"intentionId" =')
                  ? operation.state.input.intentionId
                  : operation.id) === parameters[3],
            )
            .map((operation) => structuredClone(operation));
        }
        if (statement.includes('jsonb_array_elements'))
          return [...operations.values()].filter(
            (operation) =>
              operation.workspaceId === parameters[0] &&
              operation.state.input.objectId === parameters[1] &&
              ['PREVIEW', 'RUNNING'].includes(operation.state.status) &&
              operation.state.items.some(
                (item) =>
                  item.status === 'PENDING' &&
                  (parameters[2] as string[]).includes(item.recordId),
              ),
          );
        if (statement.startsWith('INSERT')) {
          const [
            id,
            workspaceId,
            actorUserId,
            actorMemberId,
            ,
            requestHash,
            state,
          ] = parameters as string[];
          operations.set(id, {
            id,
            workspaceId,
            actorUserId,
            actorMemberId,
            requestHash,
            state: JSON.parse(state),
          });
        }
        if (statement.startsWith('UPDATE')) {
          const operation = operations.get(parameters[1] as string)!;
          operation.state = JSON.parse(parameters[0] as string);
          return [{ id: operation.id }];
        }
        return [];
      },
    );
    Object.assign(transport, {
      query: async (statement: string, parameters: unknown[]) => {
        if (statement === 'COMMIT' && loseCommitResponse) {
          loseCommitResponse = false;
          throw new Error('connection lost after commit');
        }
        if (statement === 'ROLLBACK') {
          operations = oldOperations;
          rows.clear();
          for (const [id, row] of oldRows) rows.set(id, row);
        }
        return { rows: await query(statement, parameters), rowCount: 0 };
      },
    });
    Object.assign(source.driver, {
      obtainMasterConnection: async () => [transport, jest.fn()],
    });
    return source.createQueryRunner(
      'master',
    ) as unknown as WorkspaceQueryRunner;
  };
  let serial = Promise.resolve<unknown>(undefined);
  const orm = {
    getGlobalWorkspaceDataSource: async () => ({
      createQueryRunner: createRunner,
    }),
    executeInWorkspaceContext: (callback: () => Promise<unknown>) => {
      const next = serial.then(callback);
      serial = next.catch(() => undefined);
      return next;
    },
  };
  const store = new LeadPoolStoreService(dataSource as never, orm as never);
  jest.spyOn(store, 'ready').mockImplementation(async () => !unavailable);
  const common = new CommonUpdateManyQueryRunnerService();
  const updateCalls: UpdateManyQueryArgs[] = [];
  const updater = {
    executeWithQueryRunner: jest.fn(
      async (
        args: UpdateManyQueryArgs,
        _context: unknown,
        runner: WorkspaceQueryRunner,
      ) => {
        if (!runner.isTransactionActive) throw new Error('Transaction missing');
        updateCalls.push(structuredClone(args));
        const recordId = args.filter.id.eq as string;
        const values = args.data as Record<
          string,
          { connect: { where: { id: string } } }
        >;
        const newOwner = values.commercialOwner.connect.where.id;
        const mutation = {
          setInternallyInjectedFieldNames: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          returning: jest.fn().mockReturnThis(),
          execute: async () => {
            validateInconnectRecordAccessUpdateValues({
              decision: authority.decision,
              valuesSet: { commercialOwnerId: newOwner },
            });
            writes++;
            if (writes === failWriteAt)
              throw new Error('simulated ORM I/O failure');
            rows.get(recordId)!.ownerId = newOwner;
            rows.get(recordId)!.updatedAt = '2026-10-26 13:00:00.000001+00';
            return { generatedMaps: [{ id: recordId }] };
          },
        };
        const builder = {
          expressionMap: { joinAttributes: [] },
          update: () => mutation,
        };
        // Real Common Update runner, with its ordinary ORM I/O boundary simulated.
        const results = await common.run(
          {
            ...args,
            selectedFieldsResult: { select: {}, relations: undefined },
            internallyInjectedFieldNames: [],
          } as unknown as CommonExtendedInput<UpdateManyQueryArgs>,
          {
            ...authority.context,
            repository: { createQueryBuilder: () => builder },
            commonQueryParser: { applyFilterToBuilder: jest.fn() },
          } as unknown as CommonExtendedQueryRunnerContext,
        );
        return { results };
      },
    ),
  };
  const service = new LeadPoolService(
    authorities,
    queries,
    store,
    updater as never,
  );
  return {
    service,
    store,
    rows,
    authority,
    queries,
    assertHuman,
    resolve,
    sql,
    updateCalls,
    operations: () => operations,
    setAuthorized: (value: boolean) => {
      authorized = value;
    },
    failWrite: (value: number) => {
      failWriteAt = value;
    },
    loseCommit: () => {
      loseCommitResponse = true;
    },
    setUnavailable: () => {
      unavailable = true;
    },
    writes: () => writes,
  };
};
