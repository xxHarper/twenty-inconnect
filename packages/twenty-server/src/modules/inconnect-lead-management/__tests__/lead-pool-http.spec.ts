import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

import { type Server as HttpServer } from 'node:http';
import { Server, Socket } from 'node:net';
import { ApiPath, type LeadPoolOperation } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource } from 'typeorm';

import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { USER_SESSION_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-cookie-name.constant';
import { type CachedUserSession } from 'src/engine/core-modules/user-session/types/cached-user-session.type';
import { hashUserSessionToken } from 'src/engine/core-modules/user-session/utils/hash-user-session-token.util';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  type WorkspaceCacheDataMap,
  type WorkspaceCacheKeyName,
  type WorkspaceCacheResultWithHashes,
} from 'src/engine/workspace-cache/types/workspace-cache-key.type';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';

import { roleId } from './lead-pool-composition-metadata.fixture';
import { makeCompositionTransport } from './lead-pool-composition-transport.fixture';
import { compileLeadPoolHttpApp } from './lead-pool-http-app.fixture';
import { postInProcess } from './lead-pool-http-transport.fixture';
import {
  actor,
  originId,
  poolId,
  poolInput,
  recipientId,
} from './lead-pool.fixtures';

const origin = 'http://lead-pool.invalid';
const url = new URL(`/${ApiPath.Metadata}`, origin);
const sessionToken = 'sess_lead-pool-http';
const wrongWorkspaceId = poolId(92);
const apiKeyId = poolId(93);
const catalogQuery = '{ inconnectLeadPoolCatalog }';
const operationDocument = (name: string, kind = 'query') =>
  `${kind} ($input: JSONObject!) { ${name}(input: $input) }`;
const listInput = { objectId: originId, filter: {}, offset: 0, first: 1 };
const [recordId, secondRecordId] = poolInput(2).recordIds;

