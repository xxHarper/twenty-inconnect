import { InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, renderHook } from '@testing-library/react';
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock';
import { type PropsWithChildren } from 'react';
import { type LeadPoolOperation } from 'twenty-shared/types';

import { TRACK_ANALYTICS } from '@/analytics/graphql/queries/track';
import { ApolloFactory } from '@/apollo/services/apollo.factory';
import { createCaptchaRefreshLink } from '@/apollo/utils/captchaRefreshLink';
import { TOKEN_PAIR_LOCAL_STORAGE_KEY } from '@/auth/states/tokenPairState';
import { leadPoolTestTokenPair } from '@/inconnect-lead-management/__tests__/fixtures/leadPoolTestTokenPair';
import { LEAD_POOL_OPERATION } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import { useLeadPool } from '@/inconnect-lead-management/hooks/useLeadPool';
import { AnalyticsType } from '~/generated-metadata/graphql';

enableFetchMocks();

const objectId = '99999999-1111-4111-8111-000000000010';
const operationId = '99999999-1111-4111-8111-000000000050';
const recipientId = '99999999-1111-4111-8111-000000000020';
const intentionId = '99999999-1111-4111-8111-000000000090';
const recordIds = [
  '99999999-1111-4111-8111-000000000031',
  '99999999-1111-4111-8111-000000000032',
];
const recoveryVariables = { input: { operationId } };
const previewOperation: LeadPoolOperation = {
  id: operationId,
  intentionId,
  objectId,
  mode: 'SINGLE',
  status: 'PREVIEW',
  version: 0,
  found: 2,
  selected: 2,
  authorized: 2,
  plannedChanges: 2,
  plannedUnchanged: 0,
  plannedRemaining: 0,
  processed: 0,
  lastBatchError: null,
  batchFailures: 0,
  counts: {
    CHANGED: 0,
    UNCHANGED: 0,
    CONFLICT: 0,
    REJECTED: 0,
    FAILED: 0,
    REMAINING: 0,
    PENDING: 2,
  },
  recipients: [
    { id: recipientId, label: 'Recipient', assignable: true, quantity: 2 },
  ],
  canExecute: true,
  items: [],
  hiddenItems: 2,
  expiresAt: '2026-10-27T00:00:00.000Z',
};

const runningOperation: LeadPoolOperation = {
  ...previewOperation,
  status: 'RUNNING',
  version: 1,
  processed: 1,
  counts: { ...previewOperation.counts, CHANGED: 1, PENDING: 1 },
};

const completedOperation: LeadPoolOperation = {
  ...runningOperation,
  status: 'COMPLETED',
  version: 2,
  processed: 2,
  counts: { ...runningOperation.counts, CHANGED: 2, PENDING: 0 },
};

const cancelledOperation: LeadPoolOperation = {
  ...runningOperation,
  status: 'CANCELLED',
  version: 2,
  counts: { ...runningOperation.counts, PENDING: 0, REMAINING: 1 },
};

const identity = {
  workspaceId: '99999999-1111-4111-8111-000000000001',
  actorUserId: '99999999-1111-4111-8111-000000000002',
  workspaceMemberId: '99999999-1111-4111-8111-000000000003',
};
const session = { identity, isCurrent: () => true };

const createClient = () =>
  new ApolloFactory({
    uri: 'http://localhost:3000/metadata',
    cache: new InMemoryCache(),
    currentWorkspace: null,
    currentWorkspaceMember: null,
    extraLinks: [createCaptchaRefreshLink(jest.fn())],
  }).getClient();

const renderPool = (client = createClient()) =>
  renderHook(() => useLeadPool(objectId, session), {
    wrapper: ({ children }: PropsWithChildren) => (
      <ApolloProvider client={client}>{children}</ApolloProvider>
    ),
  }).result;

const responseBody = (data: Record<string, unknown>) =>
  JSON.stringify({ data });

