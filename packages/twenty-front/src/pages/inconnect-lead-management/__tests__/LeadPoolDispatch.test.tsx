import { gql, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock';
import { createStore, Provider } from 'jotai';
import {
  type LeadPoolOperation,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

import { ApolloFactory } from '@/apollo/services/apollo.factory';
import { currentUserState } from '@/auth/states/currentUserState';
import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { isCookieAuthActiveState } from '@/auth/states/isCookieAuthActiveState';
import { isPendingServerSignOutState } from '@/auth/states/isPendingServerSignOutState';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { leadPoolTestTokenPair } from '@/inconnect-lead-management/__tests__/fixtures/leadPoolTestTokenPair';
import { type LeadPoolWorkspace } from '@/inconnect-lead-management/components/LeadPoolWorkspace';
import { LEAD_POOL_OPERATION } from '@/inconnect-lead-management/graphql/leadPoolOperations';
import { type useLeadPool } from '@/inconnect-lead-management/hooks/useLeadPool';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { type AuthTokenPair } from '~/generated-metadata/graphql';
import { InconnectLeadManagementPage } from '~/pages/inconnect-lead-management/InconnectLeadManagementPage';
import {
  mockCurrentWorkspace,
  mockedUserData,
  mockedWorkspaceMemberData,
} from '~/testing/mock-data/users';

jest.mock('@/ui/layout/page/components/PageHeader', () => ({
  PageHeader: () => null,
}));

const mockObservePool = jest.fn<void, [ReturnType<typeof useLeadPool>]>();
jest.mock('@/inconnect-lead-management/components/LeadPoolWorkspace', () => {
  const { LeadPoolWorkspace: ActualWorkspace } = jest.requireActual<{
    LeadPoolWorkspace: typeof LeadPoolWorkspace;
  }>('@/inconnect-lead-management/components/LeadPoolWorkspace');
  return {
    LeadPoolWorkspace: ({
      pool,
      storageReady,
    }: Parameters<typeof LeadPoolWorkspace>[0]) => {
      mockObservePool(pool);
      return <ActualWorkspace pool={pool} storageReady={storageReady} />;
    },
  };
});

enableFetchMocks();

const uuid = (value: number) =>
  `12345678-1234-4123-8123-${String(value).padStart(12, '0')}`;
const [
  workspaceId,
  actorA,
  actorB,
  memberA,
  memberB,
  origin,
  operationId,
  recipientId,
  recordId,
] = Array.from({ length: 9 }, (_, index) => uuid(index + 1));

const recordIdB = uuid(22);
const tokenA = leadPoolTestTokenPair(workspaceId, actorA, memberA, 'actor-a');
const tokenB = leadPoolTestTokenPair(workspaceId, actorB, memberB, 'actor-b');
const renewedA = leadPoolTestTokenPair(
  workspaceId,
  actorA,
  memberA,
  'renewed-actor-a',
);
const bearer = (pair: AuthTokenPair) =>
  `Bearer ${pair.accessOrWorkspaceAgnosticToken.token}`;

const prepared = (input: LeadPoolPreviewInput): LeadPoolOperation => ({
  id: operationId,
  intentionId: input.intentionId,
  objectId: origin,
  mode: 'SINGLE',
  status: 'PREVIEW',
  version: 0,
  found: 1,
  selected: 1,
  authorized: 1,
  plannedChanges: 1,
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
    PENDING: 1,
  },
  recipients: [
    { id: recipientId, label: 'Destino', assignable: true, quantity: 1 },
  ],
  canExecute: true,
  items: input.recordIds.map((id) => ({ recordId: id, status: 'PENDING' })),
  hiddenItems: 0,
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const button = (name: string) => screen.getByRole('button', { name });
type WireRequest = {
  operationName: string;
  variables: { input: LeadPoolPreviewInput };
};
type WireCall = WireRequest & {
  bearer: string | null;
  workspace?: string;
  actor?: string;
  member?: string;
};
const response = (data: object) => JSON.stringify({ data });
const unauthenticated = JSON.stringify({
  data: null,
  errors: [
    { message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } },
  ],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const renderPage = (initial = 'A') => {
  const store = createStore();
  const setToken = (pair: AuthTokenPair) =>
    store.set(tokenPairState.atom, pair);
  const changeUser = (id: string) =>
    store.set(currentUserState.atom, { ...mockedUserData, id });
  const changeMember = (id: string) =>
    store.set(currentWorkspaceMemberState.atom, {
      ...mockedWorkspaceMemberData,
      id,
    });
  const changeWorkspace = (id: string) =>
    store.set(currentWorkspaceState.atom, { ...mockCurrentWorkspace, id });
  const signIn = (actor: string, member: string, pair: AuthTokenPair) => {
    setToken(pair);
    changeUser(actor);
    changeMember(member);
    changeWorkspace(workspaceId);
  };
  const changeToA = () => signIn(actorA, memberA, tokenA);
  const changeToB = () => signIn(actorB, memberB, tokenB);
  if (initial === 'A') changeToA();
  else changeToB();

  const calls: WireCall[] = [];
  const overrides = new Map<
    string,
    (wire: WireRequest) => string | Promise<string>
  >();
  let persisted: LeadPoolOperation | null = null;
  fetchMock.mockResponse(async (request) => {
    const identity = {
      workspace: store.get(currentWorkspaceState.atom)?.id,
      actor: store.get(currentUserState.atom)?.id,
      member: store.get(currentWorkspaceMemberState.atom)?.id,
    };
    const wire: WireRequest = JSON.parse(await request.text());
    calls.push({
      ...wire,
      ...identity,
      bearer: request.headers.get('authorization'),
    });
    const override = overrides.get(wire.operationName);
    if (override) {
      overrides.delete(wire.operationName);
      return override(wire);
    }
    switch (wire.operationName) {
      case 'InconnectLeadPoolCatalog':
        return JSON.stringify({
          data: {
            inconnectLeadPoolCatalog: {
              objects: [{ id: origin, label: 'Origen' }],
              storageReady: true,
              blockedReason: null,
              allMatchingReady: false,
              messagingClassification: 'NOT_READY',
            },
          },
        });
      case 'InconnectLeadPoolRecords':
        return JSON.stringify({
          data: {
            inconnectLeadPoolRecords: {
              records: [
                {
                  id: identity.actor === actorB ? recordIdB : recordId,
                  label: identity.actor === actorB ? 'Lead B' : 'Lead A',
                  ownerId: null,
                },
              ],
              recipients: [{ id: recipientId, label: 'Destino' }],
              total: 1,
              offset: 0,
              fields: [],
            },
          },
        });
      case 'PreviewInconnectLeadPool':
        persisted = prepared(wire.variables.input);
        return response({ previewInconnectLeadPool: persisted });
      case 'InconnectLeadPoolOperation':
        return response({ inconnectLeadPoolOperation: persisted });
      case 'ExecuteInconnectLeadPool':
        return response({
          executeInconnectLeadPool: persisted && {
            ...persisted,
            status: 'COMPLETED',
            version: 1,
            processed: 1,
            canExecute: false,
            counts: { ...persisted.counts, PENDING: 0, CHANGED: 1 },
            items: persisted.items.map((item) => ({
              ...item,
              status: 'CHANGED',
            })),
          },
        });
      case 'CancelInconnectLeadPool':
        return response({
          cancelInconnectLeadPool: persisted && {
            ...persisted,
            status: 'CANCELLED',
            version: 1,
            canExecute: false,
            counts: { ...persisted.counts, PENDING: 0, REMAINING: 1 },
            items: persisted.items.map((item) => ({
              ...item,
              status: 'REMAINING',
            })),
          },
        });
      default:
        throw new Error('Unexpected GraphQL operation');
    }
  });
  const onUnauthenticatedError = jest.fn();
  const client = new ApolloFactory({
    uri: 'http://localhost/metadata',
    cache: new InMemoryCache(),
    currentWorkspace: null,
    currentWorkspaceMember: null,
    onTokenPairChange: setToken,
    onUnauthenticatedError,
  }).getClient();
  render(
    <Provider store={store}>
      <ApolloProvider client={client}>
        <I18nProvider i18n={i18n}>
          <InconnectLeadManagementPage />
        </I18nProvider>
      </ApolloProvider>
    </Provider>,
  );
  return {
    client,
    store,
    onUnauthenticatedError,
    setCookie: (active: boolean) => {
      store.set(isCookieAuthActiveState.atom, active);
      jotaiStore.set(isCookieAuthActiveState.atom, active);
    },
    changeToA,
    changeToB,
    changeUser,
    changeMember,
    changeWorkspace,
    setToken,
    callsFor: (name: string) =>
      calls.filter(({ operationName }) => operationName === name),
    previews: () =>
      calls.filter(
        ({ operationName }) => operationName === 'PreviewInconnectLeadPool',
      ),
    replyOnce: (
      name: string,
      answer: (wire: WireRequest) => string | Promise<string>,
    ) => overrides.set(name, answer),
  };
};

const recover = () => {
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  fireEvent.click(button('Consultar operación'));
};

const openOrigin = async () => {
  await screen.findByRole('option', { name: 'Origen' });
  fireEvent.change(screen.getByLabelText('Objeto de origen'), {
    target: { value: origin },
  });
};

const selectForPreview = async () => {
  await openOrigin();
  fireEvent.click(button('Consultar Leads'));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Seleccionar Lead [AB]/ }),
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Asignar a Destino' }));
};

beforeEach(() => {
  fetchMock.resetMocks();
  mockObservePool.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  jotaiStore.set(isCookieAuthActiveState.atom, false);
  localStorage.removeItem(isCookieAuthActiveState.key);
});
afterEach(() => {
  for (const { key } of [
    currentUserState,
    currentWorkspaceMemberState,
    currentWorkspaceState,
    tokenPairState,
    isPendingServerSignOutState,
  ])
    localStorage.removeItem(key);
});

it('dispatches and accredits a preview with a stable actor A', async () => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(fetchMock.mock.lastCall?.[1]?.credentials).toBe('omit');
  expect(page.previews()).toEqual([
    expect.objectContaining({
      bearer: bearer(tokenA),
      actor: actorA,
      member: memberA,
      workspace: workspaceId,
      variables: { input: expect.objectContaining({ recordIds: [recordId] }) },
    }),
  ]);
});

it('blocks an admitted preview before HTTP when SetContextLink would select actor B', async () => {
  const page = renderPage();
  await selectForPreview();
  await act(async () => {
    fireEvent.click(button('Obtener vista previa'));
    expect(page.previews()).toHaveLength(0);
    page.changeToB();
  });
  await screen.findByRole('option', { name: 'Origen' });
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
  expect(
    page.previews().map(({ bearer, variables }) => ({
      bearer,
      recordIds: variables.input.recordIds,
    })),
  ).toEqual([]);
});

it.each(['workspace', 'member', 'user', 'A → B → A'])(
  'rejects a preview when only the %s context changes before dispatch',
  async (dimension) => {
    const page = renderPage();
    await selectForPreview();
    await act(async () => {
      fireEvent.click(button('Obtener vista previa'));
      switch (dimension) {
        case 'workspace':
          page.changeWorkspace(uuid(21));
          break;
        case 'member':
          page.changeMember(memberB);
          break;
        case 'user':
          page.changeUser(actorB);
          break;
        default:
          page.changeToB();
          page.changeToA();
      }
    });
    expect(page.previews()).toHaveLength(0);
    expect(screen.queryByText(operationId)).not.toBeInTheDocument();
  },
);

it('blocks after SetContextLink has selected A’s credential and before HTTP', async () => {
  const page = renderPage();
  await selectForPreview();
  const readStorage = Storage.prototype.getItem;
  const readCredential = jest.fn();
  let armed = true;
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    const stored = readStorage.call(this, key);
    if (key === tokenPairState.key && armed) {
      armed = false;
      readCredential(stored === JSON.stringify(tokenA));
      // The setter finishes composing the header before the next link runs.
      queueMicrotask(page.changeToB);
    }
    return stored;
  });

  await act(async () => fireEvent.click(button('Obtener vista previa')));
  expect(readCredential).toHaveBeenCalledWith(true);
  expect(page.store.get(currentUserState.atom)?.id).toBe(actorB);
  expect(page.previews()).toHaveLength(0);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it('rejects B’s token while the page still has A and releases only the unsent preview', async () => {
  const page = renderPage();
  await selectForPreview();
  act(() => page.setToken(tokenB));
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La solicitud no se envió',
  );
  expect(page.previews()).toHaveLength(0);
  expect(button('Obtener vista previa')).toBeEnabled();

  act(() => page.setToken(tokenA));
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
  ]);
});

