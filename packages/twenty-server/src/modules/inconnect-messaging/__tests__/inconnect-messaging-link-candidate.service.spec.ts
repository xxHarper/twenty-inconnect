import { FieldMetadataType } from 'twenty-shared/types';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InconnectMessagingContextFieldEntity } from 'src/modules/inconnect-messaging/entities/context-field.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingLinkCandidateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-link-candidate.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '12121212-1111-4111-8111-111111111111';
const OBJECT_ID = '12121212-2222-4222-8222-222222222222';
const CONVERSATION_ID = '12121212-3333-4333-8333-333333333333';
const RECORD_ID = '12121212-4444-4444-8444-444444444444';
const LABEL_FIELD_ID = '12121212-5555-4555-8555-555555555555';
const DISPLAY_FIELD_ID = '12121212-6666-4666-8666-666666666666';
const RESTRICTED_FIELD_ID = '12121212-7777-4777-8777-777777777777';
const authContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_dynamic' },
  workspaceMemberId: 'workspace-member-id',
  workspaceMember: { id: 'workspace-member-id' },
} as never;
const labelField = {
  id: LABEL_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.TEXT,
  name: 'displayName',
  label: 'Display name',
  options: null,
  isActive: true,
};
const displayField = {
  id: DISPLAY_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.SELECT,
  name: 'classification',
  label: 'Classification',
  options: [{ label: 'Priority', value: 'PRIORITY', position: 0 }],
  isActive: true,
};
const restrictedField = {
  id: RESTRICTED_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.TEXT,
  name: 'privateValue',
  label: 'Private',
  options: null,
  isActive: true,
};

const buildService = ({
  authorizedConversation = { id: CONVERSATION_ID },
  readableFieldIds = new Set([LABEL_FIELD_ID, DISPLAY_FIELD_ID]),
  recordAccessKind = 'owner-scoped',
  rawRecords = [
    {
      recordId: RECORD_ID,
      recordLabel: '  Acme  ',
      candidateField0Value0: '  Acme  ',
      candidateField1Value0: 'PRIORITY',
    },
  ],
  rawCountResult = { count: String(rawRecords.length) },
  labelType = FieldMetadataType.TEXT,
}: {
  authorizedConversation?: { id: string } | null;
  readableFieldIds?: Set<string> | null;
  recordAccessKind?: string;
  rawRecords?: Array<Record<string, unknown>>;
  rawCountResult?: unknown;
  labelType?: FieldMetadataType;
} = {}) => {
  const dynamicLabelField = { ...labelField, type: labelType };
  const repositories = new Map<unknown, unknown>([
    [
      InconnectMessagingConfigurationEntity,
      {
        findOne: jest.fn().mockResolvedValue({
          workspaceId: WORKSPACE_ID,
          anchorObjectMetadataId: OBJECT_ID,
        }),
      },
    ],
    [
      ObjectMetadataEntity,
      {
        findOne: jest.fn().mockResolvedValue({
          id: OBJECT_ID,
          workspaceId: WORKSPACE_ID,
          labelIdentifierFieldMetadataId: LABEL_FIELD_ID,
        }),
      },
    ],
    [
      InconnectMessagingContextFieldEntity,
      {
        find: jest.fn().mockResolvedValue([
          { fieldMetadataId: LABEL_FIELD_ID, ordinal: 0 },
          { fieldMetadataId: DISPLAY_FIELD_ID, ordinal: 1 },
          { fieldMetadataId: RESTRICTED_FIELD_ID, ordinal: 2 },
        ]),
      },
    ],
    [
      FieldMetadataEntity,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            dynamicLabelField,
            displayField,
            restrictedField,
          ]),
      },
    ],
  ]);
  const queryBuilder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameters: jest.fn(),
    clone: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rawRecords),
  };
  const countQueryBuilder = {
    select: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue(rawCountResult),
  };

  countQueryBuilder.select.mockReturnValue(countQueryBuilder);

  for (const method of [
    'select',
    'addSelect',
    'from',
    'where',
    'andWhere',
    'setParameters',
    'orderBy',
    'addOrderBy',
    'take',
  ] as const) {
    queryBuilder[method].mockReturnValue(queryBuilder);
  }
  queryBuilder.clone.mockReturnValue(countQueryBuilder);

  const dataSource = {
    manager: {
      getRepository: jest.fn((entity) => repositories.get(entity)),
    },
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
  };
  const authorizationService = {
    findConversationAuthorizedForTriage: jest
      .fn()
      .mockResolvedValue(authorizedConversation),
    filterReadableFieldMetadataIds: jest
      .fn()
      .mockResolvedValue(readableFieldIds),
  };
  const recordAccessAuthorizationService = {
    applyReadScopeToQueryBuilder: jest
      .fn()
      .mockResolvedValue({ kind: recordAccessKind }),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: {
        universalIdentifierById: { [OBJECT_ID]: 'dynamic-object' },
        byUniversalIdentifier: {
          'dynamic-object': {
            id: OBJECT_ID,
            workspaceId: WORKSPACE_ID,
            nameSingular: 'dynamicRecord',
          },
        },
      },
    }),
  };

  return {
    service: new InconnectMessagingLinkCandidateService(
      dataSource as never,
      authorizationService as never,
      recordAccessAuthorizationService as never,
      workspaceCacheService as never,
    ),
    dataSource,
    queryBuilder,
    countQueryBuilder,
    authorizationService,
    recordAccessAuthorizationService,
  };
};

