import { FieldMetadataType } from 'twenty-shared/types';
import { type DataSource, type EntityManager } from 'typeorm';

import { type CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  InconnectMessagingAutoCreateAuthorityException,
  InconnectMessagingAutoCreateAuthorityExceptionCode,
} from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import {
  type InconnectMessagingAutoCreateAuthority,
  type InconnectMessagingAutoCreateAuthorityPlan,
  type InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { type InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutomationRecordCreateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-create.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_IDENTITY_ID = '33333333-3333-4333-8333-333333333333';
const PRIMARY_FIELD_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_FIELD_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_WORKSPACE_MEMBER_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_ROLE_ID = '77777777-7777-4777-8777-777777777777';
const AUTOMATION_USER_ID = '88888888-8888-4888-8888-888888888888';
const AUTOMATION_USER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const AUTOMATION_WORKSPACE_MEMBER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTOMATION_ROLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const plan: InconnectMessagingAutoCreateAuthorityPlan = Object.freeze({
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  objectMetadataNameSingular: 'lead',
  configurationRevision: '7',
  configurationUpdatedAt: '2026-10-05T12:00:00.000Z',
  primaryPhoneIdentityFieldId: PRIMARY_IDENTITY_ID,
  primaryPhoneFieldMetadataId: PRIMARY_FIELD_ID,
  primaryPhoneFieldName: 'phone',
  ownerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
  ownerRoleId: OWNER_ROLE_ID,
  ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
  ownerFieldMetadataId: OWNER_FIELD_ID,
  ownerFieldName: 'owner',
  ownerJoinColumnName: 'ownerId',
  allowedFieldMetadataIds: Object.freeze([PRIMARY_FIELD_ID, OWNER_FIELD_ID]),
  automationUserId: AUTOMATION_USER_ID,
  automationUserWorkspaceId: AUTOMATION_USER_WORKSPACE_ID,
  automationWorkspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
  automationRoleId: AUTOMATION_ROLE_ID,
  automationPrincipalName: 'INCONNECT Messaging Automation',
});

const flatObjectMetadata = {
  id: OBJECT_ID,
  universalIdentifier: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  nameSingular: 'lead',
  namePlural: 'leads',
  fieldIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
};
const primaryFieldMetadata = {
  id: PRIMARY_FIELD_ID,
  universalIdentifier: PRIMARY_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  name: 'phone',
  type: FieldMetadataType.PHONES,
};
const ownerFieldMetadata = {
  id: OWNER_FIELD_ID,
  universalIdentifier: OWNER_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: OBJECT_ID,
  name: 'owner',
  type: FieldMetadataType.RELATION,
};

const maps = {
  flatWorkspaceMemberMaps: {
    byId: {
      [AUTOMATION_WORKSPACE_MEMBER_ID]: {
        id: AUTOMATION_WORKSPACE_MEMBER_ID,
        userId: AUTOMATION_USER_ID,
        name: {
          firstName: 'INCONNECT Messaging',
          lastName: 'Automation',
        },
        deletedAt: null,
      },
    },
    idByUserId: {
      [AUTOMATION_USER_ID]: AUTOMATION_WORKSPACE_MEMBER_ID,
    },
  },
  flatObjectMetadataMaps: {
    byUniversalIdentifier: { [OBJECT_ID]: flatObjectMetadata },
    universalIdentifierById: { [OBJECT_ID]: OBJECT_ID },
    universalIdentifiersByApplicationId: {},
  },
  flatFieldMetadataMaps: {
    byUniversalIdentifier: {
      [PRIMARY_FIELD_ID]: primaryFieldMetadata,
      [OWNER_FIELD_ID]: ownerFieldMetadata,
    },
    universalIdentifierById: {
      [PRIMARY_FIELD_ID]: PRIMARY_FIELD_ID,
      [OWNER_FIELD_ID]: OWNER_FIELD_ID,
    },
    universalIdentifiersByApplicationId: {},
  },
  flatIndexMaps: {
    byUniversalIdentifier: {},
    universalIdentifierById: {},
    universalIdentifiersByApplicationId: {},
  },
};

const userWorkspace = {
  id: AUTOMATION_USER_WORKSPACE_ID,
  userId: AUTOMATION_USER_ID,
  workspaceId: WORKSPACE_ID,
  deletedAt: null,
  user: {
    id: AUTOMATION_USER_ID,
    firstName: 'INCONNECT Messaging',
    lastName: 'Automation',
    email: 'automation@internal.invalid',
    isEmailVerified: false,
    disabled: false,
    canImpersonate: false,
    canAccessFullAdminPanel: false,
    locale: 'en',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
  },
  workspace: {
    id: WORKSPACE_ID,
    displayName: 'Fixture',
    databaseSchema: 'workspace_fixture',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
  },
};

const buildHarness = () => {
  const authority = Object.freeze({}) as InconnectMessagingAutoCreateAuthority;
  const queryRunner = {
    isReleased: false,
    isTransactionActive: true,
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  } as unknown as WorkspaceQueryRunner;
  const manager = {
    getRepository: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue(userWorkspace),
    })),
  } as unknown as EntityManager;
  const dataSource = {
    createEntityManager: jest.fn().mockReturnValue(manager),
  } as unknown as DataSource;
  const authorityService = {
    revalidateCreatePlan: jest.fn().mockResolvedValue(plan),
    assertCreateScope: jest.fn().mockResolvedValue(plan),
  } as unknown as InconnectMessagingAutoCreateAuthorityService;
  const automationPrincipalService = {
    validate: jest.fn().mockResolvedValue({
      status: 'VALID',
      principal: {
        workspaceId: WORKSPACE_ID,
        userId: AUTOMATION_USER_ID,
        userWorkspaceId: AUTOMATION_USER_WORKSPACE_ID,
        workspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
        roleId: AUTOMATION_ROLE_ID,
        name: 'INCONNECT Messaging Automation',
      },
    }),
  } as unknown as InconnectMessagingAutomationPrincipalService;
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue(maps),
  } as unknown as WorkspaceCacheService;
  const commonCreateOneQueryRunnerService = {
    executeCreateOnlyForWriteReceiptWithQueryRunner: jest
      .fn()
      .mockResolvedValue({ objectMetadataId: OBJECT_ID, recordId: RECORD_ID }),
  } as unknown as CommonCreateOneQueryRunnerService;
  const service = new InconnectMessagingAutomationRecordCreateService(
    dataSource,
    authorityService,
    automationPrincipalService,
    workspaceCacheService,
    commonCreateOneQueryRunnerService,
  );

  return {
    authority,
    authorityService,
    automationPrincipalService,
    commonCreateOneQueryRunnerService,
    queryRunner,
    service,
    workspaceCacheService,
  };
};

