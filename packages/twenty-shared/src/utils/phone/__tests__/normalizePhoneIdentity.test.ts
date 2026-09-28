import { normalizePhoneIdentity } from '@/utils/phone/normalizePhoneIdentity';

describe('normalizePhoneIdentity', () => {
  const mexicoContext = { defaultCountry: 'MX' } as const;

  it.each([
    '5514552571',
    '55 1455 2571',
    '55-1455-2571',
    '(55) 1455 2571',
    '+525514552571',
    '52 55 1455 2571',
    '525514552571',
    '+5215514552571',
    '5215514552571',
    'whatsapp:+525514552571',
    'whatsapp:+5215514552571',
  ])('should normalize Mexican input %s to one identity', (input) => {
    expect(normalizePhoneIdentity(input, mexicoContext)).toBe('+525514552571');
  });

  it('should require explicit Mexican context for a bare national number', () => {
    expect(normalizePhoneIdentity('5514552571')).toBeNull();
    expect(normalizePhoneIdentity('525514552571')).toBeNull();
  });

  it('should normalize an explicit legacy Mexican number without default-country context', () => {
    expect(normalizePhoneIdentity('whatsapp:+5215514552571')).toBe(
      '+525514552571',
    );
  });

  it('should support a non-Mexican default-country context explicitly', () => {
    expect(normalizePhoneIdentity('4155552671', { defaultCountry: 'US' })).toBe(
      '+14155552671',
    );
  });

  it.each([
    ['+14155552671', '+14155552671'],
    ['+442079460018', '+442079460018'],
  ])(
    'should preserve the country calling code for explicit international input %s',
    (input, expected) => {
      expect(normalizePhoneIdentity(input, mexicoContext)).toBe(expected);
    },
  );

  it.each([
    null,
    undefined,
    '',
    '   ',
    'not-a-phone',
    '12345',
    '12345678901234567890',
    '+',
    '++525514552571',
    '+52+5514552571',
    '+52)5514552571',
    '+52(5514552571',
    '14155552671',
    '0445514552571',
    '0455514552571',
    '015514552571',
  ])('should return null for unsafe input %s', (input) => {
    expect(normalizePhoneIdentity(input, mexicoContext)).toBeNull();
  });
});
