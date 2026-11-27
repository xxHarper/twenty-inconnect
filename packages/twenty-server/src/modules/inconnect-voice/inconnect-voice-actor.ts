import { ForbiddenException } from '@nestjs/common';

import { type Request } from 'express';
import { z } from 'zod';

import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type RawAuthContext } from 'src/engine/core-modules/auth/types/raw-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { USER_SESSION_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-cookie-name.constant';
import { USER_SESSION_SECURE_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-secure-cookie-name.constant';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';

const forbidden = () => new ForbiddenException('Voice call is unavailable');

export const credentialSchema = z.union([
  z
    .object({
      authorization: z
        .string()
        .max(8192)
        .regex(/^Bearer [\w.\-]+$/i),
    })
    .strict(),
  z.object({ cookie: z.string().min(1).max(8192) }).strict(),
]);

export type VoiceAuthContext = Pick<
  RawAuthContext,
  | 'user'
  | 'workspace'
  | 'workspaceMember'
  | 'workspaceMemberId'
  | 'userWorkspaceId'
  | 'tokenType'
  | 'application'
  | 'apiKey'
  | 'impersonationContext'
>;

export const resolveVoiceActor = (
  context: VoiceAuthContext,
  config: InconnectVoiceConfig,
  allowHistory = false,
) => {
  const {
    user,
    workspace,
    workspaceMember,
    workspaceMemberId,
    userWorkspaceId,
  } = context;

  if (
    context.tokenType !== JwtTokenTypeEnum.ACCESS ||
    context.application ||
    context.apiKey ||
    context.impersonationContext?.impersonatorUserWorkspaceId ||
    context.impersonationContext?.impersonatedUserWorkspaceId ||
    !user ||
    !workspace ||
    !workspaceMember ||
    !workspaceMemberId ||
    !userWorkspaceId ||
    workspace.id !== config.workspaceId ||
    (!(config.dialUserWorkspaceIds ?? [config.userWorkspaceId]).includes(
      userWorkspaceId,
    ) &&
      !(
        allowHistory && config.historyUserWorkspaceIds.includes(userWorkspaceId)
      )) ||
    workspaceMember.id !== workspaceMemberId ||
    workspaceMember.userId !== user.id
  ) {
    throw forbidden();
  }

  return buildUserAuthContext({
    user,
    workspace,
    workspaceMember,
    workspaceMemberId,
    userWorkspaceId,
  });
};

export const getVoiceCredential = (request: Request) => {
  const { authorization, cookie } = request.headers;
  const sessionNames = [
    USER_SESSION_COOKIE_NAME,
    USER_SESSION_SECURE_COOKIE_NAME,
  ];
  const sessionCookies = cookie
    ?.split(';')
    .map((entry) => entry.trim())
    .filter((entry) =>
      sessionNames.some((name) => entry.startsWith(`${name}=`)),
    )
    .join('; ');
  const parsed = credentialSchema.safeParse(
    authorization === undefined
      ? { cookie: sessionCookies }
      : { authorization },
  );

  if (!parsed.success) throw forbidden();

  return parsed.data;
};

export const getVoiceIdentity = ({
  workspaceId,
  userWorkspaceId,
}: InconnectVoiceConfig) =>
  `inc_${workspaceId.replace(/-/g, '')}_${userWorkspaceId.replace(/-/g, '')}`;