it.each([
  ['Confirmar y procesar primer lote', 'ExecuteInconnectLeadPool'],
  ['Cancelar registros pendientes', 'CancelInconnectLeadPool'],
])('blocks %s before HTTP across an identity change', async (label, name) => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);

  await act(async () => {
    fireEvent.click(button(label));
    page.changeToB();
  });
  expect(page.callsFor(name)).toHaveLength(0);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it.each([
  ['Consultar Leads', 'InconnectLeadPoolRecords'],
  ['Consultar operación', 'InconnectLeadPoolOperation'],
])('blocks an old %s read before HTTP', async (label, name) => {
  const page = renderPage();
  await openOrigin();
  fireEvent.change(screen.getByLabelText('Identificador de operación'), {
    target: { value: operationId },
  });
  await act(async () => {
    fireEvent.click(button(label));
    page.changeToB();
  });
  expect(page.callsFor(name)).toHaveLength(0);
});

it('blocks an old catalog refresh and rejects operations missing their admission', async () => {
  const page = renderPage();
  await openOrigin();
  await act(async () => {
    fireEvent.click(button('Actualizar disponibilidad'));
    page.changeToB();
  });
  await screen.findByRole('option', { name: 'Origen' });
  expect(page.callsFor('InconnectLeadPoolCatalog')).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
    { actor: actorB, bearer: bearer(tokenB) },
  ]);
  await expect(
    page.client.query({
      query: LEAD_POOL_OPERATION,
      variables: { input: { operationId } },
      fetchPolicy: 'no-cache',
    }),
  ).rejects.toThrow('dispatch rejected');
  expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(0);
});