describe('InconnectMessagingAutomationRecordCreateService', () => {
  it.each([
    [
      '+525514552571',
      {
        primaryPhoneCountryCode: 'MX',
        primaryPhoneCallingCode: '+52',
        primaryPhoneNumber: '5514552571',
        additionalPhones: null,
      },
    ],
    [
      '+14155552671',
      {
        primaryPhoneCountryCode: 'US',
        primaryPhoneCallingCode: '+1',
        primaryPhoneNumber: '4155552671',
        additionalPhones: null,
      },
    ],
  ])(
    'creates exactly PRIMARY plus Supervisor Owner for canonical identity %s',
    async (canonicalPhoneIdentity, expectedPhone) => {
      const harness = buildHarness();

      await expect(
        harness.service.execute({
          workspaceId: WORKSPACE_ID,
          canonicalPhoneIdentity,
          authority: harness.authority,
          queryRunner: harness.queryRunner,
          objectMetadataId: 'caller-object-is-ignored',
          ownerWorkspaceMemberId: 'caller-owner-is-ignored',
          principalId: 'caller-principal-is-ignored',
          actor: { source: 'SYSTEM' },
          payload: { name: 'caller-payload-is-ignored' },
        } as never),
      ).resolves.toEqual({
        objectMetadataId: OBJECT_ID,
        recordId: RECORD_ID,
      });

      expect(
        harness.authorityService.revalidateCreatePlan,
      ).toHaveBeenCalledWith({
        authority: harness.authority,
        queryRunner: harness.queryRunner,
        workspaceId: WORKSPACE_ID,
      });
      expect(harness.automationPrincipalService.validate).toHaveBeenCalledWith(
        expect.objectContaining({ lock: true, workspaceId: WORKSPACE_ID }),
      );
      expect(harness.authorityService.assertCreateScope).toHaveBeenCalledWith({
        authority: harness.authority,
        queryRunner: harness.queryRunner,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
        fieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
      });

      const [args, context, usedQueryRunner] = jest.mocked(
        harness.commonCreateOneQueryRunnerService
          .executeCreateOnlyForWriteReceiptWithQueryRunner,
      ).mock.calls[0];

      expect(args).toEqual({
        data: {
          phone: expectedPhone,
          owner: {
            connect: { where: { id: OWNER_WORKSPACE_MEMBER_ID } },
          },
        },
      });
      expect(Object.keys(args.data)).toEqual(['phone', 'owner']);
      expect(args.data).not.toHaveProperty('createdBy');
      expect(args.data).not.toHaveProperty('updatedBy');
      expect(args.data).not.toHaveProperty('name');
      expect(context.authContext).toMatchObject({
        type: 'user',
        workspace: { id: WORKSPACE_ID },
        user: { id: AUTOMATION_USER_ID },
        userWorkspaceId: AUTOMATION_USER_WORKSPACE_ID,
        workspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
      });
      expect(context.rolePermissionConfig).toBeUndefined();
      expect(usedQueryRunner).toBe(harness.queryRunner);
      expect(AUTOMATION_WORKSPACE_MEMBER_ID).not.toBe(
        OWNER_WORKSPACE_MEMBER_ID,
      );
      expect(harness.queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(harness.queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(harness.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(harness.queryRunner.release).not.toHaveBeenCalled();
    },
  );

  it.each(['+5215514552571', '5514552571', 'not-a-phone'])(
    'rejects non-canonical phone input %s before create',
    async (canonicalPhoneIdentity) => {
      const harness = buildHarness();

      await expect(
        harness.service.execute({
          workspaceId: WORKSPACE_ID,
          canonicalPhoneIdentity,
          authority: harness.authority,
          queryRunner: harness.queryRunner,
        }),
      ).rejects.toBeInstanceOf(InconnectMessagingAutoCreateAuthorityException);
      expect(
        harness.commonCreateOneQueryRunnerService
          .executeCreateOnlyForWriteReceiptWithQueryRunner,
      ).not.toHaveBeenCalled();
    },
  );

  it('fails before create when the transaction-bound plan is stale', async () => {
    const harness = buildHarness();

    jest
      .mocked(harness.authorityService.revalidateCreatePlan)
      .mockRejectedValue(
        new InconnectMessagingAutoCreateAuthorityException(
          'stale',
          InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
        ),
      );

    await expect(
      harness.service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority: harness.authority,
        queryRunner: harness.queryRunner,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
    });
    expect(harness.automationPrincipalService.validate).not.toHaveBeenCalled();
    expect(
      harness.commonCreateOneQueryRunnerService
        .executeCreateOnlyForWriteReceiptWithQueryRunner,
    ).not.toHaveBeenCalled();
  });

  it.each([
    'AUTOMATION_PRINCIPAL_MISSING',
    'AUTOMATION_PRINCIPAL_INVALID',
    'AUTOMATION_ROLE_INVALID',
    'AUTOMATION_PERMISSIONS_INVALID',
    'AUTOMATION_RECORD_ACCESS_POLICY_INVALID',
  ])('fails closed for principal drift %s', async (reason) => {
    const harness = buildHarness();

    jest.mocked(harness.automationPrincipalService.validate).mockResolvedValue({
      status: 'INVALID',
      reason,
    } as never);

    await expect(
      harness.service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority: harness.authority,
        queryRunner: harness.queryRunner,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
    });
    expect(
      harness.commonCreateOneQueryRunnerService
        .executeCreateOnlyForWriteReceiptWithQueryRunner,
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the automation principal would also be the Owner', async () => {
    const harness = buildHarness();

    jest
      .mocked(harness.authorityService.revalidateCreatePlan)
      .mockResolvedValue({
        ...plan,
        ownerWorkspaceMemberId: AUTOMATION_WORKSPACE_MEMBER_ID,
      });

    await expect(
      harness.service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority: harness.authority,
        queryRunner: harness.queryRunner,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
    });
  });

  it.each([
    {
      label: 'extra field',
      allowedFieldMetadataIds: [
        PRIMARY_FIELD_ID,
        OWNER_FIELD_ID,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
    },
    {
      label: 'missing Owner field',
      allowedFieldMetadataIds: [PRIMARY_FIELD_ID],
    },
  ])(
    'fails closed for a plan allowlist with $label',
    async ({ allowedFieldMetadataIds }) => {
      const harness = buildHarness();

      jest
        .mocked(harness.authorityService.revalidateCreatePlan)
        .mockResolvedValue({ ...plan, allowedFieldMetadataIds });

      await expect(
        harness.service.execute({
          workspaceId: WORKSPACE_ID,
          canonicalPhoneIdentity: '+525514552571',
          authority: harness.authority,
          queryRunner: harness.queryRunner,
        }),
      ).rejects.toMatchObject({
        code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      });
      expect(
        harness.commonCreateOneQueryRunnerService
          .executeCreateOnlyForWriteReceiptWithQueryRunner,
      ).not.toHaveBeenCalled();
    },
  );

  it('fails closed when cached metadata cannot construct a current normal user context', async () => {
    const harness = buildHarness();

    jest
      .mocked(harness.workspaceCacheService.getOrRecompute)
      .mockResolvedValue({
        ...maps,
        flatWorkspaceMemberMaps: { byId: {}, idByUserId: {} },
      } as never);

    await expect(
      harness.service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority: harness.authority,
        queryRunner: harness.queryRunner,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
    });
  });

  it('fails closed when the cached technical WorkspaceMember name drifts', async () => {
    const harness = buildHarness();

    jest
      .mocked(harness.workspaceCacheService.getOrRecompute)
      .mockResolvedValue({
        ...maps,
        flatWorkspaceMemberMaps: {
          ...maps.flatWorkspaceMemberMaps,
          byId: {
            [AUTOMATION_WORKSPACE_MEMBER_ID]: {
              ...maps.flatWorkspaceMemberMaps.byId[
                AUTOMATION_WORKSPACE_MEMBER_ID
              ],
              name: { firstName: 'Jane', lastName: 'Supervisor' },
            },
          },
        },
      } as never);

    await expect(
      harness.service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority: harness.authority,
        queryRunner: harness.queryRunner,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
    });
  });
});
