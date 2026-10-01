import { FieldMetadataType } from 'twenty-shared/types';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingAutoCreatePrimaryStatusDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON,
  InconnectMessagingAutoCreateEligibilityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import {
  InconnectMessagingAutoCreatePrimaryValidatorService,
  type PrimaryPhoneIdentityEvaluation,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';

const WORKSPACE_ID = '10101010-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ANCHOR_ID = '20202020-2222-4222-8222-222222222222';
const OTHER_ANCHOR_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_FIELD_ID = '30303030-3333-4333-8333-333333333333';
const OWNER_FIELD_ID = '40404040-4444-4444-8444-444444444444';
const WORKSPACE_MEMBER_OBJECT_ID = '50505050-5555-4555-8555-555555555555';
const OWNER_ROLE_ID = '60606060-6666-4666-8666-666666666666';
const DATABASE_SCHEMA = 'workspace_f13c1b';

const configuration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: ANCHOR_ID,
  autoCreateEnabled: true,
  autoCreateAnchorObjectMetadataId: ANCHOR_ID,
  autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
  autoCreateOwnerRoleId: OWNER_ROLE_ID,
  autoCreateLabelPolicy: 'OMIT',
} as InconnectMessagingConfigurationEntity;

const anchorObject = {
  id: ANCHOR_ID,
  workspaceId: WORKSPACE_ID,
  nameSingular: 'contact',
  labelSingular: 'Contact',
  isActive: true,
  isRemote: false,
} as ObjectMetadataEntity;

const field = (
  values: Partial<FieldMetadataEntity> &
    Pick<FieldMetadataEntity, 'id' | 'name' | 'type'>,
): FieldMetadataEntity =>
  ({
    workspaceId: WORKSPACE_ID,
    objectMetadataId: ANCHOR_ID,
    label: values.name,
    isActive: true,
    isNullable: true,
    isSystem: false,
    isSystemSideEffect: false,
    defaultValue: null,
    settings: null,
    relationTargetObjectMetadataId: null,
    ...values,
  }) as FieldMetadataEntity;

const primaryField = field({
  id: PRIMARY_FIELD_ID,
  name: 'mobilePhone',
  label: 'Mobile phone',
  type: FieldMetadataType.PHONES,
});
const ownerField = field({
  id: OWNER_FIELD_ID,
  name: 'owner',
  type: FieldMetadataType.RELATION,
  relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
  settings: { relationType: RelationType.MANY_TO_ONE },
});
const systemField = field({
  id: '70707070-7777-4777-8777-777777777777',
  name: 'id',
  type: FieldMetadataType.UUID,
  isNullable: false,
  isSystem: true,
  isSystemSideEffect: true,
});
const nullableField = field({
  id: '80808080-8888-4888-8888-888888888888',
  name: 'notes',
  type: FieldMetadataType.TEXT,
});
const defaultedField = field({
  id: '90909090-9999-4999-8999-999999999999',
  name: 'stage',
  type: FieldMetadataType.SELECT,
  isNullable: false,
  defaultValue: "'NEW'",
});

const validPrimaryEvaluation: PrimaryPhoneIdentityEvaluation = {
  summary: {
    status: InconnectMessagingAutoCreatePrimaryStatusDTO.VALID,
    fieldMetadataId: PRIMARY_FIELD_ID,
    label: 'Mobile phone',
    type: FieldMetadataType.PHONES,
    isActive: true,
  },
  issue: null,
};

const baseColumns = [
  {
    columnName: 'id',
    isNullable: 'NO',
    columnDefault: null,
    isGenerated: 'NEVER',
  },
  ...[
    'mobilePhonePrimaryPhoneNumber',
    'mobilePhonePrimaryPhoneCountryCode',
    'mobilePhonePrimaryPhoneCallingCode',
    'mobilePhoneAdditionalPhones',
    'ownerId',
    'notes',
  ].map((columnName) => ({
    columnName,
    isNullable: 'YES',
    columnDefault: null,
    isGenerated: 'NEVER',
  })),
  {
    columnName: 'stage',
    isNullable: 'NO',
    columnDefault: "'NEW'::text",
    isGenerated: 'NEVER',
  },
];

const exactUniqueIndex = {
  isUnique: true,
  isValid: true,
  isReady: true,
  isLive: true,
  isUnconditional: true,
  hasNoExpressions: true,
  keyColumns: [
    'mobilePhonePrimaryPhoneNumber',
    'mobilePhonePrimaryPhoneCountryCode',
    'mobilePhonePrimaryPhoneCallingCode',
  ],
};

