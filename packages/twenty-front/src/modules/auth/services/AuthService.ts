import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from '@apollo/client';

import { loggerLink } from '@/apollo/utils/loggerLink';
import {
  type AuthTokenPair,
  RenewTokenDocument,
  type RenewTokenMutation,
  type RenewTokenMutationVariables,
} from '~/generated-metadata/graphql';
import { isUndefinedOrNull } from '~/utils/isUndefinedOrNull';

const isDebugMode = process.env.IS_DEBUG_MODE === 'true';

const logger = loggerLink(() => 'Twenty-Refresh');

type ScopedRenewal = { canDispatch: () => boolean };

const renewTokenMutation = async (
  uri: string | undefined,
  refreshToken: string,
  scope?: ScopedRenewal,
) => {
  // A scoped bearer refresh must not overwrite a different session's cookie.
  const httpLink = scope
    ? new HttpLink({
        uri,
        credentials: 'omit',
        fetch: async (input, options) => {
          const init = {
            ...options,
            credentials: 'omit',
            redirect: 'error',
          } as const;
          if (!scope.canDispatch())
            throw new Error('Authentication context changed');
          return fetch(input, init);
        },
      })
    : new HttpLink({ uri, credentials: 'include' });

  const client = new ApolloClient({
    link: ApolloLink.from([
      ...(isDebugMode && !scope ? [logger] : []),
      httpLink,
    ]),
    cache: new InMemoryCache({}),
  });

  const result = await client.mutate<
    RenewTokenMutation,
    RenewTokenMutationVariables
  >({
    mutation: RenewTokenDocument,
    variables: {
      appToken: refreshToken,
    },
    fetchPolicy: 'network-only',
  });

  if (isUndefinedOrNull(result.data)) {
    throw new Error('Token renewal returned empty data');
  }

  return result.data;
};

export const renewToken = async (
  uri: string | undefined,
  tokenPair: AuthTokenPair | undefined | null,
  scope?: ScopedRenewal,
) => {
  if (!tokenPair) {
    throw new Error('Refresh token is not defined');
  }

  const data = await renewTokenMutation(
    uri,
    tokenPair.refreshToken.token,
    scope,
  );

  return data?.renewToken.tokens;
};