const settleRequest = async (request: () => Promise<void>) => {
  await act(async () => {
    const pending = request();
    await jest.runAllTimersAsync();
    await pending;
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.resetMocks();
  localStorage.setItem(
    TOKEN_PAIR_LOCAL_STORAGE_KEY,
    JSON.stringify(
      leadPoolTestTokenPair(
        identity.workspaceId,
        identity.actorUserId,
        identity.workspaceMemberId,
        'transport',
      ),
    ),
  );
});

afterEach(() => {
  localStorage.removeItem(TOKEN_PAIR_LOCAL_STORAGE_KEY);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('sends preview once on response loss and keeps the exact intention for explicit recovery', async () => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  const previewResponse = responseBody({
    previewInconnectLeadPool: previewOperation,
  });
  fetchMock
    .mockRejectOnce(new Error('Preview response lost'))
    .mockResponse(previewResponse);

  await settleRequest(() =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(pool.current).toMatchObject({
    operation: null,
    knownOperationId: null,
    hasIntention: true,
    unresolved: true,
    error: 'Preview response lost',
  });
  const originalRequest = fetchMock.mock.calls[0][1]?.body;
  expect(originalRequest).toEqual(
    expect.stringContaining('PreviewInconnectLeadPool'),
  );

  act(() => pool.current.reset());
  act(() => pool.current.select(['another-lead']));
  await settleRequest(() =>
    pool.current.preview('EVEN', ['another-recipient'], undefined, 2),
  );

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(originalRequest);
  expect(pool.current.operation).toEqual(previewOperation);
  expect(pool.current.unresolved).toBe(false);
});

it.each([
  {
    action: 'advance',
    operationName: 'ExecuteInconnectLeadPool',
    mutationField: 'executeInconnectLeadPool',
    recoveredOperation: runningOperation,
  },
  {
    action: 'cancel',
    operationName: 'CancelInconnectLeadPool',
    mutationField: 'cancelInconnectLeadPool',
    recoveredOperation: {
      ...previewOperation,
      status: 'CANCELLED',
      version: 1,
      canExecute: false,
      counts: { ...previewOperation.counts, REMAINING: 2, PENDING: 0 },
    },
  },
] as const)(
  'sends $operationName once on response loss and waits for explicit recovery',
  async ({ action, operationName, mutationField, recoveredOperation }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: previewOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(previewOperation);

    fetchMock.mockClear();
    fetchMock
      .mockRejectOnce(new Error('Mutation response lost'))
      .mockResponse(responseBody({ [mutationField]: recoveredOperation }));
    await settleRequest(() => pool.current[action]());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toEqual(
      expect.stringContaining(operationName),
    );
    expect(pool.current).toMatchObject({
      operation: null,
      knownOperationId: operationId,
      hasIntention: false,
      unresolved: true,
      error: 'Mutation response lost',
    });

    act(() => pool.current.reset());
    await settleRequest(() => pool.current.advance());
    await settleRequest(() => pool.current.cancel());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.current.unresolved).toBe(true);

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: recoveredOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toEqual(
      expect.stringContaining('InconnectLeadPoolOperation'),
    );
    expect(pool.current.operation).toEqual(recoveredOperation);
    expect(pool.current.unresolved).toBe(false);
  },
);

it('waits for a late execute response and keeps confirmed progress when recovery fails with older data in cache', async () => {
  const client = createClient();
  const pool = renderPool(client);
  client.writeQuery({
    query: LEAD_POOL_OPERATION,
    variables: recoveryVariables,
    data: { inconnectLeadPoolOperation: previewOperation },
  });
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: previewOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  fetchMock.mockClear();
  fetchMock.mockResponseOnce(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(responseBody({ executeInconnectLeadPool: runningOperation }));
        }, 6000);
      }),
  );

  await act(async () => {
    const execution = pool.current.advance();
    await pool.current.advance();
    await pool.current.recover(operationId);
    await jest.advanceTimersByTimeAsync(5999);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await execution;
  });

  expect(pool.current.operation).toEqual(runningOperation);
  expect(
    client.readQuery({
      query: LEAD_POOL_OPERATION,
      variables: recoveryVariables,
    }),
  ).toEqual({
    inconnectLeadPoolOperation: previewOperation,
  });

  fetchMock.mockClear();
  fetchMock.mockReject(new Error('Recovery response lost'));
  await settleRequest(() => pool.current.recover(operationId));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(
    expect.stringContaining('"operationName":"InconnectLeadPoolOperation"'),
  );
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    fetchMock.mock.calls[0][1]?.body,
  );
  expect(pool.current).toMatchObject({
    operation: runningOperation,
    knownOperationId: operationId,
    unresolved: false,
    error: 'Recovery response lost',
  });
});

it('keeps the write pending when recovery returns HTTP 200 with empty data over an older cached version', async () => {
  const client = createClient();
  const pool = renderPool(client);
  client.writeQuery({
    query: LEAD_POOL_OPERATION,
    variables: recoveryVariables,
    data: { inconnectLeadPoolOperation: previewOperation },
  });
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: previewOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  fetchMock.mockResponseOnce(
    responseBody({ executeInconnectLeadPool: runningOperation }),
  );
  await settleRequest(() => pool.current.advance());
  expect(pool.current.operation).toEqual(runningOperation);
  fetchMock.mockRejectOnce(new Error('Next batch response lost'));
  await settleRequest(() => pool.current.advance());
  expect(pool.current.unresolved).toBe(true);

  fetchMock.mockResponseOnce(responseBody({}), { status: 200 });
  await settleRequest(() => pool.current.recover(operationId));

  expect(pool.current.unresolved).toBe(true);
  expect(pool.current.knownOperationId).toBe(operationId);
  expect(pool.current.operation).toBeNull();
  expect(pool.current.error).toEqual(expect.any(String));
  await settleRequest(() => pool.current.advance());
  expect(fetchMock).toHaveBeenCalledTimes(4);

  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: previewOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.unresolved).toBe(true);
  expect(pool.current.operation).toBeNull();

  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: runningOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(runningOperation);
  expect(pool.current.unresolved).toBe(false);
  expect(
    client.readQuery({
      query: LEAD_POOL_OPERATION,
      variables: recoveryVariables,
    }),
  ).toEqual({
    inconnectLeadPoolOperation: previewOperation,
  });
});