it('does not use an unbindable HttpOnly cookie or send the retained bearer in cookie mode', async () => {
  jotaiStore.set(isCookieAuthActiveState.atom, true);
  const page = renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'credenciales de la sesión',
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(page.callsFor('InconnectLeadPoolCatalog')).toHaveLength(0);
});

it('accredits a stable actor B preview with B’s bearer', async () => {
  const page = renderPage('B');
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()).toMatchObject([
    { actor: actorB, member: memberB, bearer: bearer(tokenB) },
  ]);
});

it('does not dispatch an old callback kept across a change of identity', async () => {
  const page = renderPage();
  await selectForPreview();
  const old = button('Obtener vista previa');
  await act(async () => {
    page.changeToB();
    fireEvent.click(old);
  });
  expect(page.previews()).toHaveLength(0);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it('accredits only B when B receives a preview while A’s dispatched request is pending', async () => {
  const page = renderPage();
  await selectForPreview();
  const pending = deferred<string>();
  page.replyOnce('PreviewInconnectLeadPool', () => pending.promise);
  fireEvent.click(button('Obtener vista previa'));
  await waitFor(() => expect(page.previews()).toHaveLength(1));
  const requestA = page.previews()[0];

  act(page.changeToB);
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
    { actor: actorB, bearer: bearer(tokenB) },
  ]);
  expect(requestA.variables.input.recordIds).toEqual([recordId]);
  expect(page.previews()[1].variables.input.recordIds).toEqual([recordIdB]);
  expect(page.previews()[1].variables.input.intentionId).not.toBe(
    requestA.variables.input.intentionId,
  );

  await act(async () =>
    pending.resolve(
      response({
        previewInconnectLeadPool: {
          ...prepared(requestA.variables.input),
          id: uuid(89),
        },
      }),
    ),
  );
  expect(screen.getByText(operationId)).toBeInTheDocument();
  expect(screen.queryByText(uuid(89))).not.toBeInTheDocument();
});

