import { CombinedGraphQLErrors } from '@apollo/client/errors';

export const getInconnectMessagingErrorDetails = (error: unknown) => {
  if (!CombinedGraphQLErrors.is(error)) {
    return { code: null, subCode: null };
  }

  const extensions = error.errors[0]?.extensions;

  return {
    code: typeof extensions?.code === 'string' ? extensions.code : null,
    subCode:
      typeof extensions?.subCode === 'string' ? extensions.subCode : null,
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