it.each(['advance', 'cancel'] as const)(
  'keeps %s pending when the mutation returns HTTP 200 with empty data',
  async (action) => {
    const pool = renderPool();
    act(() => pool.current.select(['original-lead']));
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: previewOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(previewOperation);

    fetchMock.mockResponseOnce(responseBody({}), { status: 200 });
    await settleRequest(() => pool.current[action]());

    expect(pool.current.unresolved).toBe(true);
    expect(pool.current.knownOperationId).toBe(operationId);
    expect(pool.current.operation).toBeNull();
    expect(pool.current.error).toEqual(expect.any(String));
    act(() => pool.current.reset());
    act(() => pool.current.select(['new-lead']));
    await settleRequest(() => pool.current.load({}));
    await settleRequest(() => pool.current[action]());
    expect(pool.current.selection).toEqual(['original-lead']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

const invalidOperationResponses = (
  field: string,
  complete: LeadPoolOperation,
) => [
  { name: 'null payload', body: responseBody({ [field]: null }) },
  { name: 'wrong field', body: responseBody({ unrelated: complete }) },
  {
    name: 'partial recipient',
    body: responseBody({
      [field]: { ...complete, recipients: [{ id: recipientId, quantity: 2 }] },
    }),
  },
  { name: 'older version', body: responseBody({ [field]: previewOperation }) },
  {
    name: 'unrelated operation',
    body: responseBody({
      [field]: { ...complete, id: '99999999-1111-4111-8111-000000000099' },
    }),
  },
  {
    name: 'unrelated origin',
    body: responseBody({
      [field]: {
        ...complete,
        objectId: '99999999-1111-4111-8111-000000000098',
      },
    }),
  },
  {
    name: 'unrelated intention',
    body: responseBody({
      [field]: {
        ...complete,
        intentionId: '99999999-1111-4111-8111-000000000097',
      },
    }),
  },
  {
    name: 'contradictory progress',
    body: responseBody({ [field]: { ...complete, processed: 0 } }),
  },
  {
    name: 'GraphQL errors with data',
    body: JSON.stringify({
      data: { [field]: complete },
      errors: [
        { message: 'Partial result denied', extensions: { code: 'FORBIDDEN' } },
      ],
    }),
  },
];

it.each(
  invalidOperationResponses('inconnectLeadPoolOperation', completedOperation),
)(
  'preserves confirmed progress when recovery returns $name',
  async ({ body }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: runningOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    fetchMock.mockResponseOnce(body);
    await settleRequest(() => pool.current.recover(operationId));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pool.current).toMatchObject({
      operation: runningOperation,
      knownOperationId: operationId,
      unresolved: false,
      error: expect.any(String),
    });
  },
);

describe.each([
  {
    action: 'advance',
    field: 'executeInconnectLeadPool',
    complete: completedOperation,
  },
  {
    action: 'cancel',
    field: 'cancelInconnectLeadPool',
    complete: cancelledOperation,
  },
] as const)('$field response validation', ({ action, field, complete }) => {
  it.each([
    ...invalidOperationResponses(field, complete),
    {
      name: 'unchanged active version',
      body: responseBody({ [field]: runningOperation }),
    },
  ])('keeps the write pending on $name', async ({ body }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: runningOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    fetchMock.mockResponseOnce(body);
    await settleRequest(() => pool.current[action]());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pool.current).toMatchObject({
      operation: null,
      knownOperationId: operationId,
      unresolved: true,
      error: expect.any(String),
    });

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: complete }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(complete);
    expect(pool.current.unresolved).toBe(false);
  });

  it('accepts the complete, correlated mutation result', async () => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: runningOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    fetchMock.mockResponseOnce(responseBody({ [field]: complete }));
    await settleRequest(() => pool.current[action]());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pool.current.operation).toEqual(complete);
    expect(pool.current.unresolved).toBe(false);
  });
});