it('renews a read for the same identity and checks the renewed credential before replay', async () => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);

  page.replyOnce('InconnectLeadPoolOperation', () => unauthenticated);
  page.replyOnce('RenewToken', () =>
    response({ renewToken: { tokens: renewedA } }),
  );
  recover();

  await waitFor(() =>
    expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(2),
  );
  expect(page.callsFor('InconnectLeadPoolOperation')).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
    { actor: actorA, bearer: bearer(renewedA) },
  ]);
  expect(page.callsFor('RenewToken')).toMatchObject([
    { actor: actorA, bearer: null },
  ]);
  expect(
    fetchMock.mock.calls.every(([, init]) => init?.credentials === 'omit'),
  ).toBe(true);
  expect(
    await screen.findByRole('button', {
      name: 'Confirmar y procesar primer lote',
    }),
  ).toBeEnabled();
  fireEvent.click(button('Confirmar y procesar primer lote'));
  expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toMatchObject([
    {
      actor: actorA,
      bearer: bearer(renewedA),
      variables: { input: { operationId, expectedVersion: 0 } },
    },
  ]);
});

it('ignores a renewal response after changing identity and never replays using B', async () => {
  const page = renderPage();
  await openOrigin();
  const pending = deferred<string>();
  page.replyOnce('InconnectLeadPoolOperation', () => unauthenticated);
  page.replyOnce('RenewToken', () => pending.promise);
  recover();
  await waitFor(() => expect(page.callsFor('RenewToken')).toHaveLength(1));

  act(page.changeToB);
  await openOrigin();
  await act(async () =>
    pending.resolve(response({ renewToken: { tokens: renewedA } })),
  );
  expect(page.store.get(tokenPairState.atom)).toEqual(tokenB);
  expect(page.callsFor('InconnectLeadPoolOperation')).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
  ]);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it('does not replay a sent mutation after legitimate renewal', async () => {
  const page = renderPage();
  await selectForPreview();
  page.replyOnce('PreviewInconnectLeadPool', () => unauthenticated);
  page.replyOnce('RenewToken', () =>
    response({ renewToken: { tokens: renewedA } }),
  );
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByRole('alert');
  expect(page.previews()).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
  ]);
  expect(page.store.get(tokenPairState.atom)).toEqual(renewedA);

  fireEvent.click(button('Recuperar la misma intención de preview'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()).toHaveLength(2);
  expect(page.previews()[1]).toMatchObject({
    actor: actorA,
    bearer: bearer(renewedA),
    variables: page.previews()[0].variables,
  });
});

it('blocks a delayed RetryLink attempt after A’s bearer changes to B', async () => {
  const page = renderPage();
  await openOrigin();
  jest.useFakeTimers();
  const failed = deferred<string>();
  page.replyOnce('InconnectLeadPoolOperation', () =>
    failed.promise.then(() => {
      throw new Error('Synthetic network loss');
    }),
  );
  await act(async () => recover());
  expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(1);
  await act(async () => failed.resolve(''));
  await act(async () => {
    page.changeToB();
    await jest.runAllTimersAsync();
  });
  expect(page.callsFor('InconnectLeadPoolOperation')).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
  ]);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it('keeps the existing definitive rejection for the exact preview intention', async () => {
  const page = renderPage();
  await selectForPreview();
  page.replyOnce('PreviewInconnectLeadPool', ({ variables }) =>
    JSON.stringify({
      data: null,
      errors: [
        {
          message: 'Rejected',
          extensions: {
            code: 'BAD_USER_INPUT',
            leadPoolPreview: {
              outcome: 'REJECTED',
              reason: 'VALIDATION',
              intentionId: variables.input.intentionId,
            },
          },
        },
      ],
    }),
  );
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'rechazó el preview',
  );
  expect(button('Obtener vista previa')).toBeEnabled();
  expect(page.previews()).toHaveLength(1);
});

it('keeps the original uncertain intention when a later explicit replay is blocked before HTTP', async () => {
  const page = renderPage();
  await selectForPreview();
  page.replyOnce('PreviewInconnectLeadPool', () =>
    Promise.reject(new Error('Synthetic lost response')),
  );
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByRole('alert');
  const first = page.previews()[0];

  act(() => page.setToken(tokenB));
  fireEvent.click(button('Recuperar la misma intención de preview'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La solicitud no se envió',
  );
  expect(page.previews()).toHaveLength(1);

  act(() => page.setToken(tokenA));
  fireEvent.click(button('Recuperar la misma intención de preview'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()[1].variables).toEqual(first.variables);
});

it('preserves the accredited operation and expectedVersion when execute never reaches fetch', async () => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);

  act(() => page.setToken(tokenB));
  fireEvent.click(button('Confirmar y procesar primer lote'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La solicitud no se envió',
  );
  expect(screen.getByText(operationId)).toBeInTheDocument();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);

  act(() => page.setToken(tokenA));
  fireEvent.click(button('Confirmar y procesar primer lote'));
  expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toMatchObject([
    {
      actor: actorA,
      bearer: bearer(tokenA),
      variables: { input: { operationId, expectedVersion: 0 } },
    },
  ]);
});

it('blocks a preview admitted before sign-out starts', async () => {
  const page = renderPage();
  await selectForPreview();
  await act(async () => {
    fireEvent.click(button('Obtener vista previa'));
    page.store.set(isPendingServerSignOutState.atom, true);
  });
  expect(page.previews()).toHaveLength(0);
  expect(screen.queryByText(operationId)).not.toBeInTheDocument();
});

