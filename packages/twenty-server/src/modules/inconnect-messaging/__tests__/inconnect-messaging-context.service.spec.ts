import { FieldMetadataType } from 'twenty-shared/types';

import { InconnectMessagingContextState } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context.service';

jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
const FIELD_A_ID = '55555555-5555-4555-8555-555555555555';
const FIELD_B_ID = '66666666-6666-4666-8666-666666666666';
const FIELD_C_ID = '77777777-7777-4777-8777-777777777777';
const authContext = {
  workspace: {
    id: WORKSPACE_ID,
    databaseSchema: 'workspace_test',
  },
} as never;
const linkedConversation = {
  id: CONVERSATION_ID,
  workspaceId: WORKSPACE_ID,
  linkedRecordObjectMetadataId: OBJECT_ID,
  linkedRecordId: RECORD_ID,
};
const objectMetadata = {
  id: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  labelSingular: 'Contact',
  labelIdentifierFieldMetadataId: FIELD_A_ID,
};
const fieldA = {
  id: FIELD_A_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.TEXT,
  name: 'internalName',
  label: 'Name',
  options: null,
  isActive: true,
};
const fieldB = {
  id: FIELD_B_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.TEXT,
  name: 'restrictedSecret',
  label: 'Restricted',
  options: null,
  isActive: true,
};
const fieldC = {
  id: FIELD_C_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  type: FieldMetadataType.SELECT,
  name: 'internalStage',
  label: 'Status',
  options: [{ label: 'Qualified', value: 'QUALIFIED', position: 0 }],
  isActive: true,
};

type BuildServiceOptions = {
  conversation?: {
    id: string;
    workspaceId: string;
    linkedRecordObjectMetadataId: string | null;
    linkedRecordId: string | null;
  } | null;
  readableFieldIds?: Set<string> | null;
  rawRecord?: Record<string, unknown> | null;
  recordAccessKind?: string;
};

const buildService = ({
  conversation = linkedConversation,
  readableFieldIds = new Set([FIELD_A_ID, FIELD_C_ID]),
  rawRecord = {
    recordId: RECORD_ID,
    contextField0Value0: 'Ada Lovelace',
    contextField1Value0: 'QUALIFIED',
  } as Record<string, unknown> | undefined,
  recordAccessKind = 'owner-scoped',
}: BuildServiceOptions = {}) => {
  const repositories = {
    InconnectMessagingConfigurationEntity: {
      findOne: jest.fn().mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        anchorObjectMetadataId: OBJECT_ID,
      }),
    },
    ObjectMetadataEntity: {
      findOne: jest.fn().mockResolvedValue(objectMetadata),
    },
    InconnectMessagingContextFieldEntity: {
      find: jest.fn().mockResolvedValue([
        { fieldMetadataId: FIELD_A_ID, ordinal: 0 },
        { fieldMetadataId: FIELD_B_ID, ordinal: 1 },
        { fieldMetadataId: FIELD_C_ID, ordinal: 2 },
      ]),
    },
    FieldMetadataEntity: {
      find: jest.fn().mockResolvedValue([fieldA, fieldB, fieldC]),
    },
  };
  const queryBuilder = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    addSelect: jest.fn(),
    setParameters: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue(rawRecord),
  };

  for (const method of [
    'select',
    'from',
    'where',
    'andWhere',
    'addSelect',
    'setParameters',
  ] as const) {
    queryBuilder[method].mockReturnValue(queryBuilder);
  }

  const dataSource = {
    manager: {
      getRepository: jest.fn(
        (entity) =>
          repositories[entity.name as keyof typeof repositories] ??
          (() => {
            throw new Error(`Unexpected repository ${entity.name}`);
          })(),
      ),
    },
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
  };
  const authorizationService = {
    findAuthorizedConversation: jest.fn().mockResolvedValue(conversation),
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
        universalIdentifierById: { [OBJECT_ID]: 'object-universal-id' },
        byUniversalIdentifier: {
          'object-universal-id': {
            id: OBJECT_ID,
            workspaceId: WORKSPACE_ID,
            nameSingular: 'contact',
            applicationUniversalIdentifier:
              '20202020-2020-4020-8020-202020202020',
          },
        },
      },
    }),
  };

  return {
    service: new InconnectMessagingContextService(
      dataSource as never,
      authorizationService as never,
      recordAccessAuthorizationService as never,
      workspaceCacheService as never,
    ),
    dataSource,
    queryBuilder,
    authorizationService,
    recordAccessAuthorizationService,
  };
};

