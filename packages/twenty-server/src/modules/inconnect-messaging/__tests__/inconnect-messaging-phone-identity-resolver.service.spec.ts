import { FieldMetadataType } from 'twenty-shared/types';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  InconnectMessagingBackgroundPhoneIdentityResolverService,
  InconnectMessagingPhoneIdentityResolverService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '10101010-1111-4111-8111-111111111111';
const OBJECT_ID = '20202020-2222-4222-8222-222222222222';
const FIELD_A_ID = '30303030-3333-4333-8333-333333333333';
const FIELD_B_ID = '40404040-4444-4444-8444-444444444444';
const RECORD_A_ID = '50505050-5555-4555-8555-555555555555';
const RECORD_B_ID = '60606060-6666-4666-8666-666666666666';
const OTHER_WORKSPACE_ID = '70707070-7777-4777-8777-777777777777';
const authContext = {
  workspace: {
    id: WORKSPACE_ID,
    databaseSchema: 'workspace_test',
  },
  workspaceMemberId: 'member-id',
} as never;
const configuration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: OBJECT_ID,
};
const objectMetadata = {
  id: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
};
const fieldA = {
  id: FIELD_A_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.PHONES,
  name: 'mobilePhone',
  isActive: true,
};
const fieldB = {
  ...fieldA,
  id: FIELD_B_ID,
  name: 'officePhone',
};
const configuredPrimary = {
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  fieldMetadataId: FIELD_A_ID,
  role: 'PRIMARY',
  ordinal: 0,
};

const buildService = ({
  configuredFields = [configuredPrimary],
  fieldMetadata = [fieldA],
  rows = [],
  readableFieldIds,
  recordAccessKind = 'all-records',
  existingConfiguration = configuration,
  workspaceSchema = 'workspace_test',
}: {
  configuredFields?: Array<Record<string, unknown>>;
  fieldMetadata?: Array<Record<string, unknown>>;
  rows?: Array<{ recordId: string }>;
  readableFieldIds?: Set<string> | null;
  recordAccessKind?: string;
  existingConfiguration?: typeof configuration | null;
  workspaceSchema?: string | null;
} = {}) => {
  const effectiveReadableFieldIds =
    readableFieldIds === undefined
      ? new Set<string>(fieldMetadata.map(({ id }) => String(id)))
      : readableFieldIds;
  const queryBuilder = {
    select: jest.fn(),
    distinct: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    limit: jest.fn(),
    setLock: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };

  for (const method of [
    'select',
    'distinct',
    'from',
    'where',
    'andWhere',
    'limit',
    'setLock',
  ] as const) {
    queryBuilder[method].mockReturnValue(queryBuilder);
  }

  const configurationRepository = {
    findOne: jest.fn().mockResolvedValue(existingConfiguration),
  };
  const repositories = new Map<unknown, unknown>([
    [InconnectMessagingConfigurationEntity, configurationRepository],
    [
      InconnectMessagingPhoneIdentityFieldEntity,
      { find: jest.fn().mockResolvedValue(configuredFields) },
    ],
    [
      ObjectMetadataEntity,
      { findOne: jest.fn().mockResolvedValue(objectMetadata) },
    ],
    [FieldMetadataEntity, { find: jest.fn().mockResolvedValue(fieldMetadata) }],
    [
      WorkspaceEntity,
      {
        findOne: jest
          .fn()
          .mockImplementation(async ({ where }) =>
            where.id === WORKSPACE_ID
              ? { id: WORKSPACE_ID, databaseSchema: workspaceSchema }
              : null,
          ),
      },
    ],
  ]);
  const manager = {
    getRepository: jest.fn((entity) => repositories.get(entity)),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const dataSource = {
    manager,
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const authorizationService = {
    filterReadableFieldMetadataIds: jest
      .fn()
      .mockResolvedValue(effectiveReadableFieldIds),
  };
  const recordAccessAuthorizationService = {
    applyReadScopeToQueryBuilder: jest
      .fn()
      .mockImplementation(async ({ queryBuilder: scopedQueryBuilder }) => {
        scopedQueryBuilder.andWhere('AUTHORIZED_OWNER_SCOPE');

        return { kind: recordAccessKind };
      }),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: {
        universalIdentifierById: { [OBJECT_ID]: 'object-universal-id' },
        byUniversalIdentifier: {
          'object-universal-id': {
            id: OBJECT_ID,
            workspaceId: WORKSPACE_ID,
            nameSingular: 'contact',
            applicationUniversalIdentifier: 'custom-application',
          },
        },
      },
    }),
  };

  return {
    service: new InconnectMessagingPhoneIdentityResolverService(
      dataSource as never,
      authorizationService as never,
      recordAccessAuthorizationService as never,
      workspaceCacheService as never,
    ),
    backgroundService:
      new InconnectMessagingBackgroundPhoneIdentityResolverService(
        dataSource as never,
        workspaceCacheService as never,
      ),
    dataSource,
    queryBuilder,
    authorizationService,
    recordAccessAuthorizationService,
    configurationRepository,
  };
};