it('does not apply A’s definitive refresh rejection to B', async () => {
  const page = renderPage();
  await openOrigin();
  const pending = deferred<string>();
  page.replyOnce('InconnectLeadPoolOperation', () => unauthenticated);
  page.replyOnce('RenewToken', () => pending.promise);
  recover();
  await waitFor(() => expect(page.callsFor('RenewToken')).toHaveLength(1));

  act(page.changeToB);
  await openOrigin();
  await act(async () => pending.resolve(unauthenticated));
  expect(page.onUnauthenticatedError).not.toHaveBeenCalled();
  expect(page.store.get(tokenPairState.atom)).toEqual(tokenB);
  expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(1);
});

it('R4-R3 preserves a sent uncertain preview through Bearer → cookie → Bearer', async () => {
  const page = renderPage();
  await selectForPreview();
  page.replyOnce('PreviewInconnectLeadPool', () =>
    Promise.reject(new Error('Synthetic response lost')),
  );
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Synthetic response lost',
  );
  const original = page.previews()[0];
  expect(button('Recuperar la misma intención de preview')).toBeEnabled();
  expect(button('Consultar Leads')).toBeDisabled();

  const beforeCookie = fetchMock.mock.calls.length;
  act(() => page.setCookie(true));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'credenciales de la sesión',
  );
  expect(fetchMock.mock.calls).toHaveLength(beforeCookie);
  act(() => page.setCookie(false));
  await openOrigin();
  expect({
    canRecover:
      screen
        .queryByRole('button', {
          name: 'Recuperar la misma intención de preview',
        })
        ?.matches(':enabled') ?? false,
    hasNewPreview: !!screen.queryByRole('button', {
      name: 'Obtener vista previa',
    }),
    sent: page.previews().length,
  }).toEqual({ canRecover: true, hasNewPreview: false, sent: 1 });

  fireEvent.click(button('Recuperar la misma intención de preview'));
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(page.previews()).toHaveLength(2);
  expect(page.previews()[1].variables).toEqual(original.variables);
});

it('R4-R3 blocks the same preview field under a renamed GraphQL operation after A → B', async () => {
  const page = renderPage();
  await openOrigin();
  const mutation = gql`
    mutation RenamedPreview($input: JSONObject!) {
      previewInconnectLeadPool(input: $input)
    }
  `;
  const input: LeadPoolPreviewInput = {
    intentionId: uuid(91),
    objectId: origin,
    mode: 'SINGLE',
    recordIds: [recordId],
    recipientIds: [recipientId],
    filter: {},
    batchSize: 1,
  };
  page.replyOnce('RenamedPreview', () =>
    response({ previewInconnectLeadPool: prepared(input) }),
  );
  let isCurrent = true;
  await act(async () => {
    const pending = page.client
      .mutate({
        mutation,
        variables: { input },
        context: {
          leadPoolAdmission: {
            session: {
              identity: {
                workspaceId,
                actorUserId: actorA,
                workspaceMemberId: memberA,
              },
              isCurrent: () => isCurrent,
            },
            isCurrent: () => isCurrent,
          },
          disableAutomaticRetry: true,
        },
      })
      .catch(() => undefined);
    isCurrent = false;
    page.changeToB();
    await pending;
  });
  expect(
    page.callsFor('RenamedPreview').map((call) => ({
      credential: call.bearer === bearer(tokenB) ? 'Bearer B' : 'other',
      recordIds: call.variables.input.recordIds,
    })),
  ).toEqual([]);
});

it('pauses the same idle identity in cookie mode and requires fresh Bearer admission on return', async () => {
  const page = renderPage();
  await openOrigin();
  const previous = button('Consultar Leads');
  const beforeCookie = fetchMock.mock.calls.length;
  await act(async () => {
    page.setCookie(true);
    fireEvent.click(previous);
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'credenciales de la sesión',
  );
  expect(
    screen.queryByRole('button', { name: 'Consultar Leads' }),
  ).not.toBeInTheDocument();
  expect(fetchMock.mock.calls).toHaveLength(beforeCookie);

  act(() => page.setCookie(false));
  await openOrigin();
  fireEvent.click(button('Consultar Leads'));
  await screen.findByRole('checkbox', { name: 'Seleccionar Lead A' });
  expect(page.callsFor('InconnectLeadPoolRecords')).toMatchObject([
    { actor: actorA, bearer: bearer(tokenA) },
  ]);
});

it('R4-R4 withholds prior records and actions after Bearer returns until a fresh operation read', async () => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(recordId)).toBeInTheDocument();
  expect(button('Confirmar y procesar primer lote')).toBeEnabled();
  const original = prepared(page.previews()[0].variables.input);

  act(() => page.setCookie(true));
  await screen.findByRole('alert');
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();

  const forbidden = JSON.stringify({
    data: null,
    errors: [
      {
        message: 'Synthetic current access denied',
        extensions: { code: 'FORBIDDEN' },
      },
    ],
  });
  page.replyOnce('ExecuteInconnectLeadPool', () => forbidden);
  page.replyOnce('InconnectLeadPoolOperation', () =>
    response({
      inconnectLeadPoolOperation: {
        ...original,
        canExecute: false,
        recipients: original.recipients.map((recipient) => ({
          ...recipient,
          label: null,
          assignable: false,
        })),
        items: [],
        hiddenItems: 1,
      },
    }),
  );

  act(() => page.setCookie(false));
  await screen.findByRole('option', { name: 'Origen' });
  expect(screen.getByLabelText('Objeto de origen')).toHaveValue(origin);
  expect(screen.getByLabelText('Identificador de operación')).toHaveValue(
    operationId,
  );
  const confirmation = screen.queryByRole('button', {
    name: 'Confirmar y procesar primer lote',
  });
  const beforeRecovery = {
    visiblePriorRecord: screen.queryByText(recordId) !== null,
    visiblePriorSelection: screen.queryByText('Lead A') !== null,
    canConfirm: confirmation?.matches(':enabled') ?? false,
    operationReads: page.callsFor('InconnectLeadPoolOperation').length,
  };
  if (confirmation?.matches(':enabled')) {
    fireEvent.click(confirmation);
    await screen.findByText(/Synthetic current access denied/);
  }

  recover();
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(button('Confirmar y procesar primer lote')).toBeDisabled();
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(page.callsFor('InconnectLeadPoolOperation')).toMatchObject([
    { bearer: bearer(tokenA), variables: { input: { operationId } } },
  ]);
  expect({
    ...beforeRecovery,
    writes: page
      .callsFor('ExecuteInconnectLeadPool')
      .map(({ variables }) => variables),
  }).toEqual({
    visiblePriorRecord: false,
    visiblePriorSelection: false,
    canConfirm: false,
    operationReads: 0,
    writes: [],
  });
});

