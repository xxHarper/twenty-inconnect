import { FieldMetadataType } from 'twenty-shared/types';

import { InconnectMessagingContextValueKind } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import {
  getInconnectMessagingContextFieldColumnNames,
  getInconnectMessagingContextValueKind,
  normalizeInconnectMessagingContextDisplayValue,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-context-field.util';

const field = (
  type: FieldMetadataType,
  options: Array<{
    label: string;
    value: string;
    position: number;
  }> | null = null,
) => ({ type, name: 'customField', options });

describe('INCONNECT Messaging context field policy', () => {
  it.each([
    [FieldMetadataType.TEXT, InconnectMessagingContextValueKind.TEXT],
    [FieldMetadataType.NUMBER, InconnectMessagingContextValueKind.NUMBER],
    [FieldMetadataType.BOOLEAN, InconnectMessagingContextValueKind.BOOLEAN],
    [FieldMetadataType.DATE, InconnectMessagingContextValueKind.DATE],
    [FieldMetadataType.DATE_TIME, InconnectMessagingContextValueKind.DATE_TIME],
    [FieldMetadataType.EMAILS, InconnectMessagingContextValueKind.EMAIL],
    [FieldMetadataType.PHONES, InconnectMessagingContextValueKind.PHONE],
    [FieldMetadataType.LINKS, InconnectMessagingContextValueKind.URL],
    [FieldMetadataType.SELECT, InconnectMessagingContextValueKind.SELECT],
    [
      FieldMetadataType.MULTI_SELECT,
      InconnectMessagingContextValueKind.MULTI_SELECT,
    ],
  ])('supports %s as %s', (fieldMetadataType, valueKind) => {
    expect(getInconnectMessagingContextValueKind(fieldMetadataType)).toBe(
      valueKind,
    );
  });

  it.each([
    FieldMetadataType.RELATION,
    FieldMetadataType.MORPH_RELATION,
    FieldMetadataType.RICH_TEXT,
    FieldMetadataType.RAW_JSON,
    FieldMetadataType.FILES,
    FieldMetadataType.ARRAY,
  ])('rejects unsupported or unsafe type %s', (fieldMetadataType) => {
    expect(getInconnectMessagingContextValueKind(fieldMetadataType)).toBeNull();
  });

  it('normalizes scalar, null, enum, multi-enum and composite values to safe text', () => {
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.TEXT),
        values: ['plain text'],
      }),
    ).toBe('plain text');
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.TEXT),
        values: [null],
      }),
    ).toBeNull();
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.BOOLEAN),
        values: [false],
      }),
    ).toBe('false');
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.NUMBER),
        values: [42.5],
      }),
    ).toBe('42.5');
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.DATE),
        values: ['2026-09-21'],
      }),
    ).toBe('2026-09-21');

    const enumField = field(FieldMetadataType.SELECT, [
      { label: 'Won', value: 'WON', position: 0 },
      { label: 'Lost', value: 'LOST', position: 1 },
    ]);

    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: enumField,
        values: ['WON'],
      }),
    ).toBe('Won');
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: {
          ...enumField,
          type: FieldMetadataType.MULTI_SELECT,
        },
        values: [['WON', 'LOST']],
      }),
    ).toBe('Won, Lost');
    expect(
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: field(FieldMetadataType.FULL_NAME),
        values: ['Ada', 'Lovelace'],
      }),
    ).toBe('Ada Lovelace');
  });

  it('derives only metadata-backed physical columns', () => {
    expect(
      getInconnectMessagingContextFieldColumnNames(
        field(FieldMetadataType.FULL_NAME),
      ),
    ).toEqual(['customFieldFirstName', 'customFieldLastName']);
    expect(
      getInconnectMessagingContextFieldColumnNames(
        field(FieldMetadataType.PHONES),
      ),
    ).toEqual([
      'customFieldPrimaryPhoneCallingCode',
      'customFieldPrimaryPhoneNumber',
    ]);
    expect(
      getInconnectMessagingContextFieldColumnNames(
        field(FieldMetadataType.RELATION),
      ),
    ).toEqual([]);
  });
});