describe('InconnectMessagingContextService', () => {
  it('returns non-disclosing null for an unauthorized or cross-workspace Conversation UUID', async () => {
    const { service, dataSource } = buildService({ conversation: null });

    await expect(
      service.getConversationContext({ authContext, conversationId: 'known' }),
    ).resolves.toBeNull();
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns UNASSIGNED without CRM lookup for a TRIAGE-authorized Conversation', async () => {
    const { service, dataSource } = buildService({
      conversation: {
        ...linkedConversation,
        linkedRecordObjectMetadataId: null,
        linkedRecordId: null,
      },
    });

    await expect(
      service.getConversationContext({ authContext, conversationId: 'known' }),
    ).resolves.toEqual({
      state: InconnectMessagingContextState.UNASSIGNED,
      object: null,
      record: null,
      fields: [],
    });
    expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns one scoped record query with only readable configured fields', async () => {
    const {
      service,
      dataSource,
      queryBuilder,
      authorizationService,
      recordAccessAuthorizationService,
    } = buildService();

    const result = await service.getConversationContext({
      authContext,
      conversationId: CONVERSATION_ID,
    });

    expect(result).toEqual({
      state: InconnectMessagingContextState.LINKED,
      object: { objectMetadataId: OBJECT_ID, label: 'Contact' },
      record: { recordId: RECORD_ID, recordLabel: 'Ada Lovelace' },
      fields: [
        {
          fieldMetadataId: FIELD_A_ID,
          label: 'Name',
          valueKind: 'TEXT',
          displayValue: 'Ada Lovelace',
          ordinal: 0,
        },
        {
          fieldMetadataId: FIELD_C_ID,
          label: 'Status',
          valueKind: 'SELECT',
          displayValue: 'Qualified',
          ordinal: 2,
        },
      ],
    });
    expect(
      authorizationService.filterReadableFieldMetadataIds,
    ).toHaveBeenCalled();
    expect(
      recordAccessAuthorizationService.applyReadScopeToQueryBuilder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        queryBuilder,
      }),
    );
    expect(queryBuilder.getRawOne).toHaveBeenCalledTimes(1);
    expect(queryBuilder.from).toHaveBeenCalledWith(
      'workspace_test._contact',
      'inconnect_messaging_context_record',
    );
    expect(dataSource.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(queryBuilder.addSelect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('restrictedSecret');
    expect(JSON.stringify(result)).not.toContain('internalStage');
    expect(JSON.stringify(result)).not.toContain('workspaceId');
    expect(JSON.stringify(result)).not.toContain('provider');
  });

  it('does not fall back to another field when the canonical label is unreadable', async () => {
    const { service } = buildService({
      readableFieldIds: new Set([FIELD_C_ID]),
      rawRecord: {
        recordId: RECORD_ID,
        contextField0Value0: 'QUALIFIED',
      },
    });

    const result = await service.getConversationContext({
      authContext,
      conversationId: CONVERSATION_ID,
    });

    expect(result?.record?.recordLabel).toBeNull();
    expect(result?.fields.map((field) => field.fieldMetadataId)).toEqual([
      FIELD_C_ID,
    ]);
  });

  it.each([
    ['standard object permission is revoked', null, 'owner-scoped'],
    ['Record Access denies', new Set([FIELD_A_ID]), 'denied'],
  ])('returns null when %s', async (_, readableFieldIds, recordAccessKind) => {
    const { service } = buildService({
      readableFieldIds: readableFieldIds as Set<string> | null,
      recordAccessKind,
    });

    await expect(
      service.getConversationContext({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBeNull();
  });

  it('returns null if the record disappears or access is revoked before the final scoped read', async () => {
    const { service } = buildService({ rawRecord: null });

    await expect(
      service.getConversationContext({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBeNull();
  });
});