const accreditPreview = async (page: ReturnType<typeof renderPage>) => {
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);
  return prepared(page.previews()[0].variables.input);
};

const awaitRestoredCatalog = () =>
  screen.findByRole('option', { name: 'Origen' });

const restoreBearer = async (page: ReturnType<typeof renderPage>) => {
  act(() => {
    page.setCookie(true);
    page.setCookie(false);
  });
  await awaitRestoredCatalog();
};

it('R4-R4 blocks direct execute and cancel before React renders the authentication round trip and until recovery', async () => {
  const page = renderPage();
  await accreditPreview(page);
  const accredited = mockObservePool.mock.lastCall![0];
  await act(async () => {
    page.setCookie(true);
    const duringCookie = [accredited.advance(), accredited.cancel()];
    page.setCookie(false);
    await Promise.all([
      ...duringCookie,
      accredited.advance(),
      accredited.cancel(),
    ]);
  });
  await awaitRestoredCatalog();
  const stale = mockObservePool.mock.lastCall![0];
  expect(stale).toMatchObject({
    operation: null,
    needsProjectionRefresh: true,
    knownOperationId: operationId,
    originLocked: true,
    unresolved: false,
  });
  await act(async () => {
    await stale.advance();
    await stale.cancel();
  });
  expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);
  expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(0);
  expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(0);

  fireEvent.click(button('Actualizar disponibilidad'));
  await waitFor(() =>
    expect(page.callsFor('InconnectLeadPoolCatalog')).toHaveLength(3),
  );
  await awaitRestoredCatalog();
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(mockObservePool.mock.lastCall![0].needsProjectionRefresh).toBe(true);

  recover();
  expect(await screen.findByText(recordId)).toBeInTheDocument();
  expect(button('Confirmar y procesar primer lote')).toBeEnabled();
  expect(button('Cancelar registros pendientes')).toBeEnabled();
  await act(async () => {
    await accredited.advance();
    await stale.cancel();
  });
  expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);
  expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(0);

  await act(async () => mockObservePool.mock.lastCall![0].cancel());
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
  expect(page.callsFor('CancelInconnectLeadPool')).toMatchObject([
    {
      bearer: bearer(tokenA),
      variables: { input: { operationId, expectedVersion: 0 } },
    },
  ]);
});

it('R4-R4 ignores an earlier operation read that returns after Bearer restoration', async () => {
  const page = renderPage();
  const original = await accreditPreview(page);
  const earlier = deferred<string>();
  const current = deferred<string>();
  page.replyOnce('InconnectLeadPoolOperation', () => earlier.promise);
  recover();
  await waitFor(() =>
    expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(1),
  );
  await restoreBearer(page);
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  page.replyOnce('InconnectLeadPoolOperation', () => current.promise);
  recover();
  await waitFor(() =>
    expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(2),
  );

  await act(async () =>
    earlier.resolve(response({ inconnectLeadPoolOperation: original })),
  );
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Confirmar y procesar primer lote' }),
  ).not.toBeInTheDocument();
  expect(button('Consultar operación')).toBeDisabled();
  await act(async () =>
    current.resolve(
      response({
        inconnectLeadPoolOperation: {
          ...original,
          items: [],
          hiddenItems: 1,
          canExecute: false,
        },
      }),
    ),
  );
  expect(await screen.findByText(operationId)).toBeInTheDocument();
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(button('Confirmar y procesar primer lote')).toBeDisabled();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);
});