it('reports newer running progress returned by cancel for a consumed version', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: previewOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  fetchMock.mockResponseOnce(
    responseBody({ cancelInconnectLeadPool: runningOperation }),
  );
  await settleRequest(() => pool.current.cancel());

  expect(pool.current.operation).toEqual(runningOperation);
  expect(pool.current.unresolved).toBe(false);
});

it('R2 rejects a same-version recovery that replaces a confirmed change with a rejection', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: runningOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(runningOperation);

  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...runningOperation,
        counts: { ...runningOperation.counts, CHANGED: 0, REJECTED: 1 },
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  expect(pool.current.operation).toEqual(runningOperation);
  expect(pool.current.error).toEqual(expect.any(String));
});

it.each([
  {
    action: 'advance',
    field: 'executeInconnectLeadPool',
    result: completedOperation,
  },
  {
    action: 'cancel',
    field: 'cancelInconnectLeadPool',
    result: cancelledOperation,
  },
] as const)(
  'R2 keeps $field pending when a newer version removes a confirmed result',
  async ({ action, field, result }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: runningOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(runningOperation);

    fetchMock.mockResponseOnce(
      responseBody({
        [field]: {
          ...result,
          counts: { ...result.counts, CHANGED: 0, REJECTED: result.processed },
        },
      }),
    );
    await settleRequest(() => pool.current[action]());

    expect(pool.current).toMatchObject({
      unresolved: true,
      operation: null,
      knownOperationId: operationId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: result }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(result);
    expect(pool.current.unresolved).toBe(false);
  },
);

it('R2 rejects a PREVIEW with a visible change absent from the global counts', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...previewOperation,
        items: [
          {
            recordId: '99999999-1111-4111-8111-000000000031',
            status: 'CHANGED',
          },
        ],
        hiddenItems: 1,
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  expect(pool.current).toMatchObject({
    operation: null,
    knownOperationId: null,
    error: expect.any(String),
  });
});

it('R2 keeps the original preview intention when an explicit retry returns another intention', async () => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() =>
    pool.current.select([
      '99999999-1111-4111-8111-000000000031',
      '99999999-1111-4111-8111-000000000032',
    ]),
  );
  const preview = () =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1);
  fetchMock.mockRejectOnce(new Error('Preview response lost'));
  await settleRequest(preview);
  expect(pool.current.hasIntention).toBe(true);

  fetchMock.mockResponseOnce(
    responseBody({
      previewInconnectLeadPool: {
        ...previewOperation,
        intentionId: '99999999-1111-4111-8111-000000000097',
      },
    }),
  );
  await settleRequest(preview);

  expect(pool.current).toMatchObject({
    hasIntention: true,
    unresolved: true,
    knownOperationId: null,
    operation: null,
  });
  act(() => pool.current.reset());
  act(() => pool.current.select([]));
  fetchMock.mockResponseOnce(
    responseBody({ previewInconnectLeadPool: previewOperation }),
  );
  await settleRequest(preview);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    fetchMock.mock.calls[0][1]?.body,
  );
  expect(fetchMock.mock.calls[2][1]?.body).toBe(
    fetchMock.mock.calls[0][1]?.body,
  );
  expect(pool.current.operation).toEqual(previewOperation);
  expect(pool.current.unresolved).toBe(false);
});

it('rereads confirmed history with a different Record Access projection', async () => {
  const pool = renderPool();
  const visibleChange: LeadPoolOperation = {
    ...runningOperation,
    items: [{ recordId: recordIds[0], status: 'CHANGED' }],
    hiddenItems: 1,
  };
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: visibleChange }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(visibleChange);

  const hiddenChange: LeadPoolOperation = {
    ...runningOperation,
    items: [{ recordId: recordIds[1], status: 'PENDING' }],
    hiddenItems: 1,
    canExecute: false,
  };
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: hiddenChange }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(hiddenChange);
  expect(pool.current.error).toBeNull();
});

it('rejects a rewritten visible result even when global history still balances', async () => {
  const pool = renderPool();
  const visibleChange: LeadPoolOperation = {
    ...runningOperation,
    items: [{ recordId: recordIds[0], status: 'CHANGED' }],
    hiddenItems: 1,
  };
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: visibleChange }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...completedOperation,
        counts: { ...completedOperation.counts, CHANGED: 1, REJECTED: 1 },
        items: [{ recordId: recordIds[0], status: 'REJECTED' }],
        hiddenItems: 1,
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(visibleChange);
  expect(pool.current.error).toEqual(expect.any(String));
});

it('accepts a later recorded rollback with unchanged item counts', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: runningOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  const rolledBack = {
    ...runningOperation,
    version: 2,
    batchFailures: 1,
    lastBatchError: 'Lote revertido',
  };
  fetchMock.mockResponseOnce(
    responseBody({ executeInconnectLeadPool: rolledBack }),
  );
  await settleRequest(() => pool.current.advance());
  expect(pool.current.operation).toEqual(rolledBack);
  expect(pool.current.unresolved).toBe(false);
});

