import { type AuthTokenPair } from '~/generated-metadata/graphql';

const encode = (value: object) =>
  btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

export const leadPoolTestTokenPair = (
  workspaceId: string,
  userId: string,
  workspaceMemberId: string,
  marker: string,
): AuthTokenPair => {
  const commonClaims = { workspaceId, userId, sub: userId, marker };
  const token = (claims: object) =>
    `${encode({ alg: 'HS256' })}.${encode({ ...commonClaims, ...claims })}.fixture`;
  const expiresAt = '2030-01-01T00:00:00.000Z';
  return {
    accessOrWorkspaceAgnosticToken: {
      token: token({ type: 'ACCESS', workspaceMemberId }),
      expiresAt,
    },
    refreshToken: {
      token: token({ type: 'REFRESH', targetedTokenType: 'ACCESS' }),
      expiresAt,
    },
  };
};