it.each([
  {
    failure: 'FORBIDDEN',
    reply: () =>
      JSON.stringify({
        data: null,
        errors: [
          { message: 'Synthetic forbidden', extensions: { code: 'FORBIDDEN' } },
        ],
      }),
  },
  {
    failure: 'temporary backend unavailability',
    reply: () =>
      JSON.stringify({
        data: null,
        errors: [
          {
            message: 'Synthetic temporary error',
            extensions: { code: 'SERVICE_UNAVAILABLE' },
          },
        ],
      }),
  },
  {
    failure: 'incomplete data',
    reply: () => response({ inconnectLeadPoolOperation: { id: operationId } }),
  },
  {
    failure: 'a contradiction with the confirmed checkpoint',
    reply: (original: LeadPoolOperation) =>
      response({
        inconnectLeadPoolOperation: { ...original, found: original.found + 1 },
      }),
  },
  {
    failure: 'another intention',
    reply: (original: LeadPoolOperation) =>
      response({
        inconnectLeadPoolOperation: { ...original, intentionId: uuid(100) },
      }),
  },
  {
    failure: 'another operation ID',
    reply: (original: LeadPoolOperation) =>
      response({
        inconnectLeadPoolOperation: { ...original, id: uuid(101) },
      }),
  },
])(
  'R4-R4 keeps the projection stale after $failure and permits a valid retry',
  async ({ reply }) => {
    const page = renderPage();
    const original = await accreditPreview(page);
    await restoreBearer(page);
    page.replyOnce('InconnectLeadPoolOperation', () => reply(original));
    recover();
    await screen.findByRole('alert');
    expect(screen.queryByText(recordId)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Confirmar y procesar primer lote',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancelar registros pendientes' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Identificador de operación')).toHaveValue(
      operationId,
    );
    expect(button('Consultar Leads')).toBeDisabled();
    await act(async () => {
      const pool = mockObservePool.mock.lastCall![0];
      await pool.advance();
      await pool.cancel();
    });
    expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);
    expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(0);

    recover();
    expect(await screen.findByText(recordId)).toBeInTheDocument();
    expect(button('Confirmar y procesar primer lote')).toBeEnabled();
    expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(2);
  },
);

it('R4-R4 permits the next batch of a recovered RUNNING operation with the new version', async () => {
  const page = renderPage();
  const original = await accreditPreview(page);
  const running = {
    ...original,
    status: 'RUNNING',
    version: 1,
    batchFailures: 1,
  } satisfies LeadPoolOperation;
  page.replyOnce('InconnectLeadPoolOperation', () =>
    response({ inconnectLeadPoolOperation: running }),
  );
  recover();
  expect(await screen.findByText(/RUNNING/)).toBeInTheDocument();
  expect(button('Procesar siguiente lote')).toBeEnabled();

  await restoreBearer(page);
  expect(
    screen.queryByRole('button', { name: 'Procesar siguiente lote' }),
  ).not.toBeInTheDocument();
  page.replyOnce('InconnectLeadPoolOperation', () =>
    response({
      inconnectLeadPoolOperation: { ...running, version: 2, batchFailures: 2 },
    }),
  );
  recover();
  expect(
    await screen.findByRole('button', { name: 'Procesar siguiente lote' }),
  ).toBeEnabled();
  page.replyOnce('ExecuteInconnectLeadPool', () =>
    response({
      executeInconnectLeadPool: {
        ...running,
        version: 3,
        batchFailures: 2,
        status: 'COMPLETED',
        processed: 1,
        canExecute: false,
        counts: { ...running.counts, PENDING: 0, CHANGED: 1 },
        items: [{ recordId, status: 'CHANGED' }],
      },
    }),
  );
  fireEvent.click(button('Procesar siguiente lote'));
  expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toMatchObject([
    { variables: { input: { operationId, expectedVersion: 2 } } },
  ]);
});

it('R4-R4 reconciles a possibly committed cancel after Bearer returns and allows a new intention', async () => {
  const page = renderPage();
  const original = await accreditPreview(page);
  const pending = deferred<string>();
  const cancelled = {
    ...original,
    status: 'CANCELLED',
    version: 1,
    canExecute: false,
    counts: { ...original.counts, PENDING: 0, REMAINING: 1 },
    items: [],
    hiddenItems: 1,
  } satisfies LeadPoolOperation;
  page.replyOnce('CancelInconnectLeadPool', () => pending.promise);
  fireEvent.click(button('Cancelar registros pendientes'));
  await waitFor(() =>
    expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(1),
  );
  await restoreBearer(page);
  expect(mockObservePool.mock.lastCall![0]).toMatchObject({
    unresolved: true,
    knownOperationId: operationId,
    operation: null,
  });
  await act(async () =>
    pending.resolve(
      response({
        cancelInconnectLeadPool: {
          ...cancelled,
          items: [{ recordId, status: 'REMAINING' }],
          hiddenItems: 0,
        },
      }),
    ),
  );
  expect(mockObservePool.mock.lastCall![0].unresolved).toBe(true);
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(screen.queryByText(/CANCELLED/)).not.toBeInTheDocument();

  page.replyOnce('InconnectLeadPoolOperation', () =>
    response({ inconnectLeadPoolOperation: cancelled }),
  );
  recover();
  expect(await screen.findByText(/CANCELLED/)).toBeInTheDocument();
  expect(screen.queryByText(recordId)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Cancelar registros pendientes' }),
  ).not.toBeInTheDocument();
  expect(mockObservePool.mock.lastCall![0].unresolved).toBe(false);
  expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(1);

  fireEvent.click(button('Nueva selección'));
  await selectForPreview();
  const nextId = uuid(104);
  page.replyOnce('PreviewInconnectLeadPool', ({ variables }) =>
    response({
      previewInconnectLeadPool: { ...prepared(variables.input), id: nextId },
    }),
  );
  fireEvent.click(button('Obtener vista previa'));
  expect(await screen.findByText(nextId)).toBeInTheDocument();
  expect(page.previews()[1].variables.input.intentionId).not.toBe(
    original.intentionId,
  );
});