describe('InconnectMessagingLinkCandidateService', () => {
  it('rejects unauthorized and already-linked Conversation UUIDs without a CRM query', async () => {
    const { service, dataSource } = buildService({
      authorizedConversation: null,
    });

    await expect(
      service.getCandidates({
        authContext,
        conversationId: CONVERSATION_ID,
        search: 'Acme',
      }),
    ).rejects.toThrow('Conversation not found');
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns no records for blank search instead of dumping the anchor', async () => {
    const { service, dataSource } = buildService();

    await expect(
      service.getCandidates({
        authContext,
        conversationId: CONVERSATION_ID,
        search: '   ',
      }),
    ).resolves.toMatchObject({ edges: [], totalCount: 0 });
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('searches one dynamic anchor page with Record Access before pagination and returns only readable fields', async () => {
    const {
      service,
      dataSource,
      queryBuilder,
      countQueryBuilder,
      recordAccessAuthorizationService,
    } = buildService();

    const result = await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: '  Acme  ',
      first: 20,
    });

    expect(queryBuilder.from).toHaveBeenCalledWith(
      'workspace_dynamic._dynamicRecord',
      'inconnect_messaging_link_candidate',
    );
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        queryBuilder,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
      }),
    );
    expect(queryBuilder.clone).toHaveBeenCalledTimes(1);
    expect(countQueryBuilder.select).toHaveBeenCalledWith('COUNT(1)', 'count');
    expect(countQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      '"inconnect_messaging_link_candidate"."displayName"',
      'ASC',
    );
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
      '"inconnect_messaging_link_candidate"."id"',
      'ASC',
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(21);
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    expect(dataSource.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(result.edges[0]?.node).toEqual({
      recordId: RECORD_ID,
      recordLabel: '  Acme  ',
      fields: [
        {
          fieldMetadataId: LABEL_FIELD_ID,
          label: 'Display name',
          valueKind: 'TEXT',
          displayValue: '  Acme  ',
          ordinal: 0,
        },
        {
          fieldMetadataId: DISPLAY_FIELD_ID,
          label: 'Classification',
          valueKind: 'SELECT',
          displayValue: 'Priority',
          ordinal: 1,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('privateValue');
  });

  it('escapes ILIKE wildcard characters in the parameterized label predicate', async () => {
    const { service, queryBuilder } = buildService();

    await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: '  100%_safe  ',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE :candidateSearch'),
      { candidateSearch: '%100\\%\\_safe%' },
    );
  });

  it('counts the authorized search before adding cursor pagination', async () => {
    const {
      service,
      queryBuilder,
      countQueryBuilder,
      recordAccessAuthorizationService,
    } = buildService({
      rawCountResult: { count: '2' },
    });

    const result = await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: 'Acme',
      first: 1,
    });

    expect(result.totalCount).toBe(2);
    expect(queryBuilder.clone).toHaveBeenCalledTimes(1);
    expect(countQueryBuilder.select).toHaveBeenCalledWith('COUNT(1)', 'count');
    expect(countQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder.mock
        .invocationCallOrder[0],
    ).toBeLessThan(queryBuilder.clone.mock.invocationCallOrder[0]);
    expect(countQueryBuilder).not.toHaveProperty('getCount');
    expect(countQueryBuilder).not.toHaveProperty('take');
    expect(countQueryBuilder).not.toHaveProperty('orderBy');
  });

  it.each([
    ['missing', {}],
    ['negative string', { count: '-1' }],
    ['fractional string', { count: '1.5' }],
    ['unsafe integer', { count: '9007199254740992' }],
  ])(
    'fails closed for a %s raw count result',
    async (_name, rawCountResult) => {
      const { service } = buildService({ rawCountResult });

      await expect(
        service.getCandidates({
          authContext,
          conversationId: CONVERSATION_ID,
          search: 'Acme',
        }),
      ).rejects.toThrow('candidate count invariant failed');
    },
  );

  it('applies the opaque label plus UUID cursor after authorization and search', async () => {
    const { service, queryBuilder } = buildService();
    const firstPage = await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: 'Acme',
    });

    await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: 'Acme',
      after: firstPage.pageInfo.endCursor ?? undefined,
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(Object));
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the canonical label is unreadable', new Set([DISPLAY_FIELD_ID]), 'TEXT'],
    [
      'the canonical label has no safe scalar search representation',
      new Set([LABEL_FIELD_ID, DISPLAY_FIELD_ID]),
      'FULL_NAME',
    ],
  ] as const)(
    'returns an empty page when %s',
    async (_name, readableFieldIds, labelType) => {
      const { service, dataSource } = buildService({
        readableFieldIds: new Set(readableFieldIds),
        labelType: FieldMetadataType[labelType],
      });

      await expect(
        service.getCandidates({
          authContext,
          conversationId: CONVERSATION_ID,
          search: 'Acme',
        }),
      ).resolves.toMatchObject({ edges: [], totalCount: 0 });
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it('returns no rows when Record Access denies the final candidate SQL', async () => {
    const { service, queryBuilder, countQueryBuilder } = buildService({
      recordAccessKind: 'denied',
    });

    await expect(
      service.getCandidates({
        authContext,
        conversationId: CONVERSATION_ID,
        search: 'Acme',
      }),
    ).resolves.toMatchObject({ edges: [], totalCount: 0 });
    expect(queryBuilder.clone).not.toHaveBeenCalled();
    expect(countQueryBuilder.getRawOne).not.toHaveBeenCalled();
    expect(queryBuilder.getRawMany).not.toHaveBeenCalled();
  });

  it('keeps standard field authorization effective for an all-records scope', async () => {
    const { service } = buildService({ recordAccessKind: 'all-records' });

    const result = await service.getCandidates({
      authContext,
      conversationId: CONVERSATION_ID,
      search: 'Acme',
    });

    expect(result.edges).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('privateValue');
  });

  it('fails closed when standard object read permission is unavailable', async () => {
    const { service, dataSource } = buildService({
      readableFieldIds: null,
    });

    await expect(
      service.getCandidates({
        authContext,
        conversationId: CONVERSATION_ID,
        search: 'Acme',
      }),
    ).rejects.toThrow('Conversation not found');
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });
});