describe('InconnectMessagingPhoneIdentityResolverService', () => {
  it('returns INVALID without reading configuration or CRM for invalid input', async () => {
    const { service, dataSource } = buildService();

    await expect(
      service.resolvePhoneIdentity({ authContext, input: 'not-a-phone' }),
    ).resolves.toEqual({ state: 'INVALID' });
    expect(dataSource.manager.getRepository).not.toHaveBeenCalled();
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns DISABLED when configuration or configured fields are absent', async () => {
    const withoutConfiguration = buildService({ existingConfiguration: null });

    await expect(
      withoutConfiguration.service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });

    const withoutFields = buildService({ configuredFields: [] });

    await expect(
      withoutFields.service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });
  });

  it.each([
    ['+525514552571', undefined],
    ['+5215514552571', undefined],
    ['whatsapp:+5215514552571', undefined],
    ['5514552571', 'MX' as const],
  ])(
    'normalizes %s through the same exact Mexican structured lookup',
    async (input, defaultCountry) => {
      const { service, queryBuilder } = buildService({
        rows: [{ recordId: RECORD_A_ID }],
      });

      await expect(
        service.resolvePhoneIdentity({
          authContext,
          input,
          defaultCountry,
        }),
      ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('"mobilePhonePrimaryPhoneCountryCode"'),
        {
          phoneIdentityCountryCode: 'MX',
          phoneIdentityCallingCode: '+52',
          phoneIdentityNationalNumber: '5514552571',
        },
      );
    },
  );

  it('preserves an explicit +1 identity in structured lookup parameters', async () => {
    const { service, queryBuilder } = buildService();

    await service.resolvePhoneIdentity({
      authContext,
      input: '+14155552671',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        phoneIdentityCountryCode: 'US',
        phoneIdentityCallingCode: '+1',
        phoneIdentityNationalNumber: '4155552671',
      }),
    );
  });

  it.each([
    [[], { state: 'NO_MATCH' }],
    [[{ recordId: RECORD_A_ID }], { state: 'UNIQUE', recordId: RECORD_A_ID }],
    [
      [{ recordId: RECORD_A_ID }, { recordId: RECORD_B_ID }],
      { state: 'AMBIGUOUS' },
    ],
  ])('classifies distinct authorized rows', async (rows, expected) => {
    const { service } = buildService({ rows });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual(expected);
  });

  it('deduplicates the same record across PRIMARY and MATCH_ONLY fields', async () => {
    const { service, queryBuilder } = buildService({
      configuredFields: [
        configuredPrimary,
        {
          ...configuredPrimary,
          fieldMetadataId: FIELD_B_ID,
          role: 'MATCH_ONLY',
          ordinal: 1,
        },
      ],
      fieldMetadata: [fieldA, fieldB],
      rows: [{ recordId: RECORD_A_ID }, { recordId: RECORD_A_ID }],
    });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(' OR '),
      expect.any(Object),
    );
    expect(queryBuilder.limit).toHaveBeenCalledWith(2);
    expect(queryBuilder.distinct).toHaveBeenCalledWith(true);
  });

  it('fails closed before CRM lookup for corrupt non-empty configuration', async () => {
    const { service, dataSource } = buildService({
      configuredFields: [{ ...configuredPrimary, role: 'MATCH_ONLY' }],
    });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns a non-disclosing NO_MATCH when any configured field is unreadable', async () => {
    const { service, dataSource } = buildService({
      readableFieldIds: new Set(),
    });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'NO_MATCH' });
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('applies Record Access to the bounded final query before classification', async () => {
    const { service, queryBuilder, recordAccessAuthorizationService } =
      buildService({ rows: [{ recordId: RECORD_A_ID }] });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        queryBuilder,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        authContext,
      }),
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('"deletedAt" IS NULL'),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'AUTHORIZED_OWNER_SCOPE',
    );
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder.mock
        .invocationCallOrder[0],
    ).toBeLessThan(queryBuilder.getRawMany.mock.invocationCallOrder[0]);
  });

  it('does not disclose a matching record outside the human Record Access scope', async () => {
    const { service, queryBuilder } = buildService({
      rows: [{ recordId: RECORD_A_ID }],
      recordAccessKind: 'denied',
    });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'NO_MATCH' });
    expect(queryBuilder.getRawMany).not.toHaveBeenCalled();
  });
});

