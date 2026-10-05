import {
  getFieldPermissionUniversalIdentifier,
  getObjectPermissionUniversalIdentifier,
  getRoleUniversalIdentifier,
} from 'twenty-shared/application';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { RolePermissionFlagEntity } from 'src/engine/metadata-modules/role-permission-flag/role-permission-flag.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  getInconnectMessagingAutomationFieldPermissionId,
  getInconnectMessagingAutomationInternalEmail,
  getInconnectMessagingAutomationPrincipalIds,
  getInconnectMessagingAutomationRoleTargetUniversalIdentifier,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
  INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON,
  InconnectMessagingAutomationPrincipalService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutomationRecordAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-access.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_UNIVERSAL_IDENTIFIER = '33333333-3333-4333-8333-333333333333';
const ANCHOR_ID = '44444444-4444-4444-8444-444444444444';
const ANCHOR_UNIVERSAL_IDENTIFIER = '55555555-5555-4555-8555-555555555555';
const PRIMARY_FIELD_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_FIELD_ID = '77777777-7777-4777-8777-777777777777';
const BUSINESS_FIELD_ID = '88888888-8888-4888-8888-888888888888';
const MANAGED_OBJECT_ID = '99999999-9999-4999-8999-999999999999';
const POLICY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ids = getInconnectMessagingAutomationPrincipalIds(WORKSPACE_ID);

type PrincipalState = ReturnType<typeof createPrincipalState>;

const createPrincipalState = () => {
  const roleUniversalIdentifier = getRoleUniversalIdentifier({
    applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
    label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
  });
  const fields = [
    {
      id: PRIMARY_FIELD_ID,
      objectMetadataId: ANCHOR_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    {
      id: OWNER_FIELD_ID,
      objectMetadataId: ANCHOR_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },
    {
      id: BUSINESS_FIELD_ID,
      objectMetadataId: ANCHOR_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    },
  ];

  return {
    configuration: {
      workspaceId: WORKSPACE_ID,
      anchorObjectMetadataId: ANCHOR_ID,
      automationUserWorkspaceId: ids.userWorkspaceId,
    },
    workspace: {
      id: WORKSPACE_ID,
      databaseSchema: 'workspace_fixture',
      workspaceCustomApplicationId: APPLICATION_ID,
      deletedAt: null,
    },
    userWorkspace: {
      id: ids.userWorkspaceId,
      workspaceId: WORKSPACE_ID,
      userId: ids.userId,
      deletedAt: null,
    },
    user: {
      id: ids.userId,
      firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
      lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
      email: getInconnectMessagingAutomationInternalEmail(WORKSPACE_ID),
      deletedAt: null,
      disabled: false,
      passwordHash: null,
      isEmailVerified: false,
      canImpersonate: false,
      canAccessFullAdminPanel: false,
    },
    credentialCount: 0,
    workspaceMembers: [
      {
        id: ids.workspaceMemberId,
        userId: ids.userId,
        firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
        lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
        deletedAt: null,
      },
    ],
    application: {
      id: APPLICATION_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
      deletedAt: null,
    },
    role: {
      id: ids.roleId,
      workspaceId: WORKSPACE_ID,
      applicationId: APPLICATION_ID,
      universalIdentifier: roleUniversalIdentifier,
      label: INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL,
      isEditable: false,
      canBeAssignedToUsers: false,
      canBeAssignedToAgents: false,
      canBeAssignedToApiKeys: false,
      canUpdateAllSettings: false,
      canAccessAllTools: false,
      canReadAllObjectRecords: false,
      canUpdateAllObjectRecords: false,
      canSoftDeleteAllObjectRecords: false,
      canDestroyAllObjectRecords: false,
    },
    roleTargets: [
      {
        id: ids.roleTargetId,
        workspaceId: WORKSPACE_ID,
        applicationId: APPLICATION_ID,
        universalIdentifier:
          getInconnectMessagingAutomationRoleTargetUniversalIdentifier({
            applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
            userWorkspaceId: ids.userWorkspaceId,
          }),
        roleId: ids.roleId,
        userWorkspaceId: ids.userWorkspaceId,
        agentId: null,
        apiKeyId: null,
      },
    ],
    anchorObject: {
      id: ANCHOR_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: ANCHOR_UNIVERSAL_IDENTIFIER,
    },
    primaryRows: [
      {
        workspaceId: WORKSPACE_ID,
        objectMetadataId: ANCHOR_ID,
        fieldMetadataId: PRIMARY_FIELD_ID,
        role: 'PRIMARY',
      },
    ],
    fields,
    managedObjects: [
      {
        id: MANAGED_OBJECT_ID,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: ANCHOR_ID,
        ownerFieldMetadataId: OWNER_FIELD_ID,
        ownerRequirement: 'required',
      },
    ],
    objectPermissions: [
      {
        id: ids.objectPermissionId,
        workspaceId: WORKSPACE_ID,
        applicationId: APPLICATION_ID,
        universalIdentifier: getObjectPermissionUniversalIdentifier({
          applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
          objectUniversalIdentifier: ANCHOR_UNIVERSAL_IDENTIFIER,
          roleUniversalIdentifier,
        }),
        roleId: ids.roleId,
        objectMetadataId: ANCHOR_ID,
        canReadObjectRecords: false,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
      },
    ],
    fieldPermissions: fields.map((field) => ({
      id: getInconnectMessagingAutomationFieldPermissionId({
        fieldMetadataId: field.id,
        workspaceId: WORKSPACE_ID,
      }),
      workspaceId: WORKSPACE_ID,
      applicationId: APPLICATION_ID,
      universalIdentifier: getFieldPermissionUniversalIdentifier({
        applicationUniversalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
        fieldUniversalIdentifier: field.universalIdentifier,
        roleUniversalIdentifier,
      }),
      roleId: ids.roleId,
      objectMetadataId: ANCHOR_ID,
      fieldMetadataId: field.id,
      canReadFieldValue: null,
      canUpdateFieldValue:
        field.id === PRIMARY_FIELD_ID || field.id === OWNER_FIELD_ID
          ? null
          : false,
    })),
    permissionFlags: [] as unknown[],
    recordAccessConfiguration: {
      workspaceId: WORKSPACE_ID,
      enforcementMode: 'MANAGED',
    },
    policies: [
      {
        id: POLICY_ID,
        workspaceId: WORKSPACE_ID,
        managedObjectId: MANAGED_OBJECT_ID,
        roleId: ids.roleId,
        principalType: 'WORKSPACE_MEMBER',
        recordEffect: 'ownRecords',
        createPolicy: 'standardPermissionsOnly',
        ownerTransferPolicy: 'denied',
        missingOwnerPolicy: 'requireExplicit',
        defaultOwnerRoleId: null,
      },
    ],
  };
};

const asRows = (value: unknown): unknown[] =>
  value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : [value];

const createQueryBuilder = (getRows: () => unknown[]) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  withDeleted: jest.fn().mockReturnThis(),
  setLock: jest.fn().mockReturnThis(),
  getOne: jest.fn(async () => getRows()[0] ?? null),
  getMany: jest.fn(async () => getRows()),
});