it('keeps cancel pending when its sole new version claims to have processed a lead', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: runningOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  fetchMock.mockResponseOnce(
    responseBody({
      cancelInconnectLeadPool: { ...completedOperation, status: 'CANCELLED' },
    }),
  );
  await settleRequest(() => pool.current.cancel());

  expect(pool.current).toMatchObject({
    unresolved: true,
    operation: null,
    knownOperationId: operationId,
  });
});

it.each([
  { name: 'missing payload', data: {} },
  {
    name: 'unrelated origin',
    data: {
      previewInconnectLeadPool: {
        ...previewOperation,
        objectId: '99999999-1111-4111-8111-000000000098',
      },
    },
  },
  {
    name: 'unrelated mode',
    data: { previewInconnectLeadPool: { ...previewOperation, mode: 'EVEN' } },
  },
  {
    name: 'unrelated recipient',
    data: {
      previewInconnectLeadPool: {
        ...previewOperation,
        recipients: [
          {
            ...previewOperation.recipients[0],
            id: '99999999-1111-4111-8111-000000000099',
          },
        ],
      },
    },
  },
  {
    name: 'unrelated visible record',
    data: {
      previewInconnectLeadPool: {
        ...previewOperation,
        items: [
          {
            recordId: '99999999-1111-4111-8111-000000000099',
            status: 'PENDING',
          },
        ],
        hiddenItems: 1,
      },
    },
  },
])('keeps the preview intention on $name', async ({ data }) => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  fetchMock.mockResponseOnce(responseBody(data));
  await settleRequest(() =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(pool.current).toMatchObject({
    operation: null,
    knownOperationId: null,
    unresolved: true,
    hasIntention: true,
    error: expect.any(String),
  });
});

it('accepts the same normalized intention and recipient set for an EVEN preview', async () => {
  const canonicalIntention = 'abcdefab-1111-4111-8111-000000000090';
  const secondRecipientId = 'abcdefab-1111-4111-8111-000000000021';
  jest
    .spyOn(crypto, 'randomUUID')
    .mockReturnValue('ABCDEFAB-1111-4111-8111-000000000090');
  const pool = renderPool();
  act(() => pool.current.select([...recordIds].reverse()));
  const evenOperation: LeadPoolOperation = {
    ...previewOperation,
    intentionId: canonicalIntention,
    mode: 'EVEN',
    recipients: [recipientId, secondRecipientId].map((id) => ({
      id,
      label: 'Recipient',
      assignable: true,
      quantity: 1,
    })),
  };
  fetchMock.mockResponseOnce(
    responseBody({ previewInconnectLeadPool: evenOperation }),
  );
  await settleRequest(() =>
    pool.current.preview(
      'EVEN',
      [secondRecipientId.toUpperCase(), recipientId],
      undefined,
      1,
    ),
  );
  expect(pool.current.operation).toEqual(evenOperation);
  expect(pool.current.unresolved).toBe(false);
});

it('keeps the preview pending when a payload contradicts a correlated rejection', async () => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  fetchMock.mockResponseOnce(
    JSON.stringify({
      data: { previewInconnectLeadPool: previewOperation },
      errors: [
        {
          message: 'Preview rejected',
          extensions: {
            code: 'BAD_USER_INPUT',
            leadPoolPreview: {
              outcome: 'REJECTED',
              reason: 'VALIDATION',
              intentionId,
            },
          },
        },
      ],
    }),
  );
  await settleRequest(() =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(pool.current).toMatchObject({
    hasIntention: true,
    unresolved: true,
    knownOperationId: null,
    operation: null,
  });
});

it('accepts an existing terminal operation on an explicit preview replay', async () => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  const preview = () =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1);
  fetchMock.mockRejectOnce(new Error('Preview response lost'));
  await settleRequest(preview);

  fetchMock.mockResponseOnce(
    responseBody({ previewInconnectLeadPool: completedOperation }),
  );
  await settleRequest(preview);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    fetchMock.mock.calls[0][1]?.body,
  );
  expect(pool.current.operation).toEqual(completedOperation);
  expect(pool.current.unresolved).toBe(false);
});

