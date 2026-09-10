import { PermissionFlagType } from 'twenty-shared/constants';

import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

const WORKSPACE_ID = '30303030-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '30303030-2222-4222-8222-222222222222';
const ANCHOR_OBJECT_METADATA_ID = '30303030-3333-4333-8333-333333333333';
const CONVERSATION_ID = '30303030-4444-4444-8444-444444444444';
const LEAD_ID = '30303030-5555-4555-8555-555555555555';
const ROLE_ID = '30303030-6666-4666-8666-666666666666';

const authContext = {
  type: 'user',
  workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_test' },
  userWorkspaceId: 'user-workspace-id',
  workspaceMemberId: 'workspace-member-id',
  workspaceMember: { id: 'workspace-member-id' },
  user: { id: 'user-id' },
} as never;

const linkedConversation = {
  id: CONVERSATION_ID,
  workspaceId: WORKSPACE_ID,
  linkedRecordObjectMetadataId: ANCHOR_OBJECT_METADATA_ID,
  linkedRecordId: LEAD_ID,
};

const unassignedConversation = {
  ...linkedConversation,
  linkedRecordObjectMetadataId: null,
  linkedRecordId: null,
};

const buildService = ({
  conversation = linkedConversation,
  configuration = {
    workspaceId: WORKSPACE_ID,
    anchorObjectMetadataId: ANCHOR_OBJECT_METADATA_ID,
  },
  allowedFlags = [PermissionFlagType.INCONNECT_MESSAGING],
  canReadAnchor = true,
  recordReadable = true,
  workspaceMemberValid = true,
  cacheFailure = false,
}: {
  conversation?:
    | typeof linkedConversation
    | typeof unassignedConversation
    | null;
  configuration?: {
    workspaceId: string;
    anchorObjectMetadataId: string;
  } | null;
  allowedFlags?: PermissionFlagType[];
  canReadAnchor?: boolean;
  recordReadable?: boolean;
  workspaceMemberValid?: boolean;
  cacheFailure?: boolean;
} = {}) => {
  const allowedFlagSet = new Set(allowedFlags);
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
  const configurationRepository = {
    findOne: jest.fn().mockResolvedValue(configuration),
  };
  const permissionsService = {
    checkRolesPermissions: jest
      .fn()
      .mockImplementation(
        async (
          _rolePermissionConfig: unknown,
          _workspaceId: string,
          flag: PermissionFlagType,
        ) => allowedFlagSet.has(flag),
      ),
  };
  const workspaceCacheService = {
    getOrRecompute: cacheFailure
      ? jest.fn().mockRejectedValue(new Error('cache failure'))
      : jest.fn().mockResolvedValue({
          userWorkspaceRoleMap: { 'user-workspace-id': ROLE_ID },
          apiKeyRoleMap: {},
          rolesPermissions: {
            [ROLE_ID]: {
              [ANCHOR_OBJECT_METADATA_ID]: {
                canReadObjectRecords: canReadAnchor,
                canUpdateObjectRecords: false,
                canSoftDeleteObjectRecords: false,
                canDestroyObjectRecords: false,
                restrictedFields: {},
                rowLevelPermissionPredicates: [],
                rowLevelPermissionPredicateGroups: [],
              },
            },
          },
        }),
  };
  const recordAccessAuthorizationService = {
    isAuthenticatedWorkspaceMemberValid: jest
      .fn()
      .mockResolvedValue(workspaceMemberValid),
    isRecordReadable: jest.fn().mockResolvedValue(recordReadable),
    buildAuthorizedRecordExistsCondition: jest.fn().mockResolvedValue({
      scope: recordReadable ? { kind: 'owner-scoped' } : { kind: 'denied' },
      sql: recordReadable
        ? 'EXISTS (SELECT 1 FROM "workspace_test"."_lead" "lead" WHERE "lead"."id" = "conversation"."linkedRecordId")'
        : '1 = 0',
      parameters: recordReadable ? { ownerIds: ['workspace-member-id'] } : {},
    }),
  };
  const service = new InconnectMessagingAuthorizationService(
    conversationRepository as never,
    configurationRepository as never,
    permissionsService as never,
    workspaceCacheService as never,
    recordAccessAuthorizationService as never,
  );

  return {
    service,
    allowedFlagSet,
    conversationRepository,
    configurationRepository,
    permissionsService,
    workspaceCacheService,
    recordAccessAuthorizationService,
  };
};

