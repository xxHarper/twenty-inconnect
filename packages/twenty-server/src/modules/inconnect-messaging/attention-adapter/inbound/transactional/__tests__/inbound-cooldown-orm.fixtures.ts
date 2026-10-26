import { isDeepStrictEqual } from 'node:util';

import { DataSource, EntitySchema, getMetadataArgsStorage } from 'typeorm';
import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { InconnectMessagingWebhookReceiptEntity as Receipt } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import { InconnectMessagingWebhookProcessingService as Worker } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-processing.service';
import { InconnectMessagingWebhookReceiptService as Recovery } from 'src/modules/inconnect-messaging/services/inconnect-messaging-webhook-receipt.service';
import { type InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';

import {
  INBOUND_ROUTE_SQL,
  INBOUND_ROUTE_PAUSE_CATEGORY,
} from '../inbound-route-boundary';

export type DriverQuery = {
  sql: string;
  parameters: unknown[];
  affected?: number | null;
};
export const cooldownIdentifier = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

// Only the pg boundary is substituted. Metadata comes from the real entity's
// columns, without loading its unrelated relation graph or opening a socket.
export const cooldownOrmFixture = async (
  initial: Partial<Receipt> = {},
  mode = 'PREPARING',
) => {
  const columns = Object.fromEntries(
    getMetadataArgsStorage()
      .columns.filter((column) => column.target === Receipt)
      .map((column) => {
        const options = column.options;
        if (!column.options.type)
          throw new Error('Missing declared column type');
        return [
          column.propertyName,
          {
            type: column.options.type,
            name: options.name,
            nullable: options.nullable,
            length: options.length,
            default: options.default,
            select: options.select,
            insert: options.insert,
            update: options.update,
            updateDate: column.mode === 'updateDate',
            createDate: column.mode === 'createDate',
            primary: column.mode === 'regular' && column.options.primary,
          },
        ];
      }),
  );
  const source = new DataSource({
    type: 'postgres',
    logging: false,
    entities: [
      new EntitySchema({
        name: Receipt.name,
        target: Receipt,
        schema: 'core',
        tableName: 'inconnectMessagingWebhookReceipt',
        columns,
      }),
    ],
  });
  await (
    source as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
  Object.assign(source, { isInitialized: true });
  const state: Receipt = Object.assign(new Receipt(), {
    id: cooldownIdentifier(1),
    workspaceId: cooldownIdentifier(2),
    providerConnectionId: cooldownIdentifier(3),
    eventKind: 'INBOUND_MESSAGE',
    idempotencyKey: 'SM-cooldown',
    payloadHash: 'a'.repeat(64),
    firstReceivedAt: new Date(Date.now() - 600_000),
    normalizedMetadata: {},
    processingState: 'RECEIVED',
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 4,
    error: null,
    processedAt: null,
    ingressContractVersion: 1,
    createdAt: new Date(Date.now() - 600_000),
    updatedAt: new Date(Date.now() - 600_000),
    ...initial,
  });
  // pg hydrates both SQL NULL and jsonb 'null' as JS null. Preserve the
  // database distinction separately so the CAS never inherits that ambiguity.
  let errorIsJsonNull = false;
  let databaseNow = new Date();
  let empty = false;
  let gateReads = 0;
  let gatePlan: ((count: number) => string) | undefined;
  let updateCount: number | null | undefined;
  let fault: ((query: DriverQuery) => void) | undefined;
  const queries: DriverQuery[] = [];
  const mismatches: string[] = [];
  const updates = () => queries.filter(({ sql }) => sql.startsWith('UPDATE '));
  const parameter = (query: DriverQuery, expression: RegExp) => {
    const match = query.sql.match(expression);
    if (!match) throw new Error(`Missing expected parameter: ${expression}`);
    return query.parameters[Number(match[1]) - 1];
  };
  const eligibleCooldown = (query: DriverQuery) => {
    expect(query.sql).toContain('clock_timestamp() - (');
    expect(query.sql).toContain("INTERVAL '1 millisecond'");
    const category = parameter(query, /IS DISTINCT FROM \$(\d+)/);
    const milliseconds = parameter(query, /clock_timestamp\(\) - \(\$(\d+)/);
    expect(category).toBe(INBOUND_ROUTE_PAUSE_CATEGORY);
    expect(milliseconds).toBe(60_000);
    return (
      state.eventKind !== 'INBOUND_MESSAGE' ||
      state.processingState !== 'RECEIVED' ||
      state.error?.category !== category ||
      state.updatedAt.getTime() <= databaseNow.getTime() - Number(milliseconds)
    );
  };
  // Controllable pg lock responses model two sessions. This is not MVCC or
  // physical lock evidence; predicates and lifecycle still come from TypeORM.
  let unlock: (() => void) | undefined;
  let locked: Promise<void> | undefined;
  jest
    .spyOn(source.driver as PostgresDriver, 'obtainMasterConnection')
    .mockImplementation(async () => {
      let ownsLock = false;
      return [
        {
          on: jest.fn(),
          removeListener: jest.fn(),
          query: async (sql: string, parameters: unknown[] = []) => {
            const query: DriverQuery = { sql, parameters };
            queries.push(query);
            fault?.(query);
            try {
              if (sql === INBOUND_ROUTE_SQL) {
                gateReads++;
                return {
                  rows: [
                    {
                      columns: 3,
                      mode: gatePlan?.(gateReads) ?? mode,
                      protocolVersion: 1,
                      gateUpdatedAt: '2026-10-26T01:00:00Z',
                    },
                  ],
                  rowCount: 1,
                  command: 'SELECT',
                };
              }
              if (
                /^(START TRANSACTION|SET TRANSACTION|COMMIT|ROLLBACK)/.test(sql)
              ) {
                if (ownsLock && /^(COMMIT|ROLLBACK)/.test(sql)) {
                  ownsLock = false;
                  const release = unlock;
                  unlock = undefined;
                  locked = undefined;
                  release?.();
                }
                return { rows: [], rowCount: null, command: sql };
              }
              if (sql.startsWith('SELECT ')) {
                expect(sql).toContain(
                  'FROM "core"."inconnectMessagingWebhookReceipt"',
                );
                if (sql.includes('FOR UPDATE')) {
                  if (locked) await locked;
                  ownsLock = true;
                  locked = new Promise<void>((resolve) => {
                    unlock = resolve;
                  });
                }
                let include = !empty;
                if (sql.includes('IS DISTINCT FROM'))
                  include = include && eligibleCooldown(query);
                if (sql.includes('ORDER BY')) {
                  const received = parameter(
                    query,
                    /"processingState" = \$(\d+)/,
                  );
                  const processing = parameter(
                    query,
                    /OR \(\(\("[^"]+"\."processingState" = \$(\d+)/,
                  );
                  const deadline = parameter(
                    query,
                    /"leaseExpiresAt" <= \$(\d+)/,
                  ) as Date;
                  include =
                    !empty &&
                    ((state.processingState === received &&
                      eligibleCooldown(query)) ||
                      (state.processingState === processing &&
                        state.leaseExpiresAt !== null &&
                        state.leaseExpiresAt <= deadline));
                }
                const row: Record<string, unknown> = {};
                for (const match of sql.matchAll(
                  /"[^"]+"\."([^"]+)" AS "([^"]+)"/g,
                ))
                  row[match[2]] = structuredClone(
                    state[match[1] as keyof Receipt],
                  );
                return {
                  rows: include ? [row] : [],
                  rowCount: include ? 1 : 0,
                  command: 'SELECT',
                };
              }
              if (sql.startsWith('UPDATE ')) {
                const [assignment, where] = sql.split(' WHERE ');
                if (!where) throw new Error('Unscoped update');
                let matches = [...where.matchAll(/"([^"]+)" = \$(\d+)/g)].every(
                  (match) =>
                    state[match[1] as keyof Receipt] ===
                    parameters[Number(match[2]) - 1],
                );
                for (const match of where.matchAll(/"([^"]+)" IS NULL/g))
                  matches &&= state[match[1] as keyof Receipt] === null;
                if (where.includes('IS NOT DISTINCT FROM CAST')) {
                  const previous = parameter(
                    query,
                    /IS NOT DISTINCT FROM CAST\(\$(\d+)/,
                  );
                  // pg binds null/undefined as SQL NULL; a text "null" casts
                  // to the non-SQL-NULL JSON scalar. Compare parsed JSON values.
                  const parameterIsSqlNull =
                    previous === null || previous === undefined;
                  const columnIsSqlNull =
                    state.error === null && !errorIsJsonNull;
                  const parsed: unknown = parameterIsSqlNull
                    ? null
                    : typeof previous === 'string'
                      ? JSON.parse(previous)
                      : previous;
                  matches &&=
                    columnIsSqlNull || parameterIsSqlNull
                      ? columnIsSqlNull && parameterIsSqlNull
                      : isDeepStrictEqual(state.error, parsed);
                }
                if (where.includes('"leaseExpiresAt" <= clock_timestamp()'))
                  matches &&=
                    state.leaseExpiresAt !== null &&
                    state.leaseExpiresAt <= databaseNow;
                if (where.includes('IS DISTINCT FROM'))
                  matches &&= eligibleCooldown(query);
                query.affected = !matches
                  ? 0
                  : updateCount !== undefined
                    ? updateCount
                    : 1;
                if (query.affected !== 1)
                  return {
                    rows: [],
                    rowCount: query.affected,
                    command: 'UPDATE',
                  };
                if (assignment.includes('"attemptCount" - 1'))
                  state.attemptCount--;
                for (const match of assignment.matchAll(
                  /"([^"]+)" = \$(\d+)/g,
                )) {
                  const value = parameters[Number(match[2]) - 1];
                  if (match[1] === 'error') errorIsJsonNull = value === 'null';
                  Object.assign(state, {
                    [match[1]]:
                      ['error', 'normalizedMetadata'].includes(match[1]) &&
                      typeof value === 'string'
                        ? JSON.parse(value)
                        : structuredClone(value),
                  });
                }
                if (
                  /"updatedAt" = (CURRENT_TIMESTAMP|clock_timestamp\(\))/.test(
                    assignment,
                  )
                )
                  state.updatedAt = new Date(databaseNow);
                return {
                  rows: sql.includes('RETURNING')
                    ? [{ updatedAt: state.updatedAt }]
                    : [],
                  rowCount: 1,
                  command: 'UPDATE',
                };
              }
              throw new Error('Unexpected SQL at simulated pg boundary');
            } catch (error) {
              // Fault injection is intentional; protocol/assertion mismatches must
              // remain visible even if the production worker catches the error.
              mismatches.push(String(error));
              throw error;
            }
          },
        },
        jest.fn(),
      ];
    });
  const outbox = { requestPublication: jest.fn() };
  const worker = () =>
    new Worker(source, outbox as unknown as InconnectMessagingOutboxService);
  const add = jest.fn();
  const recovery = new Recovery(source, source.getRepository(Receipt), {
    add,
  } as unknown as MessageQueueService);
  return {
    source,
    state,
    queries,
    updates,
    worker,
    recovery,
    add,
    advance: (milliseconds: number) => {
      databaseNow = new Date(databaseNow.getTime() + milliseconds);
    },
    databaseNow: () => new Date(databaseNow),
    setJsonNull: () => {
      state.error = null;
      errorIsJsonNull = true;
    },
    setEmpty: () => {
      empty = true;
    },
    setMode: (value: string) => {
      mode = value;
    },
    setGatePlan: (plan: (count: number) => string) => {
      gatePlan = plan;
    },
    setUpdateCount: (value: number | null) => {
      updateCount = value;
    },
    setFault: (value: (query: DriverQuery) => void) => {
      fault = value;
    },
    done: () => expect(mismatches).toEqual([]),
  };
};
