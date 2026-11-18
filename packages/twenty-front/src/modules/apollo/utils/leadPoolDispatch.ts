import { type ApolloLink } from '@apollo/client';
import {
  getOperationAST,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
import { jwtDecode } from 'jwt-decode';

import { getIsCookieAuthActive } from '@/apollo/utils/getIsCookieAuthActive';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { type AuthTokenPair } from '~/generated-metadata/graphql';

const leadPoolRootFields = new Map<string, 'query' | 'mutation'>([
  ['inconnectLeadPoolCatalog', 'query'],
  ['inconnectLeadPoolRecords', 'query'],
  ['inconnectLeadPoolOperation', 'query'],
  ['previewInconnectLeadPool', 'mutation'],
  ['executeInconnectLeadPool', 'mutation'],
  ['cancelInconnectLeadPool', 'mutation'],
]);

export const classifyLeadPoolOperation = ({
  query,
  operationName,
}: Pick<ApolloLink.Operation, 'query' | 'operationName'>) => {
  const name = operationName ?? undefined;
  const operations = query.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  const selected = getOperationAST(query, name);
  const candidates =
    name === undefined
      ? operations
      : operations.filter((definition) => definition.name?.value === name);
  const ambiguousOperation = !selected || candidates.length !== 1;
  const roots =
    selected && !ambiguousOperation
      ? [selected]
      : candidates.length > 0
        ? candidates
        : operations;

  const fragments = new Map<string, FragmentDefinitionNode[]>();
  for (const definition of query.definitions) {
    if (definition.kind !== Kind.FRAGMENT_DEFINITION) continue;
    const name = definition.name.value;
    const definitions = fragments.get(name) ?? [];
    definitions.push(definition);
    fragments.set(name, definitions);
  }

  const pending = roots.map(({ selectionSet }) => ({
    selectionSet,
    exiting: false,
  }));
  const visited = new Map<SelectionSetNode, 'visiting' | 'visited'>();
  let protectedRoot = false;
  let ambiguousFields = false;
  while (pending.length > 0) {
    const { selectionSet, exiting } = pending.pop()!;
    if (exiting) {
      visited.set(selectionSet, 'visited');
      continue;
    }
    const mark = visited.get(selectionSet);
    if (mark === 'visiting') ambiguousFields = true;
    if (mark !== undefined) continue;
    visited.set(selectionSet, 'visiting');
    pending.push({ selectionSet, exiting: true });
    for (const selection of selectionSet.selections) {
      switch (selection.kind) {
        case Kind.FIELD: {
          // Names are schema fields. An alias or a child of a root field is not one.
          const kind = leadPoolRootFields.get(selection.name.value);
          if (kind === undefined) break;
          protectedRoot = true;
          if (selected?.operation !== kind) ambiguousFields = true;
          break;
        }
        case Kind.INLINE_FRAGMENT:
          pending.push({
            selectionSet: selection.selectionSet,
            exiting: false,
          });
          break;
        case Kind.FRAGMENT_SPREAD: {
          const definitions = fragments.get(selection.name.value) ?? [];
          if (definitions.length !== 1) ambiguousFields = true;
          for (const definition of definitions)
            pending.push({
              selectionSet: definition.selectionSet,
              exiting: false,
            });
          break;
        }
      }
    }
  }

  if (!protectedRoot) return 'ordinary';
  if (
    ambiguousOperation ||
    ambiguousFields ||
    selected.operation === 'subscription'
  )
    return 'blocked';
  return selected.operation;
};

export type LeadPoolIdentity = Readonly<{
  workspaceId: string | undefined;
  actorUserId: string | undefined;
  workspaceMemberId: string | undefined;
}>;

export type LeadPoolSession = Readonly<{
  identity: LeadPoolIdentity;
  isCurrent: () => boolean;
}>;

export type LeadPoolAdmission = Readonly<{
  session: LeadPoolSession;
  isCurrent: () => boolean;
}>;

export const leadPoolAdmissionContext = (
  session: LeadPoolSession | undefined,
  isCurrent: () => boolean,
) =>
  session ? { leadPoolAdmission: Object.freeze({ session, isCurrent }) } : {};

export const isLeadPoolOperation = (operation: ApolloLink.Operation) =>
  classifyLeadPoolOperation(operation) !== 'ordinary';

export const getLeadPoolAdmission = (operation: ApolloLink.Operation) => {
  const admission: LeadPoolAdmission | undefined =
    operation.getContext().leadPoolAdmission;
  return admission;
};

const dispatched = new WeakSet<ApolloLink.Operation>();

export class LeadPoolDispatchBlockedError extends Error {
  readonly beforeFirstDispatch: boolean;

  constructor(operation: ApolloLink.Operation) {
    super('Lead Pool dispatch rejected by local authentication context');
    this.beforeFirstDispatch = !dispatched.has(operation);
  }
}

type TokenClaims = {
  type?: unknown;
  sub?: unknown;
  userId?: unknown;
  workspaceId?: unknown;
  workspaceMemberId?: unknown;
  targetedTokenType?: unknown;
};

const readClaims = (token: string | undefined) => {
  if (!token) return;
  try {
    return jwtDecode<TokenClaims>(token);
  } catch {
    return;
  }
};

const matchesId = (claim: unknown, id: string | undefined) =>
  typeof claim === 'string' && !!id && claim.toLowerCase() === id;

const matchesSubject = (claims: TokenClaims, identity: LeadPoolIdentity) =>
  matchesId(claims.sub ?? claims.userId, identity.actorUserId) &&
  (claims.userId === undefined ||
    matchesId(claims.userId, identity.actorUserId)) &&
  matchesId(claims.workspaceId, identity.workspaceId);

export const matchesLeadPoolAccessToken = (
  pair: AuthTokenPair | undefined,
  session: LeadPoolSession,
) => {
  const claims = readClaims(pair?.accessOrWorkspaceAgnosticToken?.token);
  // This is only correlation. The backend verifies the signature and permissions.
  return (
    claims?.type === 'ACCESS' &&
    matchesSubject(claims, session.identity) &&
    matchesId(claims.workspaceMemberId, session.identity.workspaceMemberId)
  );
};

export const matchesLeadPoolRefreshToken = (
  pair: AuthTokenPair | undefined,
  session: LeadPoolSession,
) => {
  const claims = readClaims(pair?.refreshToken?.token);
  return (
    claims?.type === 'REFRESH' &&
    claims.targetedTokenType === 'ACCESS' &&
    matchesSubject(claims, session.identity)
  );
};

export const isLeadPoolBearerSession = (session: LeadPoolSession) =>
  session.isCurrent() && !getIsCookieAuthActive();

export const createLeadPoolFetch = (
  operation: ApolloLink.Operation,
  uri: string,
): typeof fetch => {
  const admission = getLeadPoolAdmission(operation);

  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const options = {
      ...init,
      headers,
      credentials: 'omit',
      redirect: 'error',
    } as const;
    const pair = getTokenPair();
    if (
      input !== uri ||
      !admission ||
      options.signal?.aborted === true ||
      operation.getContext().skipAuthToken === true ||
      !matchesLeadPoolAccessToken(pair, admission.session) ||
      headers.get('authorization') !==
        `Bearer ${pair?.accessOrWorkspaceAgnosticToken.token}` ||
      !isLeadPoolBearerSession(admission.session) ||
      !admission.isCurrent()
    )
      throw new LeadPoolDispatchBlockedError(operation);

    // UploadHttpLink has already serialized the request. The check and fetch
    // stay in the same turn, and the browser cannot substitute a session cookie.
    dispatched.add(operation);
    return fetch(input, options);
  };
};