describe('InconnectMessagingAuthorizationService', () => {
  it('allows an owner whose linked Lead is authorized', async () => {
    const { service } = buildService({ recordReadable: true });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    ['unrelated user', false],
    ['coordinator with the owner in Team scope', true],
    ['coordinator with the owner outside Team scope', false],
    ['denied Record Access policy', false],
  ])('composes Record Access for %s', async (_caseName, recordReadable) => {
    const { service } = buildService({ recordReadable });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(recordReadable);
  });

  it('denies when the functional permission flag is absent', async () => {
    const { service, recordAccessAuthorizationService } = buildService({
      allowedFlags: [],
    });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
    expect(
      recordAccessAuthorizationService.isRecordReadable,
    ).not.toHaveBeenCalled();
  });

  it.each(['all-records', 'not-managed'])(
    'still denies %s when standard object read permission is absent',
    async () => {
      const { service, recordAccessAuthorizationService } = buildService({
        canReadAnchor: false,
        recordReadable: true,
      });

      await expect(
        service.canReadConversation({
          authContext,
          conversationId: CONVERSATION_ID,
        }),
      ).resolves.toBe(false);
      expect(
        recordAccessAuthorizationService.isRecordReadable,
      ).not.toHaveBeenCalled();
    },
  );

  it('denies a Conversation returned from another workspace', async () => {
    const { service } = buildService({
      conversation: { ...linkedConversation, workspaceId: OTHER_WORKSPACE_ID },
    });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
  });

  it('denies an ObjectMetadata reference other than the configured anchor', async () => {
    const { service, recordAccessAuthorizationService } = buildService({
      conversation: {
        ...linkedConversation,
        linkedRecordObjectMetadataId: 'cross-workspace-object-metadata-id',
      },
    });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
    expect(
      recordAccessAuthorizationService.isRecordReadable,
    ).not.toHaveBeenCalled();
  });

  it.each([
    'nonexistent Lead',
    'soft-deleted Lead',
    'metadata failure',
    'policy inconsistency',
  ])('fails closed for %s', async () => {
    const { service } = buildService({ recordReadable: false });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
  });

  it('returns null for direct UUID access without authorization', async () => {
    const { service } = buildService({ recordReadable: false });

    await expect(
      service.findAuthorizedConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBeNull();
  });

  it('requires both Messaging and Send plus linked Lead access for send', async () => {
    const { service } = buildService({
      allowedFlags: [
        PermissionFlagType.INCONNECT_MESSAGING,
        PermissionFlagType.SEND_INCONNECT_MESSAGING,
      ],
      recordReadable: true,
    });

    await expect(
      service.canSendConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(true);
  });

  describe('unassigned conversations', () => {
    it.each([
      [
        'Messaging plus Triage',
        [
          PermissionFlagType.INCONNECT_MESSAGING,
          PermissionFlagType.TRIAGE_INCONNECT_MESSAGING,
        ],
        true,
      ],
      [
        'Messaging without Triage',
        [PermissionFlagType.INCONNECT_MESSAGING],
        false,
      ],
      [
        'Manage without Triage',
        [PermissionFlagType.MANAGE_INCONNECT_MESSAGING],
        false,
      ],
      [
        'Triage without Messaging',
        [PermissionFlagType.TRIAGE_INCONNECT_MESSAGING],
        false,
      ],
    ] as const)('%s => %s', async (_caseName, allowedFlags, expected) => {
      const { service } = buildService({
        conversation: unassignedConversation,
        allowedFlags: [...allowedFlags],
      });

      await expect(
        service.canTriageConversation({
          authContext,
          conversationId: CONVERSATION_ID,
        }),
      ).resolves.toBe(expected);
    });
  });

  it('keeps Manage independent from conversation read access', async () => {
    const { service } = buildService({
      allowedFlags: [PermissionFlagType.MANAGE_INCONNECT_MESSAGING],
    });

    await expect(service.canManageMessaging(authContext)).resolves.toBe(true);
    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
  });

  it('denies human operations when role/cache authority is unavailable', async () => {
    const { service } = buildService({ cacheFailure: true });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
  });

  it('denies every human operation when the authenticated Workspace Member is inactive', async () => {
    const { service } = buildService({ workspaceMemberValid: false });

    await expect(
      service.canReadConversation({
        authContext,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
    await expect(service.canManageMessaging(authContext)).resolves.toBe(false);
  });

  it('does not accept a system context as a human Messaging bypass', async () => {
    const { service } = buildService();

    await expect(
      service.canReadConversation({
        authContext: {
          type: 'system',
          workspace: { id: WORKSPACE_ID, databaseSchema: 'workspace_test' },
        } as never,
        conversationId: CONVERSATION_ID,
      }),
    ).resolves.toBe(false);
  });

  it('builds linked visibility as a workspace-scoped authorized-record EXISTS', async () => {
    const { service } = buildService({ recordReadable: true });
    const queryBuilder = { andWhere: jest.fn().mockReturnThis() };

    await service.applyConversationReadScope({
      authContext,
      queryBuilder: queryBuilder as never,
      conversationAlias: 'conversation',
    });

    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"conversation"."workspaceId"'),
      { inconnectMessagingWorkspaceId: WORKSPACE_ID },
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('EXISTS (SELECT 1 FROM'),
      expect.objectContaining({
        inconnectMessagingAnchorObjectMetadataId: ANCHOR_OBJECT_METADATA_ID,
      }),
    );
  });

  it('adds the unassigned branch only when both Messaging and Triage are present', async () => {
    const { service } = buildService({
      configuration: null,
      allowedFlags: [
        PermissionFlagType.INCONNECT_MESSAGING,
        PermissionFlagType.TRIAGE_INCONNECT_MESSAGING,
      ],
    });
    const queryBuilder = { andWhere: jest.fn().mockReturnThis() };

    await service.applyConversationReadScope({
      authContext,
      queryBuilder: queryBuilder as never,
      conversationAlias: 'conversation',
    });

    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"linkedRecordId" IS NULL'),
      {},
    );
  });
});