const buildService = () => {
  const state = createPrincipalState();
  const repositoryFor = (entity: unknown) => {
    if (entity === InconnectMessagingConfigurationEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => asRows(state.configuration)),
      };
    }
    if (entity === WorkspaceEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => asRows(state.workspace)),
      };
    }
    if (entity === UserWorkspaceEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => asRows(state.userWorkspace)),
      };
    }
    if (entity === UserEntity) {
      return {
        createQueryBuilder: () => createQueryBuilder(() => asRows(state.user)),
      };
    }
    if (entity === AppTokenEntity) {
      return { count: jest.fn(async () => state.credentialCount) };
    }
    if (entity === ApplicationEntity) {
      return { findOne: jest.fn(async () => state.application) };
    }
    if (entity === RoleEntity) {
      return {
        createQueryBuilder: () => createQueryBuilder(() => asRows(state.role)),
      };
    }
    if (entity === RoleTargetEntity) {
      return {
        createQueryBuilder: () => createQueryBuilder(() => state.roleTargets),
      };
    }
    if (entity === ObjectMetadataEntity) {
      return { findOne: jest.fn(async () => state.anchorObject) };
    }
    if (entity === InconnectMessagingPhoneIdentityFieldEntity) {
      return { find: jest.fn(async () => state.primaryRows) };
    }
    if (entity === FieldMetadataEntity) {
      return { find: jest.fn(async () => state.fields) };
    }
    if (entity === InconnectRecordAccessManagedObjectEntity) {
      return {
        find: jest.fn(async () => state.managedObjects),
        createQueryBuilder: () =>
          createQueryBuilder(() => state.managedObjects),
      };
    }
    if (entity === ObjectPermissionEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => state.objectPermissions),
      };
    }
    if (entity === FieldPermissionEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => state.fieldPermissions),
      };
    }
    if (entity === RolePermissionFlagEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => state.permissionFlags),
      };
    }
    if (entity === InconnectRecordAccessConfigurationEntity) {
      return {
        createQueryBuilder: () =>
          createQueryBuilder(() => asRows(state.recordAccessConfiguration)),
      };
    }
    if (entity === InconnectRecordAccessPolicyEntity) {
      return {
        createQueryBuilder: () => createQueryBuilder(() => state.policies),
      };
    }

    throw new Error(
      `Unexpected repository ${(entity as { name: string }).name}`,
    );
  };
  const manager = {
    getRepository: jest.fn(repositoryFor),
    query: jest.fn(async () => state.workspaceMembers),
  };

  return {
    state,
    validate: () =>
      new InconnectMessagingAutomationPrincipalService(
        new InconnectMessagingAutomationRecordAccessService(
          {} as never,
          {} as never,
        ),
      ).validate({ manager: manager as never, workspaceId: WORKSPACE_ID }),
  };
};

const expectReason = async (
  validate: () => ReturnType<
    InconnectMessagingAutomationPrincipalService['validate']
  >,
  reason: string,
) => {
  await expect(validate()).resolves.toEqual({ status: 'INVALID', reason });
};

