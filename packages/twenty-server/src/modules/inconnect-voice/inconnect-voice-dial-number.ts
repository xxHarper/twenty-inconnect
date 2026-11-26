import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { normalizePhoneIdentity } from 'twenty-shared/utils';

import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';

export const normalizeVoiceDialNumber = (
  input: string,
  config: InconnectVoiceConfig,
) => {
  // F13 also accepts a WhatsApp prefix. Voice accepts ordinary telephone input only.
  const canonical =
    config.defaultCountry &&
    input.length <= 64 &&
    /^\+?[0-9\s()-]+$/.test(input.trim())
      ? normalizePhoneIdentity(input, { defaultCountry: config.defaultCountry })
      : null;
  const phone = canonical && parsePhoneNumberFromString(canonical);

  if (!phone || !phone.country || !phone.isValid())
    throw new BadRequestException('Enter a valid phone number');

  return phone;
};

export const canDialVoiceNumber = (
  phone: ReturnType<typeof normalizeVoiceDialNumber>,
  config: InconnectVoiceConfig,
) =>
  phone.number === config.allowedDestination &&
  config.manualAllowedCountries.some((country) => country === phone.country) &&
  ['FIXED_LINE', 'MOBILE', 'FIXED_LINE_OR_MOBILE'].some(
    (type) => type === phone.getType(),
  );

export const requireVoiceDialNumber = (
  input: string,
  config: InconnectVoiceConfig,
) => {
  const phone = normalizeVoiceDialNumber(input, config);
  if (!canDialVoiceNumber(phone, config))
    throw new ForbiddenException('Voice destination is unavailable');
  return phone;
};
