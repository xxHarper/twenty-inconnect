import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type E164Number,
} from 'libphonenumber-js';

export type LeadVoiceDestination =
  | { status: 'missing' | 'invalid' }
  | { status: 'valid'; number: E164Number };

export const resolveLeadVoiceDestination = (
  phone: unknown,
): LeadVoiceDestination => {
  if (phone == null) {
    return { status: 'missing' };
  }

  if (typeof phone !== 'object' || !('primaryPhoneNumber' in phone)) {
    return { status: 'invalid' };
  }

  const number = phone.primaryPhoneNumber;
  if (number == null || (typeof number === 'string' && !number.trim())) {
    return { status: 'missing' };
  }
  if (typeof number !== 'string') {
    return { status: 'invalid' };
  }

  const callingCode =
    'primaryPhoneCallingCode' in phone ? phone.primaryPhoneCallingCode : null;
  if (
    callingCode != null &&
    callingCode !== '' &&
    (typeof callingCode !== 'string' || !/^\+?[1-9]\d{0,2}$/.test(callingCode))
  ) {
    return { status: 'invalid' };
  }

  const country =
    'primaryPhoneCountryCode' in phone ? phone.primaryPhoneCountryCode : null;
  const countryCode =
    typeof country === 'string' && isSupportedCountry(country)
      ? country
      : undefined;
  const storedDialCode =
    typeof callingCode === 'string' ? callingCode.replace(/^\+/, '') : '';
  const countryDialCode = countryCode && getCountryCallingCode(countryCode);
  if (storedDialCode && countryDialCode && storedDialCode !== countryDialCode) {
    return { status: 'invalid' };
  }

  const dialCode = storedDialCode || countryDialCode;
  const trimmedNumber = number.trim();
  const internationalNumber =
    !trimmedNumber.startsWith('+') && dialCode && !countryCode
      ? `+${dialCode}${trimmedNumber}`
      : trimmedNumber;
  const parsed = parsePhoneNumberFromString(internationalNumber, {
    defaultCountry: countryCode,
    extract: false,
  });

  if (
    !parsed?.isValid() ||
    parsed.ext ||
    (dialCode && parsed.countryCallingCode !== dialCode)
  ) {
    return { status: 'invalid' };
  }

  return { status: 'valid', number: parsed.number };
};