type GraphqlResponse = {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

const infrastructureAttempts: string[] = [];
let app: Awaited<ReturnType<typeof compileLeadPoolHttpApp>>;
let fixture: Awaited<ReturnType<typeof makeCompositionTransport>>;
let session: CachedUserSession;
let update: jest.SpiedFunction<
  CommonUpdateManyQueryRunnerService['executeWithQueryRunner']
>;
let catalog: jest.SpiedFunction<LeadPoolService['catalog']>;
let workspaceGuard: jest.SpiedFunction<WorkspaceAuthGuard['canActivate']>;
let userGuard: jest.SpiedFunction<UserAuthGuard['canActivate']>;
let customPermissionGuard: jest.SpiedFunction<
  CustomPermissionGuard['canActivate']
>;
let resetTransport: () => Promise<typeof fixture>;

const workspace = {
  ...actor.workspace,
  activationStatus: WorkspaceActivationStatus.ACTIVE,
};
const member = {
  ...actor.workspaceMember,
  name: { firstName: 'Ana', lastName: 'Operadora' },
};
const userWorkspace = {
  id: actor.userWorkspaceId,
  workspaceId: workspace.id,
  userId: actor.user.id,
};
const expectedAuthContext = {
  type: 'user',
  workspace,
  user: actor.user,
  userWorkspaceId: userWorkspace.id,
  workspaceMemberId: member.id,
  workspaceMember: member,
};

const readCoreCache = (async (entity: string, id: string) => {
  switch (entity) {
    case 'workspaceEntity':
      if (id === workspace.id) return workspace;
      if (id === wrongWorkspaceId) return { ...workspace, id };
      return null;
    case 'user':
      return id === actor.user.id ? actor.user : null;
    case 'userWorkspaceEntity':
      return id === userWorkspace.id ? userWorkspace : null;
    default:
      throw new Error(`Unexpected auth cache read for ${entity}`);
  }
}) as CoreEntityCacheService['get'];

const readWorkspaceCache = async <Keys extends WorkspaceCacheKeyName[]>(
  workspaceId: string,
  keys: Keys,
): Promise<WorkspaceCacheResultWithHashes<Keys>> => {
  expect(workspaceId).toBe(workspace.id);
  const cacheData: Partial<WorkspaceCacheDataMap> = {
    ...fixture.metadata.maps,
    flatWorkspaceMemberMaps: {
      ...fixture.metadata.maps.flatWorkspaceMemberMaps,
      idByUserId: { [actor.user.id]: member.id },
      byId: {
        ...fixture.metadata.maps.flatWorkspaceMemberMaps.byId,
        [member.id]: member,
      },
    },
    apiKeyMap: {
      [apiKeyId]: {
        id: apiKeyId,
        name: 'Fixture API key',
        workspaceId: workspace.id,
        createdAt: session.authenticatedAt,
        updatedAt: session.authenticatedAt,
        expiresAt: session.expiresAt,
        revokedAt: null,
      },
    },
  };
  const entries = keys.map((key) => {
    if (!(key in cacheData))
      throw new Error(`Unexpected cache read for ${key}`);
    return [key, cacheData[key]];
  });

  return {
    data: Object.fromEntries(entries) as Pick<
      WorkspaceCacheDataMap,
      Keys[number]
    >,
    hashes: Object.fromEntries(keys.map((key) => [key, 'fixture'])) as Record<
      Keys[number],
      string
    >,
  };
};

const stopInfrastructure = (operation: string) => () => {
  infrastructureAttempts.push(operation);
  throw new Error(`Unexpected ${operation}`);
};

beforeAll(async () => {
  jest.useRealTimers();
  jest
    .spyOn(Socket.prototype, 'connect')
    .mockImplementation(stopInfrastructure('connect'));
  jest
    .spyOn(Server.prototype, 'listen')
    .mockImplementation(stopInfrastructure('listen'));
  jest
    .spyOn(DataSource.prototype, 'initialize')
    .mockImplementation(stopInfrastructure('initialize'));
  jest
    .spyOn(DataSource.prototype, 'runMigrations')
    .mockImplementation(stopInfrastructure('migration'));
  workspaceGuard = jest.spyOn(WorkspaceAuthGuard.prototype, 'canActivate');
  userGuard = jest.spyOn(UserAuthGuard.prototype, 'canActivate');
  customPermissionGuard = jest.spyOn(
    CustomPermissionGuard.prototype,
    'canActivate',
  );
  const core = new DataSource({ type: 'postgres' });
  const events = new WorkspaceEventEmitter(new EventEmitter2());

  app = await compileLeadPoolHttpApp({
    core,
    getPrimary: () => fixture.primary,
    readWorkspaceCache,
    readCoreCache,
    readSessionCache: async (hash) =>
      hash === hashUserSessionToken(sessionToken) ? session : undefined,
  });
  // The same DataSource instance is injected throughout the app.
  resetTransport = async () =>
    makeCompositionTransport(core, events, {
      includeActorRecipient: true,
      recordCount: 2,
    });
  await app.init();
  update = jest.spyOn(
    app.get(CommonUpdateManyQueryRunnerService),
    'executeWithQueryRunner',
  );
  catalog = jest.spyOn(app.get(LeadPoolService), 'catalog');
}, 30_000);

beforeEach(async () => {
  const now = new Date().toISOString();
  session = {
    sessionId: poolId(91),
    workspaceId: workspace.id,
    userWorkspaceId: userWorkspace.id,
    userId: actor.user.id,
    authProvider: AuthProviderEnum.Password,
    isImpersonating: false,
    impersonatorUserWorkspaceId: null,
    impersonatedUserWorkspaceId: null,
    authenticatedAt: now,
    lastActiveAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  fixture = await resetTransport();
});

afterEach(() => {
  if (fixture) expect(fixture.transport.unexpected).toEqual([]);
  expect(infrastructureAttempts).toEqual([]);
});

afterAll(async () => {
  try {
    await app?.close();
    expect(infrastructureAttempts).toEqual([]);
  } finally {
    jest.restoreAllMocks();
  }
});

const send = async (
  query: string,
  input?: unknown,
  headers: Record<string, string> = {
    origin,
    cookie: `${USER_SESSION_COOKIE_NAME}=${sessionToken}`,
  },
) => {
  const server = app.getHttpServer() as HttpServer;
  expect(server.listening).toBe(false);
  const response = await postInProcess(
    server,
    url,
    { query, variables: { input } },
    headers,
  );
  expect(response.headers['content-type']).toContain('application/json');
  return { ...response, graphql: JSON.parse(response.body) as GraphqlResponse };
};

const call = (name: string, input: unknown, kind?: 'mutation') =>
  send(operationDocument(name, kind), input);
const data = <T>(response: Awaited<ReturnType<typeof send>>, key: string) => {
  expect(response.status).toBe(200);
  expect(response.graphql.errors).toBeUndefined();
  expect(response.graphql.data).toHaveProperty(key);
  return response.graphql.data?.[key] as T;
};
const preview = async (input: unknown = poolInput(1)) =>
  data<LeadPoolOperation>(
    await call('previewInconnectLeadPool', input, 'mutation'),
    'previewInconnectLeadPool',
  );
const crmWrites = () =>
  fixture.transport.queries.filter(({ statement }) =>
    statement.startsWith(`UPDATE ${fixture.table}`),
  );

const expectError = (
  response: Awaited<ReturnType<typeof send>>,
  code: string,
  message?: string,
) => {
  expect(response.status).toBe(200);
  expect(response.graphql.data ?? null).toBeNull();
  expect(response.graphql.errors).toHaveLength(1);
  const [error] = response.graphql.errors ?? [];
  expect(error.extensions?.code).toBe(code);
  if (message !== undefined) expect(error.message).toBe(message);
  expect(response.body).not.toContain(fixture.durable.record.name);
  expect(response.body).not.toContain(recordId);
  expect(response.body).not.toContain('stacktrace');
  return error;
};

it('rejects a request without credentials at the real Workspace guard', async () => {
  expectError(await send(catalogQuery, undefined, {}), 'FORBIDDEN');
  expect(workspaceGuard).toHaveReturnedWith(false);
  expect(userGuard).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(fixture.transport.queries).toEqual([]);
});

it('rejects a missing session and clears the dead cookie', async () => {
  const response = await send(catalogQuery, undefined, {
    origin,
    cookie: `${USER_SESSION_COOKIE_NAME}=sess_unknown`,
  });

  expectError(response, 'UNAUTHENTICATED');
  expect(response.headers['set-cookie']?.join(' ')).toContain(
    `${USER_SESSION_COOKIE_NAME}=;`,
  );
  expect(workspaceGuard).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(fixture.transport.queries).toEqual([]);
});

it('rejects a workspace that does not match the current UserWorkspace', async () => {
  session.workspaceId = wrongWorkspaceId;

  expectError(await send(catalogQuery), 'UNAUTHENTICATED');
  expect(workspaceGuard).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(fixture.transport.queries).toEqual([]);
});

it('applies the real CSRF middleware before authenticating a session cookie', async () => {
  const response = await send(catalogQuery, undefined, {
    origin: 'http://foreign.invalid',
    cookie: `${USER_SESSION_COOKIE_NAME}=${sessionToken}`,
  });

  expect(response.status).toBe(403);
  expect(response.graphql).toMatchObject({ error: 'CSRF_ORIGIN_MISMATCH' });
  expect(workspaceGuard).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
});

it('rejects a verified API key at the real User guard', async () => {
  const secret = app
    .get(JwtWrapperService)
    .generateAppSecret(JwtTokenTypeEnum.API_KEY, workspace.id);
  const token = app.get(JwtService).sign(
    {
      type: JwtTokenTypeEnum.API_KEY,
      sub: workspace.id,
      workspaceId: workspace.id,
      jti: apiKeyId,
    },
    { secret, expiresIn: '1m' },
  );

  expectError(
    await send(catalogQuery, undefined, {
      authorization: `Bearer ${token}`,
    }),
    'FORBIDDEN',
  );
  expect(workspaceGuard).toHaveReturnedWith(true);
  expect(userGuard).toHaveReturnedWith(false);
  expect(customPermissionGuard).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(fixture.transport.queries).toEqual([]);
});

it('rejects a member whose current live membership is inactive', async () => {
  fixture.transport.actorActive = false;

  expectError(await send(catalogQuery), 'FORBIDDEN');
  expect(userGuard).toHaveReturnedWith(true);
  expect(catalog).toHaveBeenCalledTimes(1);
  expect(
    fixture.transport.queries.some(({ statement }) =>
      statement.includes(fixture.table),
    ),
  ).toBe(false);
});

it.each(['object', 'owner field'] as const)(
  'denies an authenticated member without %s update permission',
  async (permission) => {
    const objectPermission =
      fixture.metadata.maps.rolesPermissions[roleId]![originId]!;
    if (permission === 'object')
      objectPermission.canUpdateObjectRecords = false;
    else
      objectPermission.restrictedFields[fixture.metadata.owner.id] = {
        canUpdate: false,
      };

    expectError(await call('inconnectLeadPoolRecords', listInput), 'FORBIDDEN');
    expect(customPermissionGuard).toHaveReturnedWith(true);
    expect(
      fixture.transport.queries.some(({ statement }) =>
        statement.includes(fixture.table),
      ),
    ).toBe(false);
  },
);

it('serializes the catalog and eligible pages with the authenticated human context', async () => {
  expect(data(await send(catalogQuery), 'inconnectLeadPoolCatalog')).toEqual({
    objects: [{ id: originId, label: fixture.metadata.lead.labelPlural }],
    storageReady: true,
    allMatchingReady: false,
    messagingClassification: 'NOT_READY',
    blockedReason: null,
  });
  expect(catalog).toHaveBeenCalledWith(expectedAuthContext);
  expect(workspaceGuard).toHaveReturnedWith(true);
  expect(userGuard).toHaveReturnedWith(true);
  expect(customPermissionGuard).toHaveReturnedWith(true);

  for (const [offset, id, label] of [
    [0, recordId, 'Prospecto'],
    [1, secondRecordId, `Prospecto ${secondRecordId}`],
  ] as const) {
    const response = await call('inconnectLeadPoolRecords', {
      ...listInput,
      offset,
    });

    expect(data(response, 'inconnectLeadPoolRecords')).toMatchObject({
      total: 2,
      offset,
      records: [{ id, label, ownerId: actor.workspaceMemberId }],
      recipients: [
        { id: actor.workspaceMemberId, label: 'Ana' },
        { id: recipientId, label: 'Ejecutivo' },
      ],
    });
  }
  fixture.durable.record.commercialOwnerId = poolId(94);
  const scoped = await call('inconnectLeadPoolRecords', listInput);
  expect(data(scoped, 'inconnectLeadPoolRecords')).toMatchObject({
    total: 1,
    offset: 0,
    records: [{ id: secondRecordId, ownerId: actor.workspaceMemberId }],
  });
  expect(scoped.body).not.toContain(recordId);
});

it('rejects invalid GraphQL input shape and rejects unknown or invalid service arguments', async () => {
  const malformed = await call('inconnectLeadPoolRecords', ['invalid']);
  expect(malformed.graphql.errors?.[0]?.message).toMatch(/JSONObject/);
  expect(malformed.graphql.data).toBeUndefined();
  expect(fixture.transport.queries).toEqual([]);

  expectError(
    await call('inconnectLeadPoolRecords', { ...listInput, first: 0 }),
    'GRAPHQL_VALIDATION_FAILED',
  );
  expectError(
    await call('inconnectLeadPoolRecords', {
      ...listInput,
      workspaceId: wrongWorkspaceId,
    }),
    'GRAPHQL_VALIDATION_FAILED',
  );
  expectError(
    await call('inconnectLeadPoolOperation', { operationId: 'not-a-uuid' }),
    'GRAPHQL_VALIDATION_FAILED',
  );
  expect(fixture.transport.queries).toEqual([]);
});

it.each([
  ['VALIDATION', 'BAD_USER_INPUT', { batchSize: 0 }],
  ['PERMISSION', 'FORBIDDEN', {}],
] as const)(
  'preserves the public preview rejection extension for %s after confirmed rollback',
  async (reason, code, changes) => {
    if (reason === 'PERMISSION')
      fixture.durable.record.commercialOwnerId = poolId(94);
    const input = { ...poolInput(1), ...changes };

    const error = expectError(
      await call('previewInconnectLeadPool', input, 'mutation'),
      code,
    );

    expect(error.extensions?.leadPoolPreview).toEqual({
      outcome: 'REJECTED',
      intentionId: input.intentionId,
      reason,
    });
    expect(
      fixture.transport.queries.map(({ statement }) => statement),
    ).toContain('ROLLBACK');
    expect(fixture.durable.operation).toBeUndefined();
    expect(crmWrites()).toHaveLength(0);
  },
);

it('withholds the preview rejection extension when the intention is already stored', async () => {
  const prepared = await preview();
  const error = expectError(
    await call(
      'previewInconnectLeadPool',
      { ...poolInput(1), batchSize: 0 },
      'mutation',
    ),
    'GRAPHQL_VALIDATION_FAILED',
  );

  expect(error.extensions).not.toHaveProperty('leadPoolPreview');
  expect(fixture.durable.operation?.id).toBe(prepared.id);
});

it('redacts record details when current scope changes after preview', async () => {
  const prepared = await preview();
  fixture.durable.record.commercialOwnerId = poolId(94);

  const response = await call('inconnectLeadPoolOperation', {
    operationId: prepared.id,
  });

  expect(data(response, 'inconnectLeadPoolOperation')).toMatchObject({
    id: prepared.id,
    items: [],
    hiddenItems: 1,
  });
  expect(response.body).not.toContain(recordId);
  expect(response.body).not.toContain(fixture.durable.record.name);
});

it('previews, recovers by UUID and confirms only the requested version through Common Update', async () => {
  const prepared = await preview();
  expect(prepared).toMatchObject({
    status: 'PREVIEW',
    mode: 'SINGLE',
    version: 0,
    processed: 0,
    items: [{ recordId, status: 'PENDING' }],
  });
  expect(await preview()).toEqual(prepared);
  const locate = { operationId: prepared.id };
  const execute = async (expectedVersion: number) =>
    call(
      'executeInconnectLeadPool',
      { ...locate, expectedVersion },
      'mutation',
    );

  expect(
    data(
      await call('inconnectLeadPoolOperation', locate),
      'inconnectLeadPoolOperation',
    ),
  ).toEqual(prepared);
  expectError(
    await call('inconnectLeadPoolOperation', { operationId: poolId(97) }),
    'NOT_FOUND',
    'Operation unavailable',
  );
  expectError(await execute(1), 'CONFLICT', 'Invalid operation version');
  expect(update).not.toHaveBeenCalled();

  const completed = data(await execute(0), 'executeInconnectLeadPool');
  expect(completed).toMatchObject({
    id: prepared.id,
    status: 'COMPLETED',
    version: 1,
    processed: 1,
    counts: { CHANGED: 1 },
    items: [{ recordId, status: 'CHANGED' }],
  });
  expect(data(await execute(0), 'executeInconnectLeadPool')).toEqual(completed);
  expect(update).toHaveBeenCalledTimes(1);
  const [, context] = update.mock.calls[0];
  expect(context.authContext).toEqual(expectedAuthContext);
  expect(crmWrites()).toHaveLength(1);
  expect(fixture.durable.record).toMatchObject({
    commercialOwnerId: recipientId,
    updatedByWorkspaceMemberId: member.id,
  });
  expect(completed).not.toHaveProperty('authorityHash');
  expect(completed).not.toHaveProperty('requestHash');
});

it.each([
  ['EVEN', undefined, [1, 1], 0],
  [
    'MANUAL_QUOTAS',
    [
      { recipientId: actor.workspaceMemberId, quantity: 0 },
      { recipientId, quantity: 1 },
    ],
    [0, 1],
    1,
  ],
] as const)(
  'preserves %s allocation and cancels idempotently',
  async (mode, quotas, quantities, remaining) => {
    const prepared = await preview({
      ...poolInput(2),
      mode,
      recipientIds: [actor.workspaceMemberId, recipientId],
      ...(quotas ? { quotas } : {}),
    });

    expect(prepared).toMatchObject({
      mode,
      plannedRemaining: remaining,
      processed: 0,
    });
    expect(prepared.recipients.map(({ quantity }) => quantity)).toEqual(
      quantities,
    );
    const cancel = async () =>
      data(
        await call(
          'cancelInconnectLeadPool',
          { operationId: prepared.id, expectedVersion: 0 },
          'mutation',
        ),
        'cancelInconnectLeadPool',
      );
    const cancelled = await cancel();
    expect(cancelled).toMatchObject({
      id: prepared.id,
      status: 'CANCELLED',
      version: 1,
      counts: { REMAINING: 2 },
    });
    expect(await cancel()).toEqual(cancelled);
    expect(update).not.toHaveBeenCalled();
  },
);

it('returns uncertainty after a lost commit response and recovers the existing result without replay', async () => {
  const prepared = await preview();
  const locate = { operationId: prepared.id };
  fixture.transport.loseCommitResponse = true;
  fixture.transport.failReconciliation = true;

  const failed = await call(
    'executeInconnectLeadPool',
    { ...locate, expectedVersion: 0 },
    'mutation',
  );
  expectError(failed, '503', 'Internal Server Error');
  expect(failed.graphql.errors?.[0]?.extensions).not.toHaveProperty(
    'leadPoolPreview',
  );
  expect(fixture.transport.releasedWithError).toHaveBeenCalledWith(
    expect.any(Error),
  );
  expect(update).toHaveBeenCalledTimes(1);

  fixture.transport.failReconciliation = false;
  const recovered = data(
    await call('inconnectLeadPoolOperation', locate),
    'inconnectLeadPoolOperation',
  );
  expect(recovered).toMatchObject({
    id: prepared.id,
    status: 'COMPLETED',
    version: 1,
    counts: { CHANGED: 1 },
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(crmWrites()).toHaveLength(1);
});

it('withholds definitive rejection when the preview commit response is lost', async () => {
  fixture.transport.loseCommitResponse = true;
  const input = poolInput(1);

  const lost = await call('previewInconnectLeadPool', input, 'mutation');

  expectError(lost, 'INTERNAL_SERVER_ERROR');
  expect(lost.graphql.errors?.[0]?.extensions).not.toHaveProperty(
    'leadPoolPreview',
  );
  const recovered = await preview(input);
  expect(recovered).toMatchObject({
    id: fixture.durable.operation?.id,
    intentionId: input.intentionId,
    status: 'PREVIEW',
    version: 0,
  });
  expect(
    fixture.transport.queries.filter(({ statement }) =>
      statement.startsWith('INSERT '),
    ),
  ).toHaveLength(1);
  expect(crmWrites()).toHaveLength(0);
});