it('recovers a manual preview with unassigned records and zero-quantity recipients', async () => {
  const secondRecipientId = '99999999-1111-4111-8111-000000000021';
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  fetchMock.mockRejectOnce(new Error('Preview response lost'));
  await settleRequest(() =>
    pool.current.preview(
      'MANUAL_QUOTAS',
      [recipientId, secondRecipientId],
      [
        { recipientId, quantity: 1 },
        { recipientId: secondRecipientId, quantity: 0 },
      ],
      1,
    ),
  );

  const manualOperation: LeadPoolOperation = {
    ...previewOperation,
    mode: 'MANUAL_QUOTAS',
    plannedChanges: 1,
    plannedRemaining: 1,
    counts: { ...previewOperation.counts, PENDING: 1, REMAINING: 1 },
    recipients: [
      { ...previewOperation.recipients[0], quantity: 1 },
      { id: secondRecipientId, label: null, assignable: false, quantity: 0 },
    ],
  };
  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...manualOperation,
        recipients: manualOperation.recipients.map(
          ({ quantity, ...recipient }) => ({
            ...recipient,
            quantity: 1 - quantity,
          }),
        ),
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.unresolved).toBe(true);

  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: manualOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.operation).toEqual(manualOperation);
  expect(pool.current.unresolved).toBe(false);
});

it('R3 rejects a substituted recipient when recovering the same preview by UUID', async () => {
  jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
  const pool = renderPool();
  act(() => pool.current.select(recordIds));
  fetchMock.mockResponseOnce(
    responseBody({ previewInconnectLeadPool: previewOperation }),
  );
  await settleRequest(() =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1),
  );
  expect(pool.current.operation).toEqual(previewOperation);

  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...previewOperation,
        recipients: [
          {
            ...previewOperation.recipients[0],
            id: 'abcdefab-1111-4111-8111-000000000021',
            label: 'Other recipient',
          },
        ],
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  expect(pool.current).toMatchObject({
    operation: previewOperation,
    knownOperationId: operationId,
    unresolved: false,
    error: expect.any(String),
  });
  await settleRequest(() => pool.current.advance());
  await settleRequest(() => pool.current.cancel());
  expect(fetchMock).toHaveBeenCalledTimes(2);

  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: previewOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  fetchMock.mockResponseOnce(
    responseBody({ executeInconnectLeadPool: runningOperation }),
  );
  await settleRequest(() => pool.current.advance());

  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[3][1]?.body).toEqual(
    expect.stringContaining('"expectedVersion":0'),
  );
  expect(pool.current.operation).toEqual(runningOperation);
});

const otherPlanRecipientId = 'abcdefab-1111-4111-8111-000000000021';
const otherTerminalOperation: LeadPoolOperation = {
  ...completedOperation,
  id: 'abcdefab-1111-4111-8111-000000000051',
  intentionId: 'abcdefab-1111-4111-8111-000000000091',
};
const previewBeforeCancellation: LeadPoolOperation = {
  ...previewOperation,
  id: 'abcdefab-1111-4111-8111-000000000050',
};
const cancelledPreview: LeadPoolOperation = {
  ...previewBeforeCancellation,
  status: 'CANCELLED',
  version: 1,
  counts: { ...previewOperation.counts, PENDING: 0, REMAINING: 2 },
};

it.each([
  {
    contradiction: 'a substituted recipient at the same terminal version',
    result: {
      ...cancelledPreview,
      recipients: [
        { ...previewOperation.recipients[0], id: otherPlanRecipientId },
      ],
    },
  },
  {
    contradiction: 'a regression from CANCELLED to RUNNING',
    result: { ...runningOperation, id: cancelledPreview.id, version: 2 },
  },
])(
  'R4 rejects $contradiction after looking up another UUID',
  async ({ result }) => {
    jest.spyOn(crypto, 'randomUUID').mockReturnValue(intentionId);
    const pool = renderPool();
    act(() => pool.current.select(recordIds));
    fetchMock.mockResponseOnce(
      responseBody({ previewInconnectLeadPool: previewBeforeCancellation }),
    );
    await settleRequest(() =>
      pool.current.preview('SINGLE', [recipientId], undefined, 1),
    );
    expect(pool.current.operation).toEqual(previewBeforeCancellation);

    fetchMock.mockResponseOnce(
      responseBody({ cancelInconnectLeadPool: cancelledPreview }),
    );
    await settleRequest(() => pool.current.cancel());
    expect(pool.current.operation).toEqual(cancelledPreview);
    expect(fetchMock.mock.calls[1][1]?.body).toEqual(
      expect.stringContaining('"expectedVersion":0'),
    );

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: otherTerminalOperation }),
    );
    await settleRequest(() =>
      pool.current.recover(otherTerminalOperation.id.toUpperCase()),
    );
    expect(pool.current.operation).toEqual(otherTerminalOperation);

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: result }),
    );
    await settleRequest(() =>
      pool.current.recover(cancelledPreview.id.toUpperCase()),
    );
    const afterContradiction = pool.current;
    await settleRequest(() => pool.current.advance());
    await settleRequest(() => pool.current.cancel());
    expect({
      operation: afterContradiction.operation,
      knownOperationId: afterContradiction.knownOperationId,
      unresolved: afterContradiction.unresolved,
      error: afterContradiction.error,
      requestCount: fetchMock.mock.calls.length,
    }).toMatchObject({
      operation: otherTerminalOperation,
      knownOperationId: otherTerminalOperation.id,
      unresolved: false,
      error: expect.any(String),
      requestCount: 4,
    });
    expect(pool.current.error).toBe(afterContradiction.error);

    const currentView = {
      ...cancelledPreview,
      canExecute: false,
      recipients: [
        { ...cancelledPreview.recipients[0], label: null, assignable: false },
      ],
      items: [{ recordId: recordIds[0], status: 'REMAINING' as const }],
      hiddenItems: 1,
    };
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: currentView }),
    );
    await settleRequest(() => pool.current.recover(cancelledPreview.id));
    expect(pool.current).toMatchObject({
      operation: currentView,
      error: null,
      writesBlocked: false,
    });
    act(() => pool.current.reset());
    expect(pool.current.operation).toBeNull();
    act(() => pool.current.select(recordIds));
    expect(pool.current.selection).toEqual(recordIds);
  },
);

