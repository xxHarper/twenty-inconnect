import { CombinedGraphQLErrors } from '@apollo/client/errors';

export const getInconnectMessagingErrorDetails = (error: unknown) => {
  if (!CombinedGraphQLErrors.is(error)) {
    return { code: null, subCode: null, message: null };
  }

  const graphQLError = error.errors[0];
  const extensions = graphQLError?.extensions;

  return {
    code: typeof extensions?.code === 'string' ? extensions.code : null,
    subCode:
      typeof extensions?.subCode === 'string' ? extensions.subCode : null,
    message:
      typeof graphQLError?.message === 'string' ? graphQLError.message : null,
  };
};

export const formatInconnectMessagingWindowExpiry = (
  expiresAt: string | null | undefined,
  locale: string,
) =>
  expiresAt
    ? new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(expiresAt))
    : null;