describe('InconnectMessagingBackgroundPhoneIdentityResolverService', () => {
  it('returns INVALID without reading configuration or CRM', async () => {
    const { backgroundService, dataSource } = buildService();

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: 'not-a-phone',
      }),
    ).resolves.toEqual({ state: 'INVALID' });
    expect(dataSource.manager.getRepository).not.toHaveBeenCalled();
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns DISABLED for missing, empty, or corrupt configuration', async () => {
    const withoutConfiguration = buildService({ existingConfiguration: null });

    await expect(
      withoutConfiguration.backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });

    const withoutFields = buildService({ configuredFields: [] });

    await expect(
      withoutFields.backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });

    const corruptFields = buildService({
      configuredFields: [{ ...configuredPrimary, role: 'MATCH_ONLY' }],
    });

    await expect(
      corruptFields.backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });
    expect(corruptFields.dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it.each([
    [[], { state: 'NO_MATCH' }],
    [[{ recordId: RECORD_A_ID }], { state: 'UNIQUE', recordId: RECORD_A_ID }],
    [
      [{ recordId: RECORD_A_ID }, { recordId: RECORD_B_ID }],
      { state: 'AMBIGUOUS' },
    ],
  ])(
    'classifies distinct workspace records without a human actor',
    async (rows, expected) => {
      const { backgroundService, recordAccessAuthorizationService } =
        buildService({ rows });

      await expect(
        backgroundService.resolvePhoneIdentity({
          workspaceId: WORKSPACE_ID,
          input: '+525514552571',
        }),
      ).resolves.toEqual(expected);
      expect(
        recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
      ).not.toHaveBeenCalled();
    },
  );

  it('returns UNIQUE regardless of which member or team owns the matching record', async () => {
    const {
      backgroundService,
      authorizationService,
      recordAccessAuthorizationService,
    } = buildService({
      rows: [{ recordId: RECORD_A_ID }],
      readableFieldIds: new Set(),
      recordAccessKind: 'denied',
    });

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
    expect(
      authorizationService.filterReadableFieldMetadataIds,
    ).not.toHaveBeenCalled();
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it('deduplicates one record matched through PRIMARY and MATCH_ONLY fields', async () => {
    const { backgroundService, queryBuilder } = buildService({
      configuredFields: [
        configuredPrimary,
        {
          ...configuredPrimary,
          fieldMetadataId: FIELD_B_ID,
          role: 'MATCH_ONLY',
          ordinal: 1,
        },
      ],
      fieldMetadata: [fieldA, fieldB],
      rows: [{ recordId: RECORD_A_ID }, { recordId: RECORD_A_ID }],
    });

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
    expect(queryBuilder.distinct).toHaveBeenCalledWith(true);
    expect(queryBuilder.limit).toHaveBeenCalledWith(2);
  });

  it('excludes soft-deleted rows from the exact bounded query', async () => {
    const { backgroundService, queryBuilder } = buildService({ rows: [] });

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'NO_MATCH' });
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('"deletedAt" IS NULL'),
    );
  });

  it('derives the physical schema only from the exact trusted workspace', async () => {
    const { backgroundService, queryBuilder } = buildService({ rows: [] });

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'NO_MATCH' });
    expect(queryBuilder.from).toHaveBeenCalledWith(
      expect.stringMatching(/^workspace_test\./),
      'inconnect_messaging_phone_identity_record',
    );

    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: OTHER_WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'DISABLED' });
  });

  it('intentionally finds a record hidden from the human resolver', async () => {
    const { service, backgroundService } = buildService({
      rows: [{ recordId: RECORD_A_ID }],
      recordAccessKind: 'denied',
    });

    await expect(
      service.resolvePhoneIdentity({
        authContext,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'NO_MATCH' });
    await expect(
      backgroundService.resolvePhoneIdentity({
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({ state: 'UNIQUE', recordId: RECORD_A_ID });
  });

  it('locks current configuration and exact matching targets for link revalidation', async () => {
    const {
      backgroundService,
      dataSource,
      queryBuilder,
      configurationRepository,
    } = buildService({ rows: [{ recordId: RECORD_A_ID }] });

    await expect(
      backgroundService.resolvePhoneIdentityForLink({
        manager: dataSource.manager as never,
        workspaceId: WORKSPACE_ID,
        input: '+525514552571',
      }),
    ).resolves.toEqual({
      state: 'UNIQUE',
      recordId: RECORD_A_ID,
      objectMetadataId: OBJECT_ID,
    });
    expect(configurationRepository.findOne).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
      lock: { mode: 'pessimistic_read' },
    });
    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_read');
    expect(queryBuilder.distinct).not.toHaveBeenCalled();
  });
});