it.each(['actor round trip', 'workspace member only'])(
  'R4-R4 never reuses a projection or late read across an identity change (%s)',
  async (change) => {
    const page = renderPage();
    const original = await accreditPreview(page);
    const earlier = deferred<string>();
    page.replyOnce('InconnectLeadPoolOperation', () => earlier.promise);
    recover();
    await waitFor(() =>
      expect(page.callsFor('InconnectLeadPoolOperation')).toHaveLength(1),
    );
    act(() => {
      page.setCookie(true);
      if (change === 'actor round trip') {
        page.changeToB();
        page.changeToA();
      } else {
        page.changeMember(memberB);
        page.setToken(
          leadPoolTestTokenPair(workspaceId, actorA, memberB, 'new-member'),
        );
      }
      page.setCookie(false);
    });
    await awaitRestoredCatalog();
    expect(screen.getByLabelText('Objeto de origen')).toHaveValue('');
    await openOrigin();
    await act(async () =>
      earlier.resolve(response({ inconnectLeadPoolOperation: original })),
    );
    expect(screen.getByLabelText('Identificador de operación')).toHaveValue('');
    expect(screen.queryByText(recordId)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Confirmar y procesar primer lote',
      }),
    ).not.toBeInTheDocument();
    expect(page.callsFor('ExecuteInconnectLeadPool')).toHaveLength(0);
    expect(page.callsFor('CancelInconnectLeadPool')).toHaveLength(0);
  },
);

it('keeps A’s uncertain intention out of B after leaving cookie mode', async () => {
  const page = renderPage();
  await selectForPreview();
  page.replyOnce('PreviewInconnectLeadPool', () =>
    Promise.reject(new Error('Synthetic response lost')),
  );
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByRole('alert');
  const previous = page.previews()[0];
  act(() => page.setCookie(true));
  await screen.findByRole('alert');
  act(() => {
    page.changeToB();
    page.setCookie(false);
  });
  await selectForPreview();
  expect(
    screen.queryByRole('button', {
      name: 'Recuperar la misma intención de preview',
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);
  expect(page.previews()).toMatchObject([{ actor: actorA }, { actor: actorB }]);
  expect(page.previews()[1].variables.input.intentionId).not.toBe(
    previous.variables.input.intentionId,
  );
  expect(page.previews()[1].variables.input.recordIds).toEqual([recordIdB]);
});

it.each(['during cookie', 'after returning to Bearer'])(
  'ignores a late preview response %s and permits reconciliation while the old request is pending',
  async (timing) => {
    const page = renderPage();
    await selectForPreview();
    const old = deferred<string>();
    const next = deferred<string>();
    const lateId = uuid(97);
    page.replyOnce('PreviewInconnectLeadPool', () => old.promise);
    fireEvent.click(button('Obtener vista previa'));
    await waitFor(() => expect(page.previews()).toHaveLength(1));
    const original = page.previews()[0].variables;
    const late = response({
      previewInconnectLeadPool: { ...prepared(original.input), id: lateId },
    });

    act(() => page.setCookie(true));
    await screen.findByRole('alert');
    if (timing === 'during cookie') await act(async () => old.resolve(late));
    act(() => page.setCookie(false));
    await openOrigin();
    expect(screen.queryByText(lateId)).not.toBeInTheDocument();
    expect(page.previews()).toHaveLength(1);

    page.replyOnce('PreviewInconnectLeadPool', () => next.promise);
    fireEvent.click(button('Recuperar la misma intención de preview'));
    await waitFor(() => expect(page.previews()).toHaveLength(2));
    if (timing === 'after returning to Bearer')
      await act(async () => old.resolve(late));
    expect(screen.queryByText(lateId)).not.toBeInTheDocument();
    expect(button('Recuperar la misma intención de preview')).toBeDisabled();
    expect(page.previews()[1].variables).toEqual(original);

    await act(async () =>
      next.resolve(
        response({ previewInconnectLeadPool: prepared(original.input) }),
      ),
    );
    expect(await screen.findByText(operationId)).toBeInTheDocument();
  },
);

it('keeps an uncertain execute and the accredited version across a mode trip', async () => {
  const page = renderPage();
  await selectForPreview();
  fireEvent.click(button('Obtener vista previa'));
  await screen.findByText(operationId);
  page.replyOnce('ExecuteInconnectLeadPool', () =>
    Promise.reject(new Error('Synthetic response lost')),
  );
  fireEvent.click(button('Confirmar y procesar primer lote'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Synthetic response lost',
  );

  act(() => page.setCookie(true));
  act(() => page.setCookie(false));
  await openOrigin();
  expect(screen.getByLabelText('Identificador de operación')).toHaveValue(
    operationId,
  );
  expect(button('Consultar Leads')).toBeDisabled();
  expect(button('Obtener vista previa')).toBeDisabled();
  recover();
  await screen.findByText(operationId);
  fireEvent.click(button('Confirmar y procesar primer lote'));
  expect(await screen.findByText(/COMPLETED/)).toBeInTheDocument();
  expect(page.callsFor('ExecuteInconnectLeadPool')).toMatchObject([
    { variables: { input: { operationId, expectedVersion: 0 } } },
    { variables: { input: { operationId, expectedVersion: 0 } } },
  ]);
});

it('releases only a preview proved unsent when the mode changes before dispatch', async () => {
  const page = renderPage();
  await selectForPreview();
  await act(async () => {
    fireEvent.click(button('Obtener vista previa'));
    page.setCookie(true);
    page.setCookie(false);
  });
  await openOrigin();
  expect(page.previews()).toHaveLength(0);
  expect(
    screen.queryByRole('button', {
      name: 'Recuperar la misma intención de preview',
    }),
  ).not.toBeInTheDocument();
  expect(button('Consultar Leads')).toBeEnabled();
});
