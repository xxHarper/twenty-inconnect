import { isUUID } from 'class-validator';
import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js';

export const INCONNECT_VOICE_PATH = 'auth/inconnect-voice';
export const VOICE_INTENT_TTL_SECONDS = 45;
export const VOICE_TOKEN_TTL_SECONDS = 300;

const sid = (value: string, prefix: string) =>
  new RegExp(`^${prefix}[a-fA-F0-9]{32}$`).test(value);

const isCanonicalPhone = (value: string) => {
  const phone = parsePhoneNumberFromString(value, { extract: false });

  return phone?.number === value && phone.isValid() && !phone.ext;
};

const parseVoiceIds = (input: string) => {
  if (input === '') return [];
  const ids = input.split(',').map((entry) => entry.trim().toLowerCase());
  return ids.length <= 32 &&
    ids.every((id) => isUUID(id)) &&
    new Set(ids).size === ids.length
    ? ids
    : null;
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
    INCONNECT_VOICE_HISTORY_USER_WORKSPACE_IDS: historyUsers = '',
    INCONNECT_VOICE_DIAL_USER_WORKSPACE_IDS: dialUsers = '',
    INCONNECT_VOICE_DEFAULT_COUNTRY: defaultCountrySetting = 'MX',
    INCONNECT_VOICE_MANUAL_ALLOWED_COUNTRIES: allowedCountrySetting = 'MX',
  } = env;

  const dialUserWorkspaceIds = parseVoiceIds(dialUsers);
  const countries = getCountries();
  const allowedCountryCodes = allowedCountrySetting
    .split(',')
    .map((code) => code.trim());

  if (
    dialUserWorkspaceIds === null ||
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
    defaultCountry: countries.find((code) => code === defaultCountrySetting),
    manualAllowedCountries: allowedCountryCodes.every((code) =>
      countries.some((country) => country === code),
    )
      ? allowedCountryCodes
      : [],
    dialUserWorkspaceIds: [userWorkspaceId, ...dialUserWorkspaceIds],
    historyUserWorkspaceIds: historyUsers
      .split(',')
      .map((value) => value.trim())
      .filter((value) => isUUID(value)),
    enabled: enabled === 'true',
  };
};

export const getVoiceInboundConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const base = getInconnectVoiceConfig(env);
  const {
    INCONNECT_VOICE_ENABLE_INBOUND: enabled,
    INCONNECT_VOICE_INBOUND_USER_WORKSPACE_ID: userWorkspaceId = '',
    INCONNECT_VOICE_INBOUND_NUMBER: receiver = '',
    INCONNECT_VOICE_INBOUND_TEST_SOURCE: source = '',
    INCONNECT_VOICE_INBOUND_URL: url = '',
    INCONNECT_VOICE_RECEIVE_USER_WORKSPACE_IDS: receiveUsers,
    INCONNECT_VOICE_ROUND_ROBIN_USER_WORKSPACE_IDS: roundRobinUsers = '',
    INCONNECT_VOICE_RING_SECONDS: ringSecondsSetting = '20',
    INCONNECT_VOICE_DISTRIBUTION_SECONDS: distributionSecondsSetting = '55',
    INCONNECT_VOICE_DISTRIBUTION_ATTEMPTS: attemptsSetting = '2',
    INCONNECT_VOICE_FALLBACK_UNAVAILABLE: fallbackUnavailable = 'false',
    INCONNECT_VOICE_RETRY_UNANSWERED: retryUnanswered = 'false',
  } = env;

  const receiveUserWorkspaceIds = parseVoiceIds(receiveUsers ?? '');
  const roundRobinUserWorkspaceIds = parseVoiceIds(roundRobinUsers);
  const ringSeconds = Number(ringSecondsSetting);
  const distributionSeconds = Number(distributionSecondsSetting);
  const maxAttempts = Number(attemptsSetting);
  const multiAgent = receiveUsers !== undefined;
  const distributionValid =
    receiveUserWorkspaceIds !== null &&
    roundRobinUserWorkspaceIds !== null &&
    (multiAgent
      ? receiveUserWorkspaceIds.length > 0
      : roundRobinUserWorkspaceIds.length === 0) &&
    roundRobinUserWorkspaceIds.every((id) =>
      receiveUserWorkspaceIds.includes(id),
    ) &&
    Number.isInteger(ringSeconds) &&
    ringSeconds >= 8 &&
    ringSeconds <= 25 &&
    Number.isInteger(distributionSeconds) &&
    distributionSeconds >= ringSeconds + 5 &&
    distributionSeconds <= 90 &&
    Number.isInteger(maxAttempts) &&
    maxAttempts >= 1 &&
    maxAttempts <= 5 &&
    [fallbackUnavailable, retryUnanswered].every(
      (value) => value === 'true' || value === 'false',
    ) &&
    (multiAgent ||
      (fallbackUnavailable === 'false' && retryUnanswered === 'false'));

  if (
    !base?.defaultCountry ||
    !distributionValid ||
    (!multiAgent && !isUUID(userWorkspaceId)) ||
    !isCanonicalPhone(receiver) ||
    !isCanonicalPhone(source) ||
    receiver === source
  )
    return null;

  try {
    const publicUrl = new URL(url);
    if (
      publicUrl.protocol !== 'https:' ||
      publicUrl.href !== url ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.search ||
      publicUrl.hash ||
      publicUrl.pathname !== `/${INCONNECT_VOICE_PATH}/inbound`
    )
      return null;
  } catch {
    return null;
  }

  return {
    ...base,
    userWorkspaceId,
    receiver,
    source,
    inboundUrl: url,
    ...(multiAgent
      ? {
          distribution: {
            receiveUserWorkspaceIds,
            roundRobinUserWorkspaceIds,
            ringSeconds,
            distributionSeconds,
            maxAttempts,
            fallbackUnavailable: fallbackUnavailable === 'true',
            retryUnanswered: retryUnanswered === 'true',
          },
        }
      : {}),
    inboundEnabled: enabled === 'true',
  };
};

export type VoiceInboundConfig = NonNullable<
  ReturnType<typeof getVoiceInboundConfig>
>;

export const canReceiveVoice = (
  config: VoiceInboundConfig,
  userWorkspaceId: string | undefined,
): userWorkspaceId is string =>
  Boolean(
    userWorkspaceId &&
    (
      config.distribution?.receiveUserWorkspaceIds ?? [config.userWorkspaceId]
    ).includes(userWorkspaceId),
  );

export type InconnectVoiceConfig = NonNullable<
  ReturnType<typeof getInconnectVoiceConfig>
>;
