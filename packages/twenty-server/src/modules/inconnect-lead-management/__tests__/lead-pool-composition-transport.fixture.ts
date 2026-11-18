import { EventEmitter } from 'node:events';
import {
  type DataSource,
  type EntityTarget,
  type ObjectLiteral,
} from 'typeorm';
import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { type WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { type LeadPoolStoredRow } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';

import {
  makeCompositionMetadata,
  recipientUserId,
  recipientUserWorkspaceId,
  schema,
} from './lead-pool-composition-metadata.fixture';
import { completeLayout } from './lead-pool-storage-layout.fixture';
import { actor, poolInput, recipientId } from './lead-pool.fixtures';

const operationTable = '"core"."inconnectLeadPoolOperation"';

type Row = {
  id: string;
  commercialOwnerId: string;
  updatedAt: string;
  deletedAt: null;
  name: string;
  updatedBySource: string | null;
  updatedByName: string | null;
  updatedByWorkspaceMemberId: string | null;
  updatedByContext: object | null;
};

type Query = {
  connection: number;
  statement: string;
  parameters: unknown[];
  inTransaction: boolean;
};

const makeDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

export const makeCompositionTransport = async (
  core: DataSource,
  events: WorkspaceEventEmitter,
  { includeActorRecipient = false, recordCount = 1 } = {},
) => {
  const metadata = await makeCompositionMetadata();
  const table = `"${schema}"."${computeObjectTargetTable(metadata.lead)}"`;
  const membersTable = `"${schema}"."workspaceMember"`;
  const [recordId] = poolInput(1).recordIds;
  const workspace = { id: actor.workspace.id, databaseSchema: schema };
  const userWorkspaces = [
    {
      id: actor.userWorkspaceId,
      userId: actor.user.id,
      workspaceId: workspace.id,
      deletedAt: null,
    },
    {
      id: recipientUserWorkspaceId,
      userId: recipientUserId,
      workspaceId: workspace.id,
      deletedAt: null,
    },
  ];
  const repositories = new Map<EntityTarget<ObjectLiteral>, object[]>([
    [WorkspaceEntity, [workspace]],
    [ObjectMetadataEntity, [metadata.lead]],
    [FieldMetadataEntity, metadata.leadFields],
    [UserWorkspaceEntity, userWorkspaces],
  ]);
  const findRows = (
    entity: EntityTarget<ObjectLiteral>,
    { where }: { where: Record<string, unknown> },
  ) =>
    (repositories.get(entity) ?? []).filter((row) =>
      Object.entries(where).every(
        ([key, value]) => Reflect.get(row, key) === value,
      ),
    );

  jest.spyOn(core.manager, 'getRepository').mockImplementation((entity) => {
    if (!repositories.has(entity))
      throw new Error(`Unexpected repository ${String(entity)}`);
    return {
      findOne: async (options: Parameters<typeof findRows>[1]) =>
        findRows(entity, options)[0] ?? null,
      find: async (options: Parameters<typeof findRows>[1]) =>
        findRows(entity, options),
    } as ReturnType<typeof core.manager.getRepository>;
  });

  const durable: { record: Row; operation?: LeadPoolStoredRow } = {
    record: {
      id: recordId,
      commercialOwnerId: actor.workspaceMemberId,
      name: 'Prospecto',
      updatedAt: '2026-10-26 12:00:00.123456+00',
      deletedAt: null,
      updatedBySource: null,
      updatedByName: null,
      updatedByWorkspaceMemberId: null,
      updatedByContext: null,
    },
  };
  const extraRecords = poolInput(recordCount)
    .recordIds.slice(1)
    .map((id) => ({
      ...durable.record,
      id,
      name: `Prospecto ${id}`,
    }));
  const transport = {
    actorActive: true,
    recipientActive: true,
    failUpdate: false,
    failSave: false,
    loseCommitResponse: false,
    failReconciliation: false,
    afterLockedSelection: () => {},
    queries: [] as Query[],
    unexpected: [] as string[],
    releasedWithError: jest.fn(),
    deferCommit: false,
    commitStarted: makeDeferred(),
    commitResponse: makeDeferred(),
  };
  let connection = 0;
  let awaitingReconciliation = false;

  const obtainConnection = (workspacePrimary: boolean) => async () => {
    const connectionId = ++connection;
    let pending: typeof durable | undefined;
    const client = Object.assign(new EventEmitter(), {
      query: async (statement: string, parameters: unknown[] = []) => {
        transport.queries.push({
          connection: connectionId,
          statement,
          parameters,
          inTransaction: !!pending,
        });
        const result = (rows: object[] = []) => ({
          rows,
          rowCount: rows.length,
          command: statement.split(' ')[0],
        });
        if (statement === 'START TRANSACTION' && workspacePrimary) {
          pending = structuredClone(durable);
          return result();
        }
        if (
          statement === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' ||
          statement.startsWith('SET LOCAL ') ||
          statement.includes('pg_advisory_xact_lock')
        ) {
          if (!pending) throw new Error('Expected a caller transaction');
          return result();
        }
        if (statement === 'ROLLBACK' && pending) {
          pending = undefined;
          return result();
        }
        if (statement === 'COMMIT' && pending) {
          if (transport.deferCommit) {
            transport.deferCommit = false;
            transport.commitStarted.resolve();
            await transport.commitResponse.promise;
          }
          Object.assign(durable, pending);
          pending = undefined;
          if (transport.loseCommitResponse) {
            transport.loseCommitResponse = false;
            awaitingReconciliation = true;
            throw new Error('Simulated commit response lost after applying');
          }
          return result();
        }
        const snapshot = pending ?? durable;
        if (
          statement.startsWith('SELECT "id", "workspaceId"') &&
          statement.includes('LIMIT 0')
        ) {
          if (awaitingReconciliation && transport.failReconciliation) {
            throw new Error('Simulated primary unavailable for reconciliation');
          }
          return result();
        }
        if (statement.includes('AS layout FROM pg_class')) {
          return result([{ layout: completeLayout() }]);
        }
        if (
          statement.startsWith('SELECT EXISTS') &&
          statement.includes(operationTable)
        ) {
          return result([{ exists: !!snapshot.operation }]);
        }
        if (statement.includes('jsonb_array_elements')) return result();
        if (
          statement.startsWith('SELECT "id", "requestHash"') &&
          statement.includes(operationTable)
        ) {
          const operation = snapshot.operation;
          const matchesActor =
            parameters[0] === actor.workspace.id &&
            parameters[1] === actor.user.id &&
            parameters[2] === actor.workspaceMemberId;
          const key = statement.includes('"intentionId" =')
            ? operation?.state.input.intentionId
            : operation?.id;
          return result(
            operation && matchesActor && key === parameters[3]
              ? [structuredClone(operation)]
              : [],
          );
        }
        if (statement.startsWith(`INSERT INTO ${operationTable}`) && pending) {
          const [id, , , , , requestHash, state] = parameters as string[];
          pending.operation = { id, requestHash, state: JSON.parse(state) };
          return result();
        }
        if (
          statement.startsWith(`UPDATE ${operationTable}`) &&
          pending?.operation
        ) {
          const state: LeadPoolStoredRow['state'] = JSON.parse(
            String(parameters[0]),
          );
          if (
            transport.failSave &&
            state.batches[state.batches.length - 1]?.outcome === 'COMMITTED'
          ) {
            transport.failSave = false;
            throw new Error('Simulated result persistence failure');
          }
          pending.operation.state = state;
          return result([{ id: pending.operation.id }]);
        }
        if (statement.includes(`FROM ${membersTable} workspace_member`)) {
          if (statement.includes('"nameFirstName" AS "firstName"')) {
            return result([
              ...(includeActorRecipient && transport.actorActive
                ? [
                    {
                      id: actor.workspaceMemberId,
                      firstName: 'Ana',
                      isAssignable: true,
                    },
                  ]
                : []),
              ...(transport.recipientActive
                ? [
                    {
                      id: recipientId,
                      firstName: 'Ejecutivo',
                      isAssignable: true,
                    },
                  ]
                : []),
            ]);
          }
          return result(
            transport.actorActive && parameters[0] === actor.workspaceMemberId
              ? [{ id: actor.workspaceMemberId }]
              : [],
          );
        }
        if (
          statement.includes(
            'FOR SHARE OF member, membership, workspace_user',
          ) &&
          pending
        ) {
          return result([
            {
              id: actor.workspaceMemberId,
              userId: actor.user.id,
              userWorkspaceId: actor.userWorkspaceId,
            },
            ...(transport.recipientActive
              ? [
                  {
                    id: recipientId,
                    userId: recipientUserId,
                    userWorkspaceId: recipientUserWorkspaceId,
                  },
                ]
              : []),
          ]);
        }
        if (
          statement.startsWith('SELECT') &&
          statement.includes(`FROM ${table} "pool"`)
        ) {
          const scoped = statement.includes('"pool"."commercialOwnerId" IN (');
          const visible = [snapshot.record, ...extraRecords].filter(
            ({ commercialOwnerId }) =>
              !scoped || parameters.includes(commercialOwnerId),
          );
          if (statement.startsWith('SELECT COUNT(1)'))
            return result([{ count: String(visible.length) }]);
          const [, selectedIds] =
            statement.match(/(?:"pool"|pool)\."id" IN \(([^)]+)\)/) ?? [];
          const selection = selectedIds
            ?.match(/\$\d+/g)
            ?.map((position) => parameters[Number(position.slice(1)) - 1]);
          const selected = selection
            ? visible.filter(({ id }) => selection.includes(id))
            : visible;
          const paging = (keyword: string, fallback: number) => {
            const [, position] =
              statement.match(new RegExp(` ${keyword} (\\$?\\d+)`)) ?? [];
            if (!position) return fallback;
            return position.startsWith('$')
              ? Number(parameters[Number(position.slice(1)) - 1])
              : Number(position);
          };
          const offset = paging('OFFSET', 0);
          const rows = selected
            .slice(offset, offset + paging('LIMIT', selected.length))
            .map(({ id, commercialOwnerId, updatedAt, name }) => ({
              id,
              ownerId: commercialOwnerId,
              updatedAt,
              label: name,
            }));
          if (statement.endsWith('FOR UPDATE'))
            transport.afterLockedSelection();
          return result(rows);
        }
        if (
          statement.startsWith('SELECT') &&
          statement.includes(`FROM ${table} "${metadata.lead.nameSingular}"`) &&
          pending
        ) {
          const alias = metadata.lead.nameSingular;
          return result([
            Object.fromEntries(
              Object.entries(pending.record).map(([key, value]) => [
                `${alias}_${key}`,
                value,
              ]),
            ),
          ]);
        }
        if (
          statement.startsWith('SELECT') &&
          statement.includes(`FROM ${membersTable} "workspaceMember"`) &&
          pending
        ) {
          return result(
            transport.recipientActive && parameters.includes(recipientId)
              ? [{ id: recipientId }]
              : [],
          );
        }
        if (statement.startsWith(`UPDATE ${table}`) && pending) {
          if (transport.failUpdate)
            throw new Error('Simulated CRM update failure');
          const assignments = Object.fromEntries(
            [
              ...statement.split(' WHERE ')[0].matchAll(/"([^"]+)" = \$(\d+)/g),
            ].map(([, column, parameter]) => [
              column,
              parameters[Number(parameter) - 1],
            ]),
          );
          Object.assign(pending.record, assignments);
          const row: Record<string, unknown> = { id: recordId };
          for (const [, column, alias] of statement.matchAll(
            /"([^"]+)" AS "(__twenty_update_snapshot_\d+)"/g,
          )) {
            row[alias] = Reflect.get(pending.record, column);
          }
          return result([row]);
        }
        transport.unexpected.push(statement);
        throw new Error(`Unexpected offline SQL ${statement}`);
      },
    });
    return [client, transport.releasedWithError] as [
      typeof client,
      typeof transport.releasedWithError,
    ];
  };

  const primary = new GlobalWorkspaceDataSource(
    { type: 'postgres' },
    events,
    core,
  );
  jest
    .spyOn(core.driver as PostgresDriver, 'obtainMasterConnection')
    .mockImplementation(obtainConnection(false));
  jest
    .spyOn(primary.driver as PostgresDriver, 'obtainMasterConnection')
    .mockImplementation(obtainConnection(true));

  return { durable, transport, primary, metadata, table };
};