describe('InconnectMessagingAutomationPrincipalService', () => {
  it('validates the exact internal principal, deny-list snapshot, and ordinary ownRecords policy', async () => {
    const { validate } = buildService();

    await expect(validate()).resolves.toEqual({
      status: 'VALID',
      principal: {
        workspaceId: WORKSPACE_ID,
        userId: ids.userId,
        userWorkspaceId: ids.userWorkspaceId,
        workspaceMemberId: ids.workspaceMemberId,
        roleId: ids.roleId,
        name: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
      },
    });
  });

  it('reports an absent server-owned reference as needing provisioning', async () => {
    const { state, validate } = buildService();

    state.configuration.automationUserWorkspaceId = null as never;

    await expectReason(
      validate,
      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_MISSING,
    );
  });

  it.each([
    ['missing User', (state: PrincipalState) => (state.user = null as never)],
    [
      'missing UserWorkspace',
      (state: PrincipalState) => (state.userWorkspace = null as never),
    ],
    [
      'stale cross-workspace UserWorkspace',
      (state: PrincipalState) =>
        (state.userWorkspace.workspaceId =
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    ],
    [
      'deleted WorkspaceMember',
      (state: PrincipalState) =>
        (state.workspaceMembers[0].deletedAt = new Date() as never),
    ],
    [
      'external credential',
      (state: PrincipalState) => (state.credentialCount = 1),
    ],
  ])('fails closed for %s', async (_, mutate) => {
    const { state, validate } = buildService();

    mutate(state);

    await expectReason(
      validate,
      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PRINCIPAL_INVALID,
    );
  });

  it.each([
    [
      'an editable Role',
      (state: PrincipalState) => (state.role.isEditable = true),
    ],
    [
      'unexpected global authority',
      (state: PrincipalState) => (state.role.canUpdateAllSettings = true),
    ],
    [
      'a missing RoleTarget',
      (state: PrincipalState) => (state.roleTargets = []),
    ],
    [
      'multiple conflicting RoleTargets',
      (state: PrincipalState) =>
        state.roleTargets.push({ ...state.roleTargets[0], id: POLICY_ID }),
    ],
  ])('rejects Role drift from %s', async (_, mutate) => {
    const { state, validate } = buildService();

    mutate(state);

    await expectReason(
      validate,
      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.ROLE_INVALID,
    );
  });

  it.each([
    [
      'unexpected object READ',
      (state: PrincipalState) =>
        (state.objectPermissions[0].canReadObjectRecords = true),
    ],
    [
      'unexpected object delete',
      (state: PrincipalState) =>
        (state.objectPermissions[0].canDestroyObjectRecords = true),
    ],
    [
      'an unrelated object permission',
      (state: PrincipalState) =>
        state.objectPermissions.push({
          ...state.objectPermissions[0],
          id: POLICY_ID,
          objectMetadataId: POLICY_ID,
        }),
    ],
    [
      'an unexpected writable business Field',
      (state: PrincipalState) =>
        (state.fieldPermissions.find(
          ({ fieldMetadataId }) => fieldMetadataId === BUSINESS_FIELD_ID,
        )!.canUpdateFieldValue = null),
    ],
    [
      'missing PRIMARY write authority',
      (state: PrincipalState) =>
        (state.fieldPermissions = state.fieldPermissions.filter(
          ({ fieldMetadataId }) => fieldMetadataId !== PRIMARY_FIELD_ID,
        )),
    ],
    [
      'missing Owner write authority',
      (state: PrincipalState) =>
        (state.fieldPermissions = state.fieldPermissions.filter(
          ({ fieldMetadataId }) => fieldMetadataId !== OWNER_FIELD_ID,
        )),
    ],
    [
      'a newly added Field without an explicit deny',
      (state: PrincipalState) =>
        state.fields.push({
          id: POLICY_ID,
          objectMetadataId: ANCHOR_ID,
          workspaceId: WORKSPACE_ID,
          universalIdentifier: POLICY_ID,
        }),
    ],
    [
      'a changed PRIMARY',
      (state: PrincipalState) =>
        (state.primaryRows[0].fieldMetadataId = BUSINESS_FIELD_ID),
    ],
    [
      'a changed anchor',
      (state: PrincipalState) => {
        state.configuration.anchorObjectMetadataId = POLICY_ID;
        state.anchorObject.id = POLICY_ID;
      },
    ],
  ])('rejects permission drift from %s', async (_, mutate) => {
    const { state, validate } = buildService();

    mutate(state);

    await expectReason(
      validate,
      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.PERMISSIONS_INVALID,
    );
  });

  it.each([
    ['missing policy', (state: PrincipalState) => (state.policies = [])],
    [
      'changed policy',
      (state: PrincipalState) =>
        (state.policies[0].recordEffect = 'allRecords'),
    ],
  ])('rejects Record Access drift from %s', async (_, mutate) => {
    const { state, validate } = buildService();

    mutate(state);

    await expectReason(
      validate,
      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_VALIDATION_REASON.RECORD_ACCESS_POLICY_INVALID,
    );
  });
});