it('keeps known checkpoints available at capacity without admitting another UUID or preview', async () => {
  const pool = renderPool();
  for (let index = 0; index < 100; index++) {
    const terminal = {
      ...completedOperation,
      id: `abcdefab-1111-4111-8111-${String(index).padStart(12, '0')}`,
      intentionId: `abcdefab-1111-4111-8112-${String(index).padStart(12, '0')}`,
    };
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: terminal }),
    );
    await settleRequest(() => pool.current.recover(terminal.id));
    expect(pool.current.operation).toEqual(terminal);
  }

  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current.error).toContain('límite de 100');
  expect(fetchMock).toHaveBeenCalledTimes(100);

  act(() => pool.current.reset());
  act(() => pool.current.select(recordIds));
  await settleRequest(() =>
    pool.current.preview('SINGLE', [recipientId], undefined, 1),
  );
  expect(pool.current.error).toContain('límite de 100');
  expect(pool.current.hasIntention).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(100);

  const first = {
    ...completedOperation,
    id: 'abcdefab-1111-4111-8111-000000000000',
    intentionId: 'abcdefab-1111-4111-8112-000000000000',
  };
  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...runningOperation,
        id: first.id,
        intentionId: first.intentionId,
        version: 3,
      },
    }),
  );
  await settleRequest(() => pool.current.recover(first.id.toUpperCase()));
  expect(pool.current.operation).toBeNull();
  expect(pool.current.error).toContain('progreso confirmado');

  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: first }),
  );
  await settleRequest(() => pool.current.recover(first.id));
  expect(pool.current.operation).toEqual(first);
  expect(pool.current.error).toBeNull();
});

it('leaves the current active operation usable when a different UUID returns a contradictory plan', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: otherTerminalOperation }),
  );
  await settleRequest(() => pool.current.recover(otherTerminalOperation.id));
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: runningOperation }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...otherTerminalOperation,
        recipients: [
          { ...otherTerminalOperation.recipients[0], id: otherPlanRecipientId },
        ],
      },
    }),
  );
  await settleRequest(() => pool.current.recover(otherTerminalOperation.id));
  expect(pool.current).toMatchObject({
    operation: runningOperation,
    writesBlocked: false,
    error: expect.any(String),
  });

  fetchMock.mockResponseOnce(
    responseBody({ executeInconnectLeadPool: completedOperation }),
  );
  await settleRequest(() => pool.current.advance());
  expect(fetchMock.mock.calls[3][1]?.body).toEqual(
    expect.stringContaining('"expectedVersion":1'),
  );
  expect(pool.current.operation).toEqual(completedOperation);
});

const manualRecipientPlan: LeadPoolOperation = {
  ...previewOperation,
  mode: 'MANUAL_QUOTAS',
  recipients: [recipientId, otherPlanRecipientId].map((id) => ({
    id,
    label: 'Recipient',
    assignable: true,
    quantity: 1,
  })),
};

const [firstPlanRecipient, secondPlanRecipient] =
  manualRecipientPlan.recipients;
const duplicatePlanRecipients = [
  secondPlanRecipient,
  { ...secondPlanRecipient, id: otherPlanRecipientId.toUpperCase() },
];

