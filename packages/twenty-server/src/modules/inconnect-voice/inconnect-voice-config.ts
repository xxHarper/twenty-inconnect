import { isUUID } from 'class-validator';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const INCONNECT_VOICE_PATH = 'auth/inconnect-voice';
export const VOICE_INTENT_TTL_SECONDS = 45;
export const VOICE_TOKEN_TTL_SECONDS = 300;

const sid = (value: string, prefix: string) =>
  new RegExp(`^${prefix}[a-fA-F0-9]{32}$`).test(value);

const isCanonicalPhone = (value: string) => {
  const phone = parsePhoneNumberFromString(value, { extract: false });

  return phone?.number === value && phone.isValid() && !phone.ext;
};

export const getInconnectVoiceConfig = (
  env: NodeJS.ProcessEnv = process.env,
) => {
  const {
    INCONNECT_VOICE_ACCOUNT_SID: accountSid = '',
    INCONNECT_VOICE_API_KEY_SID: apiKeySid = '',
    INCONNECT_VOICE_API_KEY_SECRET: apiKeySecret = '',
    INCONNECT_VOICE_AUTH_TOKEN: authToken = '',
    INCONNECT_VOICE_TWIML_APP_SID: applicationSid = '',
    INCONNECT_VOICE_URL: voiceUrl = '',
    INCONNECT_VOICE_CALLER_ID: callerId = '',
    INCONNECT_VOICE_ALLOWED_DESTINATION: allowedDestination = '',
    INCONNECT_VOICE_WORKSPACE_ID: workspaceId = '',
    INCONNECT_VOICE_USER_WORKSPACE_ID: userWorkspaceId = '',
    INCONNECT_VOICE_LEAD_OBJECT_ID: objectId = '',
    INCONNECT_VOICE_PHONE_FIELD_ID: fieldId = '',
    INCONNECT_VOICE_ENABLE_OUTBOUND: enabled,
  } = env;

  if (
    !sid(accountSid, 'AC') ||
    !sid(apiKeySid, 'SK') ||
    !sid(applicationSid, 'AP') ||
    !apiKeySecret.trim() ||
    !authToken.trim() ||
    ![workspaceId, userWorkspaceId, objectId, fieldId].every((id) =>
      isUUID(id),
    ) ||
    !isCanonicalPhone(callerId) ||
    !isCanonicalPhone(allowedDestination)
  ) {
    return null;
  }

  try {
    const url = new URL(voiceUrl);

    if (
      url.protocol !== 'https:' ||
      url.href !== voiceUrl ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/${INCONNECT_VOICE_PATH}/twiml`
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    authToken,
    applicationSid,
    voiceUrl,
    callerId,
    allowedDestination,
    workspaceId,
    userWorkspaceId,
    objectId,
    fieldId,
    enabled: enabled === 'true',
  };
};

export type InconnectVoiceConfig = NonNullable<
  ReturnType<typeof getInconnectVoiceConfig>
>;
