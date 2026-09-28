import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export type NormalizePhoneIdentityOptions = Readonly<{
  defaultCountry?: CountryCode;
}>;

const WHATSAPP_CHANNEL_PREFIX = /^whatsapp:/i;
const PHONE_INPUT_CHARACTERS = /^\+?[0-9\s()-]+$/;
const MEXICO_COUNTRY_CALLING_CODE = '52';
const MEXICO_LEGACY_MOBILE_PREFIX = '521';
const MEXICO_NATIONAL_NUMBER_LENGTH = 10;

const removePhoneFormatting = (input: string) => input.replace(/[\s()-]/g, '');

const hasBalancedParentheses = (input: string) => {
  let openParentheses = 0;

  for (const character of input) {
    if (character === '(') {
      openParentheses += 1;
    } else if (character === ')') {
      openParentheses -= 1;
    }

    if (openParentheses < 0) {
      return false;
    }
  }

  return openParentheses === 0;
};

const preparePhoneInput = ({
  compactInput,
  defaultCountry,
}: Readonly<{
  compactInput: string;
  defaultCountry: CountryCode | undefined;
}>): string | null => {
  const hasExplicitInternationalPrefix = compactInput.startsWith('+');
  const digits = hasExplicitInternationalPrefix
    ? compactInput.slice(1)
    : compactInput;

  if (
    (hasExplicitInternationalPrefix || defaultCountry === 'MX') &&
    digits.startsWith(MEXICO_LEGACY_MOBILE_PREFIX) &&
    digits.length ===
      MEXICO_LEGACY_MOBILE_PREFIX.length + MEXICO_NATIONAL_NUMBER_LENGTH
  ) {
    return `+${MEXICO_COUNTRY_CALLING_CODE}${digits.slice(
      MEXICO_LEGACY_MOBILE_PREFIX.length,
    )}`;
  }

  if (hasExplicitInternationalPrefix) {
    return compactInput;
  }

  if (defaultCountry === undefined) {
    return null;
  }

  if (defaultCountry !== 'MX') {
    return compactInput;
  }

  if (digits.length === MEXICO_NATIONAL_NUMBER_LENGTH) {
    return digits;
  }

  if (
    digits.startsWith(MEXICO_COUNTRY_CALLING_CODE) &&
    digits.length ===
      MEXICO_COUNTRY_CALLING_CODE.length + MEXICO_NATIONAL_NUMBER_LENGTH
  ) {
    return `+${digits}`;
  }

  return null;
};

export const normalizePhoneIdentity = (
  input: string | null | undefined,
  options: NormalizePhoneIdentityOptions = {},
): string | null => {
  if (typeof input !== 'string') {
    return null;
  }

  const withoutChannelPrefix = input
    .trim()
    .replace(WHATSAPP_CHANNEL_PREFIX, '')
    .trim();

  if (
    withoutChannelPrefix.length === 0 ||
    !PHONE_INPUT_CHARACTERS.test(withoutChannelPrefix) ||
    !hasBalancedParentheses(withoutChannelPrefix)
  ) {
    return null;
  }

  const compactInput = removePhoneFormatting(withoutChannelPrefix);

  if (compactInput === '+' || compactInput.slice(1).includes('+')) {
    return null;
  }

  const parseableInput = preparePhoneInput({
    compactInput,
    defaultCountry: options.defaultCountry,
  });

  if (parseableInput === null) {
    return null;
  }

  try {
    const phoneNumber = parsePhoneNumberFromString(
      parseableInput,
      parseableInput.startsWith('+') ? undefined : options.defaultCountry,
    );

    if (phoneNumber?.isValid() !== true) {
      return null;
    }

    if (
      phoneNumber.country === 'MX' &&
      phoneNumber.nationalNumber.length !== MEXICO_NATIONAL_NUMBER_LENGTH
    ) {
      return null;
    }

    return phoneNumber.number;
  } catch {
    return null;
  }
};
