import { ApolloLink, InMemoryCache, type DefaultContext } from '@apollo/client';
import { type DocumentNode, parse } from 'graphql';
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock';
import { firstValueFrom } from 'rxjs';

import { ApolloFactory } from '@/apollo/services/apollo.factory';
import { TOKEN_PAIR_LOCAL_STORAGE_KEY } from '@/auth/states/tokenPairState';
import { leadPoolTestTokenPair } from '@/inconnect-lead-management/__tests__/fixtures/leadPoolTestTokenPair';
import {
  LEAD_POOL_CANCEL,
  LEAD_POOL_CATALOG,
  LEAD_POOL_EXECUTE,
  LEAD_POOL_OPERATION,
  LEAD_POOL_PREVIEW,
  LEAD_POOL_RECORDS,
} from '@/inconnect-lead-management/graphql/leadPoolOperations';

enableFetchMocks();

const id = (value: number) =>
  `12345678-1234-4123-8123-${String(value).padStart(12, '0')}`;
const identityA = {
  workspaceId: id(1),
  actorUserId: id(2),
  workspaceMemberId: id(3),
};
const pairA = leadPoolTestTokenPair(
  identityA.workspaceId,
  identityA.actorUserId,
  identityA.workspaceMemberId,
  'routing-a',
);
const pairB = leadPoolTestTokenPair(id(1), id(4), id(5), 'routing-b');
const setPair = (pair: typeof pairA) =>
  localStorage.setItem(TOKEN_PAIR_LOCAL_STORAGE_KEY, JSON.stringify(pair));
const admission = (isCurrent = () => true) => ({
  leadPoolAdmission: { session: { identity: identityA, isCurrent }, isCurrent },
  queryDeduplication: false,
});

const client = (extraLinks?: ApolloLink[]) =>
  new ApolloFactory({
    uri: 'http://localhost/metadata',
    cache: new InMemoryCache(),
    currentWorkspace: null,
    currentWorkspaceMember: null,
    extraLinks,
  }).getClient();

const variables = {
  input: {
    operationId: id(6),
    expectedVersion: 0,
    objectId: id(7),
    offset: 0,
    first: 50,
    filter: {},
  },
};

const single = (
  apollo: ReturnType<typeof client>,
  document: DocumentNode,
  kind: 'query' | 'mutation',
  context: DefaultContext,
) =>
  kind === 'query'
    ? apollo.query({
        query: document,
        variables,
        context,
        fetchPolicy: 'no-cache',
      })
    : apollo.mutate({
        mutation: document,
        variables,
        context,
        fetchPolicy: 'no-cache',
      });

// ApolloClient's public APIs reject multi-operation documents. Exercise the
// factory link with the same operationName that UploadHttpLink will serialize.
const atLink = (
  apollo: ReturnType<typeof client>,
  document: DocumentNode,
  operationName?: string,
  context?: DefaultContext,
) => {
  const incoming = new ApolloLink((operation, forward) => {
    Object.assign(operation, { query: document, operationName });
    return apollo.link.request(operation, forward);
  });
  return firstValueFrom(
    ApolloLink.execute(
      incoming,
      { query: parse('{ __typename }'), context, variables },
      { client: apollo },
    ),
  );
};

const wire = () => {
  const options = fetchMock.mock.lastCall?.[1];
  expect(typeof options?.body).toBe('string');
  const body: { query?: string; operationName?: string; extensions?: unknown } =
    JSON.parse(String(options?.body));
  return { options, ...body };
};

beforeEach(() => {
  setPair(pairA);
  fetchMock.resetMocks();
  fetchMock.mockResponse(JSON.stringify({ data: {} }));
});

afterEach(() => {
  localStorage.removeItem(TOKEN_PAIR_LOCAL_STORAGE_KEY);
  jest.useRealTimers();
});

const operations = [
  ['catalog', 'query', LEAD_POOL_CATALOG, 'inconnectLeadPoolCatalog'],
  [
    'records',
    'query',
    LEAD_POOL_RECORDS,
    'inconnectLeadPoolRecords(input: $input)',
  ],
  [
    'recover',
    'query',
    LEAD_POOL_OPERATION,
    'inconnectLeadPoolOperation(input: $input)',
  ],
  [
    'preview',
    'mutation',
    LEAD_POOL_PREVIEW,
    'previewInconnectLeadPool(input: $input)',
  ],
  [
    'execute',
    'mutation',
    LEAD_POOL_EXECUTE,
    'executeInconnectLeadPool(input: $input)',
  ],
  [
    'cancel',
    'mutation',
    LEAD_POOL_CANCEL,
    'cancelInconnectLeadPool(input: $input)',
  ],
] as const;