const buildHarness = ({
  fields = [
    systemField,
    primaryField,
    ownerField,
    nullableField,
    defaultedField,
  ],
  columns = baseColumns,
  indexes = [exactUniqueIndex],
  currentConfiguration = configuration,
  currentAnchor = anchorObject,
  primaryRows = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: WORKSPACE_ID,
      objectMetadataId: ANCHOR_ID,
      fieldMetadataId: PRIMARY_FIELD_ID,
      role: 'PRIMARY',
      ordinal: 0,
    },
  ],
  primaryMetadata = primaryField,
}: {
  fields?: FieldMetadataEntity[];
  columns?: typeof baseColumns;
  indexes?: Array<typeof exactUniqueIndex>;
  currentConfiguration?: InconnectMessagingConfigurationEntity;
  currentAnchor?: ObjectMetadataEntity | null;
  primaryRows?: Array<Record<string, unknown>>;
  primaryMetadata?: FieldMetadataEntity | null;
} = {}) => {
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === InconnectMessagingPhoneIdentityFieldEntity) {
        return { find: jest.fn().mockResolvedValue(primaryRows) };
      }
      if (entity === FieldMetadataEntity) {
        return {
          find: jest.fn().mockResolvedValue(fields),
          findOne: jest.fn().mockResolvedValue(primaryMetadata),
        };
      }
      if (entity === WorkspaceEntity) {
        return {
          findOne: jest.fn().mockResolvedValue({
            id: WORKSPACE_ID,
            databaseSchema: DATABASE_SCHEMA,
          }),
        };
      }
      if (entity === ObjectMetadataEntity) {
        return {
          findOne: jest.fn().mockResolvedValue({
            id: WORKSPACE_MEMBER_OBJECT_ID,
            workspaceId: WORKSPACE_ID,
          }),
        };
      }
      throw new Error(`Unexpected repository ${entity.name}`);
    }),
    query: jest.fn(async (query: string) =>
      query.includes('information_schema.columns') ? columns : indexes,
    ),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: {
        universalIdentifierById: { [ANCHOR_ID]: 'anchor-universal-id' },
        byUniversalIdentifier: {
          'anchor-universal-id': {
            id: ANCHOR_ID,
            workspaceId: WORKSPACE_ID,
            nameSingular: 'contact',
            applicationUniversalIdentifier: 'custom-application',
          },
        },
      },
    }),
  };

  return {
    manager,
    primaryValidatorService:
      new InconnectMessagingAutoCreatePrimaryValidatorService(),
    service: new InconnectMessagingAutoCreateEligibilityService(
      workspaceCacheService as never,
    ),
    evaluate: () =>
      new InconnectMessagingAutoCreateEligibilityService(
        workspaceCacheService as never,
      ).evaluate({
        manager: manager as never,
        configuration: currentConfiguration,
        anchorObject: currentAnchor,
        ownerRoleIsValid: true,
        primaryPhoneIdentity: validPrimaryEvaluation,
      }),
  };
};

