import {
  FieldMetadataType,
  type FieldMetadataOptionForAnyType,
} from 'twenty-shared/types';

import { computeCompositeColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-column-name.util';
import { InconnectMessagingContextValueKind } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';

type ContextFieldMetadata = {
  type: FieldMetadataType;
  name: string;
  options: FieldMetadataOptionForAnyType;
};

const TYPE_TO_VALUE_KIND = new Map<
  FieldMetadataType,
  InconnectMessagingContextValueKind
>([
  [FieldMetadataType.TEXT, InconnectMessagingContextValueKind.TEXT],
  [FieldMetadataType.UUID, InconnectMessagingContextValueKind.TEXT],
  [FieldMetadataType.FULL_NAME, InconnectMessagingContextValueKind.TEXT],
  [FieldMetadataType.NUMBER, InconnectMessagingContextValueKind.NUMBER],
  [FieldMetadataType.NUMERIC, InconnectMessagingContextValueKind.NUMBER],
  [FieldMetadataType.BOOLEAN, InconnectMessagingContextValueKind.BOOLEAN],
  [FieldMetadataType.DATE, InconnectMessagingContextValueKind.DATE],
  [FieldMetadataType.DATE_TIME, InconnectMessagingContextValueKind.DATE_TIME],
  [FieldMetadataType.EMAILS, InconnectMessagingContextValueKind.EMAIL],
  [FieldMetadataType.PHONES, InconnectMessagingContextValueKind.PHONE],
  [FieldMetadataType.LINKS, InconnectMessagingContextValueKind.URL],
  [FieldMetadataType.SELECT, InconnectMessagingContextValueKind.SELECT],
  [FieldMetadataType.RATING, InconnectMessagingContextValueKind.SELECT],
  [
    FieldMetadataType.MULTI_SELECT,
    InconnectMessagingContextValueKind.MULTI_SELECT,
  ],
]);

const compositeColumn = (
  fieldMetadata: ContextFieldMetadata,
  propertyName: string,
): string =>
  computeCompositeColumnName(fieldMetadata, {
    name: propertyName,
    type: FieldMetadataType.TEXT,
    hidden: false,
    isRequired: false,
  });

export const getInconnectMessagingContextValueKind = (
  fieldMetadataType: FieldMetadataType,
): InconnectMessagingContextValueKind | null =>
  TYPE_TO_VALUE_KIND.get(fieldMetadataType) ?? null;

export const getInconnectMessagingContextFieldColumnNames = (
  fieldMetadata: ContextFieldMetadata,
): string[] => {
  switch (fieldMetadata.type) {
    case FieldMetadataType.FULL_NAME:
      return [
        compositeColumn(fieldMetadata, 'firstName'),
        compositeColumn(fieldMetadata, 'lastName'),
      ];
    case FieldMetadataType.EMAILS:
      return [compositeColumn(fieldMetadata, 'primaryEmail')];
    case FieldMetadataType.PHONES:
      return [
        compositeColumn(fieldMetadata, 'primaryPhoneCallingCode'),
        compositeColumn(fieldMetadata, 'primaryPhoneNumber'),
      ];
    case FieldMetadataType.LINKS:
      return [compositeColumn(fieldMetadata, 'primaryLinkUrl')];
    default:
      return getInconnectMessagingContextValueKind(fieldMetadata.type) === null
        ? []
        : [fieldMetadata.name];
  }
};

const stringifyValue = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

const optionLabel = (
  fieldMetadata: ContextFieldMetadata,
  value: unknown,
): string | null => {
  const stringValue = stringifyValue(value);

  if (stringValue === null) {
    return null;
  }

  const option = Array.isArray(fieldMetadata.options)
    ? fieldMetadata.options.find((candidate) => candidate.value === stringValue)
    : undefined;

  return option?.label ?? stringValue;
};

const normalizeMultiSelect = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value === null || value === undefined ? [] : [value];
  }

  const trimmedValue = value.trim();

  if (trimmedValue.startsWith('{') && trimmedValue.endsWith('}')) {
    const content = trimmedValue.slice(1, -1);

    return content === '' ? [] : content.split(',');
  }

  return [value];
};

export const normalizeInconnectMessagingContextDisplayValue = ({
  fieldMetadata,
  values,
}: {
  fieldMetadata: ContextFieldMetadata;
  values: unknown[];
}): string | null => {
  switch (fieldMetadata.type) {
    case FieldMetadataType.FULL_NAME:
      return (
        values
          .map(stringifyValue)
          .filter((value): value is string => value !== null)
          .join(' ') || null
      );
    case FieldMetadataType.EMAILS:
    case FieldMetadataType.LINKS:
      return stringifyValue(values[0]);
    case FieldMetadataType.PHONES:
      return (
        values
          .map(stringifyValue)
          .filter((value): value is string => value !== null)
          .join(' ') || null
      );
    case FieldMetadataType.SELECT:
    case FieldMetadataType.RATING:
      return optionLabel(fieldMetadata, values[0]);
    case FieldMetadataType.MULTI_SELECT:
      return (
        normalizeMultiSelect(values[0])
          .map((value) => optionLabel(fieldMetadata, value))
          .filter((value): value is string => value !== null)
          .join(', ') || null
      );
    case FieldMetadataType.BOOLEAN:
      return values[0] === null || values[0] === undefined
        ? null
        : values[0] === true
          ? 'true'
          : 'false';
    default:
      return stringifyValue(values[0]);
  }
};