it.each(operations)(
  'blocks %s with canonical and renamed documents before either can use bearer B',
  async (_label, kind, canonical, field) => {
    const syntax = field.includes('$input') ? '($input: JSONObject!)' : '';
    const renamed = parse(
      `${kind} UnrelatedName${syntax} { result: ${field} }`,
    );
    for (const document of [canonical, renamed]) {
      const apollo = client();
      setPair(pairA);
      let current = true;
      const pending = single(
        apollo,
        document,
        kind,
        admission(() => current),
      );
      current = false;
      setPair(pairB);
      await expect(pending).rejects.toMatchObject({
        beforeFirstDispatch: true,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it.each([
  ['anonymous', '{ inconnectLeadPoolCatalog }'],
  ['root alias', 'query Arbitrary { other: inconnectLeadPoolCatalog }'],
  [
    'inline fragment',
    'query Arbitrary { ... on Query { inconnectLeadPoolCatalog } }',
  ],
  [
    'named fragment',
    'query Arbitrary { ...Root } fragment Root on Query { ...Fields } fragment Fields on Query { inconnectLeadPoolCatalog }',
  ],
  ['mixed roots', 'query Arbitrary { __typename inconnectLeadPoolCatalog }'],
])('protects %s with and without a valid admission', async (_label, source) => {
  const apollo = client();
  const document = parse(source);
  await expect(single(apollo, document, 'query', {})).rejects.toMatchObject({
    beforeFirstDispatch: true,
  });
  let current = true;
  const pending = single(
    apollo,
    document,
    'query',
    admission(() => current),
  );
  current = false;
  setPair(pairB);
  await expect(pending).rejects.toMatchObject({ beforeFirstDispatch: true });
  expect(fetchMock).not.toHaveBeenCalled();

  setPair(pairA);
  await single(apollo, document, 'query', {
    ...admission(),
    http: { includeQuery: false, includeExtensions: true },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(wire()).toMatchObject({
    options: { credentials: 'omit', redirect: 'error' },
    query: expect.stringContaining('inconnectLeadPoolCatalog'),
  });
  expect(
    new Headers(wire().options?.headers).get('authorization') ===
      `Bearer ${pairA.accessOrWorkspaceAgnosticToken.token}`,
  ).toBe(true);
});

it.each([
  ['similar field', 'query Ordinary { inconnectLeadPoolCatalogInfo }'],
  [
    'canonical document name on an ordinary field',
    'query InconnectLeadPoolCatalog { __typename }',
  ],
  [
    'protected name only as an alias',
    'query Ordinary { inconnectLeadPoolCatalog: __typename }',
  ],
  [
    'nested field',
    'query Ordinary { currentUser { inconnectLeadPoolCatalog } }',
  ],
  [
    'nested fragment',
    'query Ordinary { currentUser { ...Details } } fragment Details on User { inconnectLeadPoolCatalog }',
  ],
])('preserves the standard route for %s', async (_label, source) => {
  await single(client(), parse(source), 'query', {});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(wire().options?.credentials).toBe('include');
});

const multi = parse(
  'query Standard { __typename } query Distributor { inconnectLeadPoolCatalog }',
);

it('keeps ApolloClient’s restriction on multi-operation requests through the public API', async () => {
  await expect(
    Promise.resolve().then(() => single(client(), multi, 'query', admission())),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('routes multiple operations by the operationName actually serialized', async () => {
  const apollo = client();
  await atLink(apollo, multi, 'Standard');
  expect(wire()).toMatchObject({
    operationName: 'Standard',
    options: { credentials: 'include' },
  });
  await expect(atLink(apollo, multi, 'Distributor')).rejects.toMatchObject({
    beforeFirstDispatch: true,
  });
  let current = true;
  const pending = atLink(
    apollo,
    multi,
    'Distributor',
    admission(() => current),
  );
  current = false;
  setPair(pairB);
  await expect(pending).rejects.toMatchObject({ beforeFirstDispatch: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  setPair(pairA);
  await atLink(apollo, multi, 'Distributor', admission());
  expect(wire()).toMatchObject({
    operationName: 'Distributor',
    options: { credentials: 'omit', redirect: 'error' },
  });
});

it.each([
  ['unselected multi-operation document', multi, undefined],
  ['unknown operationName', multi, 'Unknown'],
  [
    'duplicate operationName',
    parse(
      'query Repeated { __typename } query Repeated { inconnectLeadPoolCatalog }',
    ),
    'Repeated',
  ],
  [
    'multiple operations including an anonymous one',
    parse('{ __typename } query Distributor { inconnectLeadPoolCatalog }'),
    undefined,
  ],
  [
    'ambiguous root fragment',
    parse(
      'query Selection { ...Root } fragment Root on Query { __typename } fragment Root on Query { inconnectLeadPoolCatalog }',
    ),
    'Selection',
  ],
  [
    'cyclic root fragment',
    parse(
      'query Selection { ...Root } fragment Root on Query { ...Root inconnectLeadPoolCatalog }',
    ),
    'Selection',
  ],
  [
    'protected field in the wrong operation type',
    parse('query Selection { previewInconnectLeadPool }'),
    'Selection',
  ],
])('rejects %s even with an admission', async (_label, document, name) => {
  await expect(
    atLink(client(), document, name, admission()),
  ).rejects.toMatchObject({ beforeFirstDispatch: true });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rechecks before standard transport if a forwarding link changes the document', async () => {
  const rewrite = new ApolloLink((operation, forward) => {
    operation.query = parse('query Ordinary { inconnectLeadPoolCatalog }');
    return forward(operation);
  });
  await expect(
    single(
      client([rewrite]),
      parse('query Ordinary { __typename }'),
      'query',
      {},
    ),
  ).rejects.toMatchObject({ beforeFirstDispatch: true });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not retry a renamed mutation without disableAutomaticRetry', async () => {
  jest.useFakeTimers();
  fetchMock.mockRejectOnce(new Error('Synthetic response loss'));
  const document = parse(
    'mutation Arbitrary($input: JSONObject!) { other: cancelInconnectLeadPool(input: $input) }',
  );
  const rejected = expect(
    single(client(), document, 'mutation', admission()),
  ).rejects.toThrow('Synthetic response loss');
  await jest.runAllTimersAsync();
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
