import { resolveLeadVoiceDestination } from '@/inconnect-voice/utils/resolveLeadVoiceDestination';

describe('resolveLeadVoiceDestination', () => {
  it.each([
    ['5512345678', 'MX', '+52', '+525512345678'],
    ['2015550123', 'US', '+1', '+12015550123'],
    ['+44 7400 123456', '', '', '+447400123456'],
    ['5512345678', '', '+52', '+525512345678'],
  ])(
    'normalizes %s to an international destination',
    (number, country, dialCode, expected) => {
      expect(
        resolveLeadVoiceDestination({
          primaryPhoneNumber: number,
          primaryPhoneCountryCode: country,
          primaryPhoneCallingCode: dialCode,
        }),
      ).toEqual({ status: 'valid', number: expected });
    },
  );

  it.each([
    ['123', 'MX', '+52'],
    ['5512345678', '', ''],
    ['+12015550123', 'MX', '+52'],
    ['+12015550123', 'MX', '+1'],
    ['+12015550123 ext 15', 'US', '+1'],
  ])(
    'rejects an ambiguous or invalid destination (%s)',
    (number, country, dialCode) => {
      expect(
        resolveLeadVoiceDestination({
          primaryPhoneNumber: number,
          primaryPhoneCountryCode: country,
          primaryPhoneCallingCode: dialCode,
        }),
      ).toEqual({ status: 'invalid' });
    },
  );

  it('requires a primary phone when only additional phones exist', () => {
    expect(
      resolveLeadVoiceDestination({
        primaryPhoneNumber: '',
        additionalPhones: [
          { number: '5512345678', callingCode: '+52', countryCode: 'MX' },
        ],
      }),
    ).toEqual({ status: 'missing' });
  });
});