it.each([
  {
    change: 'reassigned quantities with the same total',
    recipients: [
      { ...firstPlanRecipient, quantity: 0 },
      { ...secondPlanRecipient, quantity: 2 },
    ],
  },
  {
    change: 'a missing recipient',
    recipients: [{ ...firstPlanRecipient, quantity: 2 }],
  },
  {
    change: 'an extra recipient with zero assigned leads',
    recipients: [
      ...manualRecipientPlan.recipients,
      {
        ...secondPlanRecipient,
        id: 'abcdefab-1111-4111-8111-000000000022',
        quantity: 0,
      },
    ],
  },
  { change: 'duplicate canonical IDs', recipients: duplicatePlanRecipients },
  {
    change: 'a missing quantity',
    recipients: [
      firstPlanRecipient,
      { ...secondPlanRecipient, quantity: undefined },
    ],
  },
])(
  'keeps the confirmed plan on recovery with $change',
  async ({ recipients }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: manualRecipientPlan }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current.operation).toEqual(manualRecipientPlan);

    fetchMock.mockResponseOnce(
      responseBody({
        inconnectLeadPoolOperation: { ...manualRecipientPlan, recipients },
      }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    expect(pool.current).toMatchObject({
      operation: manualRecipientPlan,
      knownOperationId: operationId,
      writesBlocked: true,
      unresolved: false,
      error: expect.any(String),
    });
  },
);

it('rejects duplicate canonical recipient IDs on initial recovery', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({
      inconnectLeadPoolOperation: {
        ...manualRecipientPlan,
        recipients: duplicatePlanRecipients,
      },
    }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  expect(pool.current).toMatchObject({
    operation: null,
    knownOperationId: null,
    error: expect.any(String),
  });
});

it('accepts the same recipient pairs in a different order with updated labels, assignability and visibility', async () => {
  const pool = renderPool();
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: manualRecipientPlan }),
  );
  await settleRequest(() => pool.current.recover(operationId));

  const currentView: LeadPoolOperation = {
    ...manualRecipientPlan,
    recipients: [
      {
        ...secondPlanRecipient,
        id: otherPlanRecipientId.toUpperCase(),
        label: null,
        assignable: false,
      },
      { ...firstPlanRecipient, label: 'Current name' },
    ],
    canExecute: false,
    items: [{ recordId: recordIds[0], status: 'PENDING' }],
    hiddenItems: 1,
  };
  fetchMock.mockResponseOnce(
    responseBody({ inconnectLeadPoolOperation: currentView }),
  );
  await settleRequest(() => pool.current.recover(operationId));
  expect(pool.current).toMatchObject({
    operation: currentView,
    error: null,
    writesBlocked: false,
  });

  const cancelledView: LeadPoolOperation = {
    ...manualRecipientPlan,
    status: 'CANCELLED',
    version: 1,
    counts: { ...manualRecipientPlan.counts, PENDING: 0, REMAINING: 2 },
  };
  fetchMock.mockResponseOnce(
    responseBody({ cancelInconnectLeadPool: cancelledView }),
  );
  await settleRequest(() => pool.current.cancel());
  expect(pool.current).toMatchObject({
    operation: cancelledView,
    error: null,
    unresolved: false,
  });
});

it.each([
  {
    action: 'advance',
    field: 'executeInconnectLeadPool',
    result: completedOperation,
  },
  {
    action: 'cancel',
    field: 'cancelInconnectLeadPool',
    result: cancelledOperation,
  },
] as const)(
  'keeps $field uncertain when its response and a later recovery replace a recipient',
  async ({ action, field, result }) => {
    const pool = renderPool();
    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: runningOperation }),
    );
    await settleRequest(() => pool.current.recover(operationId));

    const contradictoryResult = {
      ...result,
      recipients: [{ ...result.recipients[0], id: otherPlanRecipientId }],
    };
    fetchMock.mockResponseOnce(responseBody({ [field]: contradictoryResult }));
    await settleRequest(() => pool.current[action]());
    expect(pool.current).toMatchObject({
      operation: runningOperation,
      unresolved: true,
      knownOperationId: operationId,
      writesBlocked: true,
    });

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: contradictoryResult }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current).toMatchObject({
      operation: runningOperation,
      unresolved: true,
      knownOperationId: operationId,
    });
    await settleRequest(() => pool.current.advance());
    await settleRequest(() => pool.current.cancel());
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResponseOnce(
      responseBody({ inconnectLeadPoolOperation: result }),
    );
    await settleRequest(() => pool.current.recover(operationId));
    expect(pool.current).toMatchObject({
      operation: result,
      unresolved: false,
      writesBlocked: false,
      error: null,
    });
  },
);

it('retries a mutation outside Lead Management after a transport failure', async () => {
  const client = createClient();
  const data = { trackAnalytics: { success: true } };
  fetchMock
    .mockRejectOnce(new Error('Response lost'))
    .mockResponseOnce(responseBody(data));

  const request = client.mutate({
    mutation: TRACK_ANALYTICS,
    variables: { type: AnalyticsType.TRACK },
  });
  await jest.runAllTimersAsync();

  await expect(request).resolves.toMatchObject({ data });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    fetchMock.mock.calls[0][1]?.body,
  );
});