describe('InconnectMessagingAutoCreateEligibilityService', () => {
  it('accepts system-managed, nullable, and physically defaulted fields', async () => {
    const result = await buildHarness().evaluate();

    expect(result).toEqual({
      status: 'ELIGIBLE',
      reason: null,
      phoneUniquenessScope: 'ALL_ROWS',
    });
  });

  it('accepts a non-null column generated by PostgreSQL', async () => {
    const generatedField = field({
      id: 'abababab-abab-4bab-8bab-abababababab',
      name: 'generatedCode',
      type: FieldMetadataType.TEXT,
      isNullable: false,
    });
    const result = await buildHarness({
      fields: [
        systemField,
        primaryField,
        ownerField,
        nullableField,
        defaultedField,
        generatedField,
      ],
      columns: [
        ...baseColumns,
        {
          columnName: 'generatedCode',
          isNullable: 'NO',
          columnDefault: null,
          isGenerated: 'ALWAYS',
        },
      ],
    }).evaluate();

    expect(result.status).toBe('ELIGIBLE');
  });

  it('fails closed when nullable metadata conflicts with a required physical column', async () => {
    const result = await buildHarness({
      columns: baseColumns.map((column) =>
        column.columnName === 'notes'
          ? { ...column, isNullable: 'NO' as const }
          : column,
      ),
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID,
    );
  });

  it('rejects a required business field without a usable metadata/database default', async () => {
    const requiredField = field({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'requiredCode',
      type: FieldMetadataType.TEXT,
      isNullable: false,
    });
    const result = await buildHarness({
      fields: [systemField, primaryField, ownerField, requiredField],
      columns: [
        ...baseColumns.filter(({ columnName }) =>
          [
            'id',
            'mobilePhonePrimaryPhoneNumber',
            'mobilePhonePrimaryPhoneCountryCode',
            'mobilePhonePrimaryPhoneCallingCode',
            'mobilePhoneAdditionalPhones',
            'ownerId',
          ].includes(columnName),
        ),
        {
          columnName: 'requiredCode',
          isNullable: 'NO',
          columnDefault: null,
          isGenerated: 'NEVER',
        },
      ],
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.REQUIRED_FIELD_UNSATISFIED,
    );
  });

  it('rejects a required unsupported relation', async () => {
    const requiredRelation = field({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'requiredRelation',
      type: FieldMetadataType.RELATION,
      isNullable: false,
      relationTargetObjectMetadataId: OTHER_ANCHOR_ID,
      settings: { relationType: RelationType.MANY_TO_ONE },
    });
    const result = await buildHarness({
      fields: [systemField, primaryField, ownerField, requiredRelation],
      columns: [
        ...baseColumns.filter(({ columnName }) =>
          [
            'id',
            'mobilePhonePrimaryPhoneNumber',
            'mobilePhonePrimaryPhoneCountryCode',
            'mobilePhonePrimaryPhoneCallingCode',
            'mobilePhoneAdditionalPhones',
            'ownerId',
          ].includes(columnName),
        ),
        {
          columnName: 'requiredRelationId',
          isNullable: 'YES',
          columnDefault: null,
          isGenerated: 'NEVER',
        },
      ],
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_REQUIRED_FIELD,
    );
  });

  it.each([
    ['non-unique', { ...exactUniqueIndex, isUnique: false }],
    [
      'incomplete',
      {
        ...exactUniqueIndex,
        keyColumns: exactUniqueIndex.keyColumns.slice(0, 2),
      },
    ],
    [
      'unrelated',
      { ...exactUniqueIndex, keyColumns: ['stage', 'notes', 'ownerId'] },
    ],
    ['partial', { ...exactUniqueIndex, isUnconditional: false }],
  ])('rejects a %s phone index', async (_, index) => {
    const result = await buildHarness({ indexes: [index] }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PHONE_UNIQUENESS_NOT_GUARANTEED,
    );
  });

  it('fails closed when owner metadata is ambiguous', async () => {
    const result = await buildHarness({
      fields: [
        systemField,
        primaryField,
        ownerField,
        { ...ownerField, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ],
      columns: [
        ...baseColumns.filter(({ columnName }) => columnName !== 'notes'),
        {
          columnName: 'ownerId',
          isNullable: 'YES',
          columnDefault: null,
          isGenerated: 'NEVER',
        },
      ],
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.OWNER_CONFIGURATION_INVALID,
    );
  });

  it('fails closed on an anchor mismatch before schema inspection', async () => {
    const result = await buildHarness({
      currentConfiguration: {
        ...configuration,
        autoCreateAnchorObjectMetadataId: OTHER_ANCHOR_ID,
      } as InconnectMessagingConfigurationEntity,
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.ANCHOR_MISMATCH,
    );
  });

  it('fails closed on wrong-workspace anchor metadata', async () => {
    const result = await buildHarness({
      currentAnchor: {
        ...anchorObject,
        workspaceId: OTHER_WORKSPACE_ID,
      } as ObjectMetadataEntity,
    }).evaluate();

    expect(result.reason).toBe(
      INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_ANCHOR,
    );
  });

  it.each([
    ['missing PRIMARY', [], null, 'MISSING'],
    [
      'wrong-workspace PRIMARY',
      [
        {
          workspaceId: OTHER_WORKSPACE_ID,
          objectMetadataId: ANCHOR_ID,
          fieldMetadataId: PRIMARY_FIELD_ID,
          role: 'PRIMARY',
          ordinal: 0,
        },
      ],
      primaryField,
      'WRONG_WORKSPACE',
    ],
    [
      'wrong-type PRIMARY',
      [
        {
          workspaceId: WORKSPACE_ID,
          objectMetadataId: ANCHOR_ID,
          fieldMetadataId: PRIMARY_FIELD_ID,
          role: 'PRIMARY',
          ordinal: 0,
        },
      ],
      { ...primaryField, type: FieldMetadataType.TEXT },
      'WRONG_TYPE',
    ],
  ])(
    'reuses fail-closed Phone Identity validation for %s',
    async (_, rows, metadata, status) => {
      const { manager, primaryValidatorService } = buildHarness({
        primaryRows: rows,
        primaryMetadata: metadata as FieldMetadataEntity | null,
      });

      const result = await primaryValidatorService.evaluate({
        manager: manager as never,
        configuration,
      });

      expect(result.summary.status).toBe(status);
    },
  );
});
