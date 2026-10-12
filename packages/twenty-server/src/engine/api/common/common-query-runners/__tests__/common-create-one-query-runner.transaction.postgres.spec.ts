import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  FieldMetadataType,
  ObjectOpenRecordIn,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';
import { DataSource, EntitySchema } from 'typeorm';

import { DataArgProcessorService } from 'src/engine/api/common/common-args-processors/data-arg-processor/data-arg-processor.service';
import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import { CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { withWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { computeEventName } from 'src/engine/workspace-event-emitter/utils/compute-event-name';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { RolePermissionFlagEntity } from 'src/engine/metadata-modules/role-permission-flag/role-permission-flag.entity';
import {
  getInconnectMessagingAutomationPrincipalIds,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import {
  type InconnectMessagingAutoCreateAuthority,
  type InconnectMessagingAutoCreateAuthorityPlan,
  InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutomationRecordCreateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-create.service';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingOutboxEventEntity } from 'src/modules/inconnect-messaging/entities/outbox-event.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingInboundAutoLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-inbound-auto-link.service';
import { InconnectMessagingBackgroundPhoneIdentityResolverService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';
import { InconnectMessagingAutoCreateEligibilityService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { InconnectMessagingAutomationRecordAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-access.service';
import { InconnectMessagingAutomationPrincipalProvisioningService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal-provisioning.service';
import { InconnectMessagingProvisionAutomationPrincipalCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-provision-automation-principal.command';
import { InconnectMessagingAutoCreateConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-configuration.service';
import { InconnectMessagingOutboxService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-outbox.service';
import { ActorFromAuthContextService } from 'src/engine/core-modules/actor/services/actor-from-auth-context.service';
import { CreatedByCreateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-one.pre-query-hook';
import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const USER_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const ROLE_ID = '55555555-5555-4555-8555-555555555555';
const OBJECT_ID = '66666666-6666-4666-8666-666666666666';
const ID_FIELD_ID = '77777777-7777-4777-8777-777777777777';
const NAME_FIELD_ID = '88888888-8888-4888-8888-888888888888';
const HOOK_INJECTED_FIELD_ID = '99999999-9999-4999-8999-999999999999';
const STATUS_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const POSITION_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const CREATED_AT_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const UPDATED_AT_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const PHONE_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const OWNER_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const WORKSPACE_MEMBER_OBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const WORKSPACE_MEMBER_ID_FIELD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
const SUPERVISOR_WORKSPACE_MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORKSPACE_SCHEMA = 'workspace_transactional_create';
const OBJECT_NAME = 'transactionalContact';
const TABLE_NAME = '_transactionalContact';
const WORKSPACE_MEMBER_TABLE_NAME = 'workspaceMember';
const CONVERSATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MESSAGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INITIAL_OUTBOX_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const APPLICATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const APPLICATION_UNIVERSAL_IDENTIFIER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
const WORKSPACE_MEMBER_OBJECT_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.workspaceMember.universalIdentifier;
const OWNER_ROLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECORD_ACCESS_MANAGED_OBJECT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
const RECORD_ACCESS_POLICY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6';
const PHONE_IDENTITY_FIELD_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7';
const CREATED_BY_FIELD_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8';
const UPDATED_BY_FIELD_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9';
const AUTOMATION_PRINCIPAL_IDS =
  getInconnectMessagingAutomationPrincipalIds(WORKSPACE_ID);

const disposableDatabaseName =
  process.env.TWENTY_TRANSACTIONAL_CREATE_POSTGRES_TEST_DATABASE;
const describeWithDisposablePostgres = disposableDatabaseName
  ? describe
  : describe.skip;

jest.useRealTimers();
jest.setTimeout(30_000);

const getDisposableDatabaseUrl = (): string => {
  const normalDatabaseUrl = process.env.PG_DATABASE_URL;

  if (
    normalDatabaseUrl === undefined ||
    disposableDatabaseName === undefined ||
    !disposableDatabaseName.startsWith(
      'twenty_transactional_create_validation_',
    )
  ) {
    throw new Error(
      'A named transactional-create disposable database is required',
    );
  }

  const url = new URL(normalDatabaseUrl);

  url.pathname = `/${disposableDatabaseName}`;

  return url.toString();
};

const transactionalContactSchema = new EntitySchema<{
  id: string;
  name: string;
  hookInjected: string;
  status: string;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  phonePrimaryPhoneNumber: string | null;
  phonePrimaryPhoneCountryCode: string | null;
  phonePrimaryPhoneCallingCode: string | null;
  phoneAdditionalPhones: object[] | null;
  ownerId: string;
  createdBySource: string;
  createdByWorkspaceMemberId: string | null;
  createdByName: string;
  createdByContext: object;
  updatedBySource: string;
  updatedByWorkspaceMemberId: string | null;
  updatedByName: string;
  updatedByContext: object;
}>({
  name: OBJECT_NAME,
  tableName: TABLE_NAME,
  schema: WORKSPACE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    hookInjected: { type: String },
    status: { type: String },
    position: { type: 'bigint' },
    createdAt: { type: 'timestamptz', createDate: true },
    updatedAt: { type: 'timestamptz', updateDate: true },
    deletedAt: { type: 'timestamptz', nullable: true },
    phonePrimaryPhoneNumber: { type: String, nullable: true },
    phonePrimaryPhoneCountryCode: { type: String, nullable: true },
    phonePrimaryPhoneCallingCode: { type: String, nullable: true },
    phoneAdditionalPhones: { type: 'jsonb', nullable: true },
    ownerId: { type: 'uuid' },
    createdBySource: { type: String, default: 'MANUAL' },
    createdByWorkspaceMemberId: { type: 'uuid', nullable: true },
    createdByName: { type: String, default: '' },
    createdByContext: { type: 'jsonb', default: {} },
    updatedBySource: { type: String, default: 'MANUAL' },
    updatedByWorkspaceMemberId: { type: 'uuid', nullable: true },
    updatedByName: { type: String, default: '' },
    updatedByContext: { type: 'jsonb', default: {} },
  },
});

const workspaceMemberSchema = new EntitySchema({
  name: 'workspaceMember',
  tableName: WORKSPACE_MEMBER_TABLE_NAME,
  schema: WORKSPACE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true },
    userId: { type: 'uuid', nullable: true },
    nameFirstName: { type: String, default: '' },
    nameLastName: { type: String, default: '' },
    colorScheme: { type: String, default: 'System' },
    openRecordIn: { type: String, default: 'SIDE_PANEL' },
    userEmail: { type: String, nullable: true },
    avatarUrl: { type: String, nullable: true },
    locale: { type: String, default: 'en' },
    createdAt: { type: 'timestamptz', createDate: true },
    updatedAt: { type: 'timestamptz', updateDate: true },
    deletedAt: { type: 'timestamptz', nullable: true },
  },
});

const coreEntitySchemas = [
  new EntitySchema({
    name: 'F13Workspace',
    target: WorkspaceEntity,
    tableName: 'workspace',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      displayName: { type: String },
      databaseSchema: { type: String },
      workspaceCustomApplicationId: { type: 'uuid' },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
      deletedAt: { type: 'timestamptz', nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13User',
    target: UserEntity,
    tableName: 'user',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      firstName: { type: String },
      lastName: { type: String },
      email: { type: String, unique: true },
      passwordHash: { type: String, nullable: true },
      isEmailVerified: { type: Boolean, default: false },
      disabled: { type: Boolean, default: false },
      canImpersonate: { type: Boolean, default: false },
      canAccessFullAdminPanel: { type: Boolean, default: false },
      locale: { type: String, default: 'en' },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
      deletedAt: { type: 'timestamptz', nullable: true },
    },
  }),
  new EntitySchema<UserWorkspaceEntity>({
    name: 'F13UserWorkspace',
    target: UserWorkspaceEntity,
    tableName: 'userWorkspace',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      userId: { type: 'uuid' },
      workspaceId: { type: 'uuid' },
      defaultAvatarUrl: { type: String, nullable: true },
      locale: { type: String, default: 'en' },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
      deletedAt: { type: 'timestamptz', nullable: true },
    },
    relations: {
      user: {
        type: 'many-to-one',
        target: () => UserEntity,
        joinColumn: { name: 'userId' },
        createForeignKeyConstraints: false,
      },
      workspace: {
        type: 'many-to-one',
        target: () => WorkspaceEntity,
        joinColumn: { name: 'workspaceId' },
        createForeignKeyConstraints: false,
      },
    },
  }),
  new EntitySchema({
    name: 'F13Application',
    target: ApplicationEntity,
    tableName: 'application',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
      deletedAt: { type: 'timestamptz', nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13AppToken',
    target: AppTokenEntity,
    tableName: 'appToken',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      userId: { type: 'uuid', nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13ObjectMetadata',
    target: ObjectMetadataEntity,
    tableName: 'objectMetadata',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      nameSingular: { type: String },
      labelSingular: { type: String },
      isActive: { type: Boolean, default: true },
      isRemote: { type: Boolean, default: false },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13FieldMetadata',
    target: FieldMetadataEntity,
    tableName: 'fieldMetadata',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      objectMetadataId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      name: { type: String },
      label: { type: String },
      type: { type: String },
      isActive: { type: Boolean, default: true },
      isNullable: { type: Boolean, nullable: true },
      isSystem: { type: Boolean, default: false },
      isSystemSideEffect: { type: Boolean, default: false },
      isUIEditable: { type: Boolean, default: true },
      defaultValue: { type: 'jsonb', nullable: true },
      settings: { type: 'jsonb', nullable: true },
      relationTargetObjectMetadataId: { type: 'uuid', nullable: true },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13Role',
    target: RoleEntity,
    tableName: 'role',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      label: { type: String },
      description: { type: String, nullable: true },
      icon: { type: String, nullable: true },
      isEditable: { type: Boolean, default: true },
      canBeAssignedToUsers: { type: Boolean, default: true },
      canBeAssignedToAgents: { type: Boolean, default: true },
      canBeAssignedToApiKeys: { type: Boolean, default: true },
      canUpdateAllSettings: { type: Boolean, default: false },
      canAccessAllTools: { type: Boolean, default: false },
      canReadAllObjectRecords: { type: Boolean, default: false },
      canUpdateAllObjectRecords: { type: Boolean, default: false },
      canSoftDeleteAllObjectRecords: { type: Boolean, default: false },
      canDestroyAllObjectRecords: { type: Boolean, default: false },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13RoleTarget',
    target: RoleTargetEntity,
    tableName: 'roleTarget',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      roleId: { type: 'uuid' },
      userWorkspaceId: { type: 'uuid', nullable: true },
      agentId: { type: 'uuid', nullable: true },
      apiKeyId: { type: 'uuid', nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13ObjectPermission',
    target: ObjectPermissionEntity,
    tableName: 'objectPermission',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      roleId: { type: 'uuid' },
      objectMetadataId: { type: 'uuid' },
      canReadObjectRecords: { type: Boolean },
      canUpdateObjectRecords: { type: Boolean },
      canSoftDeleteObjectRecords: { type: Boolean },
      canDestroyObjectRecords: { type: Boolean },
    },
  }),
  new EntitySchema({
    name: 'F13FieldPermission',
    target: FieldPermissionEntity,
    tableName: 'fieldPermission',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      applicationId: { type: 'uuid' },
      universalIdentifier: { type: 'uuid' },
      roleId: { type: 'uuid' },
      objectMetadataId: { type: 'uuid' },
      fieldMetadataId: { type: 'uuid' },
      canReadFieldValue: { type: Boolean, nullable: true },
      canUpdateFieldValue: { type: Boolean, nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13RolePermissionFlag',
    target: RolePermissionFlagEntity,
    tableName: 'rolePermissionFlag',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      roleId: { type: 'uuid' },
      permissionFlag: { type: String },
    },
  }),
  new EntitySchema({
    name: 'F13RecordAccessConfiguration',
    target: InconnectRecordAccessConfigurationEntity,
    tableName: 'inconnectRecordAccessConfiguration',
    schema: 'core',
    columns: {
      workspaceId: { type: 'uuid', primary: true },
      enforcementMode: { type: String },
      revision: { type: 'bigint', default: 1 },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13RecordAccessManagedObject',
    target: InconnectRecordAccessManagedObjectEntity,
    tableName: 'inconnectRecordAccessManagedObject',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      objectMetadataId: { type: 'uuid' },
      ownerFieldMetadataId: { type: 'uuid' },
      ownerRequirement: { type: String },
    },
  }),
  new EntitySchema({
    name: 'F13RecordAccessPolicy',
    target: InconnectRecordAccessPolicyEntity,
    tableName: 'inconnectRecordAccessPolicy',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      managedObjectId: { type: 'uuid' },
      roleId: { type: 'uuid' },
      principalType: { type: String },
      recordEffect: { type: String },
      createPolicy: { type: String },
      ownerTransferPolicy: { type: String },
      missingOwnerPolicy: { type: String },
      defaultOwnerRoleId: { type: 'uuid', nullable: true },
    },
  }),
  new EntitySchema({
    name: 'F13MessagingConfiguration',
    target: InconnectMessagingConfigurationEntity,
    tableName: 'inconnectMessagingConfiguration',
    schema: 'core',
    columns: {
      workspaceId: { type: 'uuid', primary: true },
      anchorObjectMetadataId: { type: 'uuid' },
      revision: { type: 'bigint', default: 0 },
      autoCreateEnabled: { type: Boolean, default: false },
      autoCreateAnchorObjectMetadataId: { type: 'uuid', nullable: true },
      autoCreateOwnerStrategy: { type: String, nullable: true },
      autoCreateOwnerRoleId: { type: 'uuid', nullable: true },
      autoCreateLabelPolicy: { type: String, nullable: true },
      automationUserWorkspaceId: { type: 'uuid', nullable: true },
      workStateTrackingBaselineAt: {
        type: 'timestamptz',
        default: () => 'CURRENT_TIMESTAMP',
      },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13PhoneIdentityField',
    target: InconnectMessagingPhoneIdentityFieldEntity,
    tableName: 'inconnectMessagingPhoneIdentityField',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      objectMetadataId: { type: 'uuid' },
      fieldMetadataId: { type: 'uuid' },
      role: { type: String },
      ordinal: { type: Number },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13Conversation',
    target: InconnectMessagingConversationEntity,
    tableName: 'inconnectMessagingConversation',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      externalAddressNormalized: { type: String },
      linkedRecordObjectMetadataId: { type: 'uuid', nullable: true },
      linkedRecordId: { type: 'uuid', nullable: true },
      lastInboundAt: { type: 'timestamptz', nullable: true },
      pendingAt: { type: 'timestamptz', nullable: true },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13Message',
    target: InconnectMessagingMessageEntity,
    tableName: 'inconnectMessagingMessage',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      conversationId: { type: 'uuid' },
      direction: { type: String },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema({
    name: 'F13OutboxEvent',
    target: InconnectMessagingOutboxEventEntity,
    tableName: 'inconnectMessagingOutboxEvent',
    schema: 'core',
    columns: {
      id: { type: 'uuid', primary: true },
      workspaceId: { type: 'uuid' },
      aggregateType: { type: String },
      aggregateId: { type: 'uuid' },
      eventType: { type: String },
      immutablePayload: { type: 'jsonb' },
      deduplicationKey: { type: String, unique: true },
      availableAt: {
        type: 'timestamptz',
        default: () => 'CURRENT_TIMESTAMP',
      },
      processingState: { type: String, default: 'PENDING' },
      leaseToken: { type: 'uuid', nullable: true },
      leaseExpiresAt: { type: 'timestamptz', nullable: true },
      attemptCount: { type: Number, default: 0 },
      error: { type: 'jsonb', nullable: true },
      publishedAt: { type: 'timestamptz', nullable: true },
      createdAt: { type: 'timestamptz', createDate: true },
      updatedAt: { type: 'timestamptz', updateDate: true },
    },
  }),
  workspaceMemberSchema,
];

const buildFlatFieldMetadata = ({
  id,
  name,
  type,
  isNullable = false,
  isSystem = false,
  isSystemSideEffect = false,
  isUIEditable = true,
  defaultValue = null,
  settings = null,
  relationTargetObjectMetadataId = null,
}: {
  id: string;
  name: string;
  type: FieldMetadataType;
  isNullable?: boolean;
  isSystem?: boolean;
  isSystemSideEffect?: boolean;
  isUIEditable?: boolean;
  defaultValue?: FlatFieldMetadata['defaultValue'];
  settings?: FlatFieldMetadata['settings'];
  relationTargetObjectMetadataId?: string | null;
}): FlatFieldMetadata =>
  ({
    id,
    universalIdentifier: id,
    workspaceId: WORKSPACE_ID,
    objectMetadataId: OBJECT_ID,
    objectMetadataUniversalIdentifier: OBJECT_ID,
    applicationId: 'transactional-create-test-application',
    applicationUniversalIdentifier: 'transactional-create-test-application',
    name,
    label: name,
    type,
    isNullable,
    isSystem: name === 'id' || isSystem,
    isSystemSideEffect,
    isActive: true,
    isUnique: name === 'id',
    isUIEditable: name !== 'id' && isUIEditable,
    isLabelSyncedWithName: false,
    defaultValue,
    description: null,
    icon: null,
    options: null,
    settings,
    overrides: null,
    universalSettings: null,
    relationTargetFieldMetadataId: null,
    relationTargetObjectMetadataId,
    relationTargetFieldMetadataUniversalIdentifier: null,
    relationTargetObjectMetadataUniversalIdentifier: null,
    morphId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    viewFieldIds: [],
    viewFilterIds: [],
    fieldPermissionIds: [],
    kanbanAggregateOperationViewIds: [],
    calendarViewIds: [],
    calendarEndViewIds: [],
    mainGroupByFieldMetadataViewIds: [],
    viewSortIds: [],
    searchFieldMetadataIds: [],
    viewFieldUniversalIdentifiers: [],
    viewFilterUniversalIdentifiers: [],
    fieldPermissionUniversalIdentifiers: [],
    kanbanAggregateOperationViewUniversalIdentifiers: [],
    calendarViewUniversalIdentifiers: [],
    calendarEndViewUniversalIdentifiers: [],
    mainGroupByFieldMetadataViewUniversalIdentifiers: [],
    viewSortUniversalIdentifiers: [],
    searchFieldMetadataUniversalIdentifiers: [],
  }) as FlatFieldMetadata;

const idFieldMetadata = buildFlatFieldMetadata({
  id: ID_FIELD_ID,
  name: 'id',
  type: FieldMetadataType.UUID,
});
const workspaceMemberIdFieldMetadata = {
  ...idFieldMetadata,
  id: WORKSPACE_MEMBER_ID_FIELD_ID,
  universalIdentifier: WORKSPACE_MEMBER_ID_FIELD_ID,
  objectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
  objectMetadataUniversalIdentifier: WORKSPACE_MEMBER_OBJECT_ID,
} as FlatFieldMetadata;
const nameFieldMetadata = buildFlatFieldMetadata({
  id: NAME_FIELD_ID,
  name: 'name',
  type: FieldMetadataType.TEXT,
  defaultValue: "'Automation contact'",
});
const hookInjectedFieldMetadata = buildFlatFieldMetadata({
  id: HOOK_INJECTED_FIELD_ID,
  name: 'hookInjected',
  type: FieldMetadataType.TEXT,
  defaultValue: "'NOT_HOOKED'",
});
const statusFieldMetadata = buildFlatFieldMetadata({
  id: STATUS_FIELD_ID,
  name: 'status',
  type: FieldMetadataType.TEXT,
  defaultValue: "'NEW'",
});
const positionFieldMetadata = buildFlatFieldMetadata({
  id: POSITION_FIELD_ID,
  name: 'position',
  type: FieldMetadataType.POSITION,
  isSystem: true,
  isSystemSideEffect: true,
  isUIEditable: false,
  defaultValue: 0,
});
const createdAtFieldMetadata = buildFlatFieldMetadata({
  id: CREATED_AT_FIELD_ID,
  name: 'createdAt',
  type: FieldMetadataType.DATE_TIME,
  isSystem: true,
});
const updatedAtFieldMetadata = buildFlatFieldMetadata({
  id: UPDATED_AT_FIELD_ID,
  name: 'updatedAt',
  type: FieldMetadataType.DATE_TIME,
  isSystem: true,
});
const phoneFieldMetadata = buildFlatFieldMetadata({
  id: PHONE_FIELD_ID,
  name: 'phone',
  type: FieldMetadataType.PHONES,
  isNullable: true,
});
const ownerFieldMetadata = buildFlatFieldMetadata({
  id: OWNER_FIELD_ID,
  name: 'owner',
  type: FieldMetadataType.RELATION,
  settings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: RelationOnDeleteAction.SET_NULL,
    joinColumnName: 'ownerId',
  },
  relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
});
const createdByFieldMetadata = buildFlatFieldMetadata({
  id: CREATED_BY_FIELD_ID,
  name: 'createdBy',
  type: FieldMetadataType.ACTOR,
  isSystem: true,
  isSystemSideEffect: true,
  isUIEditable: false,
  defaultValue: { name: "''", source: "'MANUAL'" },
});
const updatedByFieldMetadata = buildFlatFieldMetadata({
  id: UPDATED_BY_FIELD_ID,
  name: 'updatedBy',
  type: FieldMetadataType.ACTOR,
  isSystem: true,
  isSystemSideEffect: true,
  isUIEditable: false,
  defaultValue: { name: "''", source: "'MANUAL'" },
});

const flatObjectMetadata = {
  id: OBJECT_ID,
  universalIdentifier: OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  applicationId: 'transactional-create-test-application',
  applicationUniversalIdentifier: 'transactional-create-test-application',
  nameSingular: OBJECT_NAME,
  namePlural: `${OBJECT_NAME}s`,
  labelSingular: 'Transactional contact',
  labelPlural: 'Transactional contacts',
  targetTableName: TABLE_NAME,
  isSystem: false,
  isActive: true,
  isRemote: false,
  isAuditLogged: false,
  isSearchable: false,
  isLabelSyncedWithName: false,
  isUIEditable: true,
  isUICreatable: true,
  openRecordIn: ObjectOpenRecordIn.USER_CHOICE,
  fieldIds: [
    ID_FIELD_ID,
    NAME_FIELD_ID,
    HOOK_INJECTED_FIELD_ID,
    STATUS_FIELD_ID,
    POSITION_FIELD_ID,
    CREATED_AT_FIELD_ID,
    UPDATED_AT_FIELD_ID,
    PHONE_FIELD_ID,
    OWNER_FIELD_ID,
    CREATED_BY_FIELD_ID,
    UPDATED_BY_FIELD_ID,
  ],
  fieldUniversalIdentifiers: [
    ID_FIELD_ID,
    NAME_FIELD_ID,
    HOOK_INJECTED_FIELD_ID,
    STATUS_FIELD_ID,
    POSITION_FIELD_ID,
    CREATED_AT_FIELD_ID,
    UPDATED_AT_FIELD_ID,
    PHONE_FIELD_ID,
    OWNER_FIELD_ID,
    CREATED_BY_FIELD_ID,
    UPDATED_BY_FIELD_ID,
  ],
  indexMetadataIds: [],
  indexMetadataUniversalIdentifiers: [],
  searchFieldMetadataIds: [],
  searchFieldMetadataUniversalIdentifiers: [],
  objectPermissionIds: [],
  objectPermissionUniversalIdentifiers: [],
  fieldPermissionIds: [],
  fieldPermissionUniversalIdentifiers: [],
  viewIds: [],
  viewUniversalIdentifiers: [],
  color: null,
  icon: null,
  description: null,
  shortcut: null,
  overrides: null,
  duplicateCriteria: null,
  labelIdentifierFieldMetadataId: NAME_FIELD_ID,
  labelIdentifierFieldMetadataUniversalIdentifier: NAME_FIELD_ID,
  imageIdentifierFieldMetadataId: null,
  imageIdentifierFieldMetadataUniversalIdentifier: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
} as FlatObjectMetadata;

const workspaceMemberObjectMetadata = {
  ...flatObjectMetadata,
  id: WORKSPACE_MEMBER_OBJECT_ID,
  universalIdentifier: WORKSPACE_MEMBER_OBJECT_ID,
  nameSingular: 'workspaceMember',
  namePlural: 'workspaceMembers',
  targetTableName: WORKSPACE_MEMBER_TABLE_NAME,
  fieldIds: [WORKSPACE_MEMBER_ID_FIELD_ID],
  fieldUniversalIdentifiers: [WORKSPACE_MEMBER_ID_FIELD_ID],
  labelIdentifierFieldMetadataId: WORKSPACE_MEMBER_ID_FIELD_ID,
  labelIdentifierFieldMetadataUniversalIdentifier: WORKSPACE_MEMBER_ID_FIELD_ID,
} as FlatObjectMetadata;

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: {
    [OBJECT_ID]: flatObjectMetadata,
    [WORKSPACE_MEMBER_OBJECT_ID]: workspaceMemberObjectMetadata,
  },
  universalIdentifierById: {
    [OBJECT_ID]: OBJECT_ID,
    [WORKSPACE_MEMBER_OBJECT_ID]: WORKSPACE_MEMBER_OBJECT_ID,
  },
  universalIdentifiersByApplicationId: {},
};
const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: {
    [ID_FIELD_ID]: idFieldMetadata,
    [NAME_FIELD_ID]: nameFieldMetadata,
    [HOOK_INJECTED_FIELD_ID]: hookInjectedFieldMetadata,
    [STATUS_FIELD_ID]: statusFieldMetadata,
    [POSITION_FIELD_ID]: positionFieldMetadata,
    [CREATED_AT_FIELD_ID]: createdAtFieldMetadata,
    [UPDATED_AT_FIELD_ID]: updatedAtFieldMetadata,
    [PHONE_FIELD_ID]: phoneFieldMetadata,
    [OWNER_FIELD_ID]: ownerFieldMetadata,
    [CREATED_BY_FIELD_ID]: createdByFieldMetadata,
    [UPDATED_BY_FIELD_ID]: updatedByFieldMetadata,
    [WORKSPACE_MEMBER_ID_FIELD_ID]: workspaceMemberIdFieldMetadata,
  },
  universalIdentifierById: {
    [ID_FIELD_ID]: ID_FIELD_ID,
    [NAME_FIELD_ID]: NAME_FIELD_ID,
    [HOOK_INJECTED_FIELD_ID]: HOOK_INJECTED_FIELD_ID,
    [STATUS_FIELD_ID]: STATUS_FIELD_ID,
    [POSITION_FIELD_ID]: POSITION_FIELD_ID,
    [CREATED_AT_FIELD_ID]: CREATED_AT_FIELD_ID,
    [UPDATED_AT_FIELD_ID]: UPDATED_AT_FIELD_ID,
    [PHONE_FIELD_ID]: PHONE_FIELD_ID,
    [OWNER_FIELD_ID]: OWNER_FIELD_ID,
    [CREATED_BY_FIELD_ID]: CREATED_BY_FIELD_ID,
    [UPDATED_BY_FIELD_ID]: UPDATED_BY_FIELD_ID,
    [WORKSPACE_MEMBER_ID_FIELD_ID]: WORKSPACE_MEMBER_ID_FIELD_ID,
  },
  universalIdentifiersByApplicationId: {},
};
const emptyFlatEntityMaps = () => ({
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
});

describeWithDisposablePostgres(
  'CommonCreateOneQueryRunner caller-owned PostgreSQL transaction',
  () => {
    let coreDataSource: DataSource;
    let workspaceDataSource: GlobalWorkspaceDataSource;
    let eventEmitter: EventEmitter2;
    let eventEmitterSpy: jest.SpyInstance;
    let createOneRunner: CommonCreateOneQueryRunnerService;
    let createManyRunner: CommonCreateManyQueryRunnerService;
    let queryRunnerContext: CommonBaseQueryRunnerContext;
    let canReadObjectRecords = true;
    let fetchUpsertedRecordsSpy: jest.SpyInstance;
    let processNestedRelationsIfNeededSpy: jest.SpyInstance;
    let processRecordSpy: jest.Mock;
    let executePreQueryHooksSpy: jest.Mock;
    let executePostQueryHooksSpy: jest.Mock;
    let inconnectRecordAccessPolicy: InconnectRecordAccessWorkspacePolicy = {
      status: 'not-configured',
    };

    const authContext = {
      type: 'user',
      user: { id: USER_ID },
      workspace: { id: WORKSPACE_ID },
      workspaceMemberId: WORKSPACE_MEMBER_ID,
      workspaceMember: {
        id: WORKSPACE_MEMBER_ID,
        name: { firstName: 'Transaction', lastName: 'Tester' },
      },
      userWorkspaceId: USER_WORKSPACE_ID,
    } as unknown as WorkspaceAuthContext;

    const buildObjectPermissions = ({
      readAllowed = canReadObjectRecords,
      automation = false,
    }: {
      readAllowed?: boolean;
      automation?: boolean;
    } = {}) => ({
      [OBJECT_ID]: {
        canReadObjectRecords: readAllowed,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: true,
        canDestroyObjectRecords: true,
        restrictedFields: automation
          ? {
              [ID_FIELD_ID]: { canRead: true, canUpdate: false },
              [NAME_FIELD_ID]: { canRead: true, canUpdate: false },
              [HOOK_INJECTED_FIELD_ID]: {
                canRead: true,
                canUpdate: false,
              },
              [STATUS_FIELD_ID]: { canRead: true, canUpdate: false },
              [CREATED_AT_FIELD_ID]: { canRead: true, canUpdate: false },
              [UPDATED_AT_FIELD_ID]: { canRead: true, canUpdate: false },
              [CREATED_BY_FIELD_ID]: { canRead: true, canUpdate: false },
              [UPDATED_BY_FIELD_ID]: { canRead: true, canUpdate: false },
            }
          : {},
        rowLevelPermissionPredicates: [],
        rowLevelPermissionPredicateGroups: [],
      },
      [WORKSPACE_MEMBER_OBJECT_ID]: {
        canReadObjectRecords: true,
        canUpdateObjectRecords: false,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
        restrictedFields: {},
        rowLevelPermissionPredicates: [],
        rowLevelPermissionPredicateGroups: [],
      },
    });

    const buildWorkspaceContext = (
      contextAuth: WorkspaceAuthContext = authContext,
    ) => {
      const userWorkspaceId =
        'userWorkspaceId' in contextAuth
          ? contextAuth.userWorkspaceId
          : USER_WORKSPACE_ID;
      const isAutomation =
        userWorkspaceId === AUTOMATION_PRINCIPAL_IDS.userWorkspaceId;
      const effectiveRoleId = isAutomation
        ? AUTOMATION_PRINCIPAL_IDS.roleId
        : ROLE_ID;

      return {
        authContext: contextAuth,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        flatIndexMaps: emptyFlatEntityMaps(),
        flatRowLevelPermissionPredicateMaps: emptyFlatEntityMaps(),
        flatRowLevelPermissionPredicateGroupMaps: emptyFlatEntityMaps(),
        inconnectRecordAccessPolicy,
        inconnectTeamAccessMaps: {
          version: 1,
          status: 'valid',
          membershipByWorkspaceMemberId: {},
          memberWorkspaceMemberIdsByTeamId: {},
          assignableMemberWorkspaceMemberIdsByTeamId: {},
        },
        objectIdByNameSingular: {
          [OBJECT_NAME]: OBJECT_ID,
          workspaceMember: WORKSPACE_MEMBER_OBJECT_ID,
        },
        featureFlagsMap: { IS_ORM_V2_READ_PATH_ENABLED: false },
        permissionsPerRoleId: {
          [effectiveRoleId]: buildObjectPermissions({
            automation: isAutomation,
            readAllowed: isAutomation ? false : canReadObjectRecords,
          }),
        },
        entityMetadatas: workspaceDataSource.entityMetadatas,
        userWorkspaceRoleMap: {
          [userWorkspaceId]: effectiveRoleId,
        },
        apiKeyRoleMap: {},
      };
    };

    const runCreate = (
      queryRunner: WorkspaceQueryRunner,
      id: string,
      name: string,
    ) =>
      createOneRunner.executeWithQueryRunner(
        {
          data: { id, name },
          selectedFields: { id: true, name: true },
        },
        queryRunnerContext,
        queryRunner,
      );

    const runReceiptCreate = (
      queryRunner: WorkspaceQueryRunner,
      name: string,
    ) =>
      createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
        {
          data: { name },
        },
        queryRunnerContext,
        queryRunner,
      );

    const buildAutomationRecordCreateHarness =
      (providedCoreQueryBuilderService?: {
        createCoreQueryBuilder: (input: {
          queryRunner: WorkspaceQueryRunner;
          target: unknown;
          alias: string;
        }) => unknown;
      }) => {
        const authority = Object.freeze(
          {},
        ) as InconnectMessagingAutoCreateAuthority;
        const plan: InconnectMessagingAutoCreateAuthorityPlan = Object.freeze({
          workspaceId: WORKSPACE_ID,
          objectMetadataId: OBJECT_ID,
          objectMetadataNameSingular: OBJECT_NAME,
          configurationRevision: '1',
          configurationUpdatedAt: '2026-10-07T00:00:00.000Z',
          primaryPhoneIdentityFieldId: PHONE_FIELD_ID,
          primaryPhoneFieldMetadataId: PHONE_FIELD_ID,
          primaryPhoneFieldName: 'phone',
          ownerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
          ownerRoleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          ownerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
          ownerFieldMetadataId: OWNER_FIELD_ID,
          ownerFieldName: 'owner',
          ownerJoinColumnName: 'ownerId',
          allowedFieldMetadataIds: Object.freeze([
            PHONE_FIELD_ID,
            OWNER_FIELD_ID,
          ]),
          automationUserId: USER_ID,
          automationUserWorkspaceId: USER_WORKSPACE_ID,
          automationWorkspaceMemberId: WORKSPACE_MEMBER_ID,
          automationRoleId: ROLE_ID,
          automationPrincipalName: `${INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME} ${INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME}`,
        });
        const userWorkspace = {
          id: USER_WORKSPACE_ID,
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          deletedAt: null,
          user: {
            id: USER_ID,
            firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
            lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
            email: 'automation@internal.invalid',
            isEmailVerified: false,
            disabled: false,
            canImpersonate: false,
            canAccessFullAdminPanel: false,
            locale: 'en',
            createdAt: new Date('2026-10-07T00:00:00.000Z'),
            updatedAt: new Date('2026-10-07T00:00:00.000Z'),
            deletedAt: null,
          },
          workspace: {
            id: WORKSPACE_ID,
            displayName: 'F13 physical fixture',
            databaseSchema: WORKSPACE_SCHEMA,
            createdAt: new Date('2026-10-07T00:00:00.000Z'),
            updatedAt: new Date('2026-10-07T00:00:00.000Z'),
            deletedAt: null,
          },
        };
        const userWorkspaceQueryBuilder = {
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(userWorkspace),
        };
        const defaultCoreQueryBuilderService = {
          createCoreQueryBuilder: jest
            .fn()
            .mockReturnValue(userWorkspaceQueryBuilder),
        };
        const coreQueryBuilderService =
          providedCoreQueryBuilderService ?? defaultCoreQueryBuilderService;
        const authorityService = {
          issueAuthority: jest.fn().mockResolvedValue(authority),
          resolveCreatePlan: jest.fn().mockResolvedValue(plan),
          revalidateCreatePlan: jest.fn().mockResolvedValue(plan),
          assertCreateScope: jest.fn().mockResolvedValue(plan),
        } as unknown as InconnectMessagingAutoCreateAuthorityService;
        const automationPrincipalService = {
          validate: jest.fn().mockResolvedValue({
            status: 'VALID',
            principal: {
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              userWorkspaceId: USER_WORKSPACE_ID,
              workspaceMemberId: WORKSPACE_MEMBER_ID,
              roleId: ROLE_ID,
              name: plan.automationPrincipalName,
            },
          }),
        } as unknown as InconnectMessagingAutomationPrincipalService;
        const workspaceCacheService = {
          getOrRecompute: jest.fn().mockResolvedValue({
            flatWorkspaceMemberMaps: {
              byId: {
                [WORKSPACE_MEMBER_ID]: {
                  id: WORKSPACE_MEMBER_ID,
                  userId: USER_ID,
                  name: {
                    firstName:
                      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
                    lastName:
                      INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
                  },
                  deletedAt: null,
                },
              },
              idByUserId: { [USER_ID]: WORKSPACE_MEMBER_ID },
            },
            flatObjectMetadataMaps,
            flatFieldMetadataMaps,
            flatIndexMaps: emptyFlatEntityMaps(),
          }),
        } as unknown as WorkspaceCacheService;

        return {
          authority,
          authorityService,
          service: new InconnectMessagingAutomationRecordCreateService(
            coreQueryBuilderService as never,
            authorityService,
            automationPrincipalService,
            workspaceCacheService,
            createOneRunner,
          ),
        };
      };

    const buildRealInboundCompositionHarness = ({
      failOutboxInsert = false,
    }: {
      failOutboxInsert?: boolean;
    } = {}) => {
      const transactionIdentities: Array<{ pid: number; txid: string }> = [];
      const automationUserWorkspace = {
        id: USER_WORKSPACE_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        deletedAt: null,
        user: {
          id: USER_ID,
          firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
          lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
          email: 'automation@internal.invalid',
          isEmailVerified: false,
          disabled: false,
          canImpersonate: false,
          canAccessFullAdminPanel: false,
          locale: 'en',
          createdAt: new Date('2026-10-07T00:00:00.000Z'),
          updatedAt: new Date('2026-10-07T00:00:00.000Z'),
          deletedAt: null,
        },
        workspace: {
          id: WORKSPACE_ID,
          displayName: 'F13 physical fixture',
          databaseSchema: WORKSPACE_SCHEMA,
          createdAt: new Date('2026-10-07T00:00:00.000Z'),
          updatedAt: new Date('2026-10-07T00:00:00.000Z'),
          deletedAt: null,
        },
      };
      const coreQueryBuilderService = {
        createCoreQueryBuilder: ({
          queryRunner,
          target,
        }: {
          queryRunner: WorkspaceQueryRunner;
          target: unknown;
        }) => {
          const parameters: Record<string, unknown> = {};
          let lockMode: 'pessimistic_read' | 'pessimistic_write' | undefined;
          let operation: 'select' | 'update' | 'insert' = 'select';
          let writeValues: Record<string, unknown> = {};
          const builder = {
            select: jest.fn().mockReturnThis(),
            innerJoinAndSelect: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockImplementation((mode) => {
              lockMode = mode;

              return builder;
            }),
            where: jest.fn().mockImplementation((_sql, next = {}) => {
              Object.assign(parameters, next);

              return builder;
            }),
            andWhere: jest.fn().mockImplementation((_sql, next = {}) => {
              Object.assign(parameters, next);

              return builder;
            }),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            update: jest.fn().mockImplementation(() => {
              operation = 'update';

              return builder;
            }),
            set: jest.fn().mockImplementation((nextValues) => {
              writeValues = nextValues;

              return builder;
            }),
            insert: jest.fn().mockImplementation(() => {
              operation = 'insert';

              return builder;
            }),
            into: jest.fn().mockReturnThis(),
            values: jest.fn().mockImplementation((nextValues) => {
              writeValues = nextValues;

              return builder;
            }),
            updateEntity: jest.fn().mockReturnThis(),
            getOne: jest.fn(async () => {
              const [identity] = (await queryRunner.query(
                'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
              )) as Array<{ pid: number; txid: string }>;

              transactionIdentities.push(identity);
              if (target === InconnectMessagingConversationEntity) {
                const lockClause =
                  lockMode === 'pessimistic_write' ? ' FOR UPDATE' : '';
                const rows = await queryRunner.query(
                  `SELECT * FROM "core"."inconnectMessagingConversation" WHERE "id" = $1 AND "workspaceId" = $2${lockClause}`,
                  [parameters.conversationId, parameters.workspaceId],
                );

                return rows[0] ?? null;
              }
              if (target === InconnectMessagingConfigurationEntity) {
                const lockClause =
                  lockMode === 'pessimistic_read' ? ' FOR SHARE' : '';
                const rows = await queryRunner.query(
                  `SELECT * FROM "core"."inconnectMessagingConfiguration" WHERE "workspaceId" = $1${lockClause}`,
                  [parameters.workspaceId],
                );

                return rows[0] ?? null;
              }
              if (target === ObjectMetadataEntity) {
                return {
                  id: OBJECT_ID,
                  workspaceId: WORKSPACE_ID,
                };
              }
              if (target === WorkspaceEntity) {
                return {
                  id: WORKSPACE_ID,
                  databaseSchema: WORKSPACE_SCHEMA,
                };
              }
              if (target === UserWorkspaceEntity) {
                return automationUserWorkspace;
              }

              throw new Error('Unexpected F13 Core getOne target');
            }),
            getMany: jest.fn(async () => {
              const [identity] = (await queryRunner.query(
                'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
              )) as Array<{ pid: number; txid: string }>;

              transactionIdentities.push(identity);
              if (target === InconnectMessagingPhoneIdentityFieldEntity) {
                return [
                  {
                    workspaceId: WORKSPACE_ID,
                    objectMetadataId: OBJECT_ID,
                    fieldMetadataId: PHONE_FIELD_ID,
                    role: 'PRIMARY',
                    ordinal: 0,
                  },
                ];
              }
              if (target === FieldMetadataEntity) {
                return [
                  {
                    id: PHONE_FIELD_ID,
                    workspaceId: WORKSPACE_ID,
                    objectMetadataId: OBJECT_ID,
                    name: 'phone',
                    type: FieldMetadataType.PHONES,
                    isActive: true,
                  },
                ];
              }

              throw new Error('Unexpected F13 Core getMany target');
            }),
            execute: jest.fn(async () => {
              const [identity] = (await queryRunner.query(
                'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
              )) as Array<{ pid: number; txid: string }>;

              transactionIdentities.push(identity);
              if (
                operation === 'update' &&
                target === InconnectMessagingConversationEntity
              ) {
                const result = (await queryRunner.query(
                  `UPDATE "core"."inconnectMessagingConversation" SET "linkedRecordObjectMetadataId" = $1, "linkedRecordId" = $2 WHERE "id" = $3 AND "workspaceId" = $4 AND "linkedRecordObjectMetadataId" IS NULL AND "linkedRecordId" IS NULL RETURNING "id"`,
                  [
                    writeValues.linkedRecordObjectMetadataId,
                    writeValues.linkedRecordId,
                    parameters.conversationId,
                    parameters.workspaceId,
                  ],
                )) as unknown[];
                const affected =
                  typeof result[1] === 'number'
                    ? result[1]
                    : Array.isArray(result[0])
                      ? result[0].length
                      : result.length;

                return { affected };
              }
              if (
                operation === 'insert' &&
                target === InconnectMessagingOutboxEventEntity
              ) {
                if (failOutboxInsert) {
                  throw new Error('forced F13 Outbox failure');
                }
                await queryRunner.query(
                  `INSERT INTO "core"."inconnectMessagingOutboxEvent" ("id", "workspaceId", "aggregateType", "aggregateId", "eventType", "immutablePayload", "deduplicationKey") VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
                  [
                    writeValues.id,
                    writeValues.workspaceId,
                    writeValues.aggregateType,
                    writeValues.aggregateId,
                    writeValues.eventType,
                    JSON.stringify(writeValues.immutablePayload),
                    writeValues.deduplicationKey,
                  ],
                );

                return { identifiers: [{ id: writeValues.id }] };
              }

              throw new Error('Unexpected F13 Core write target');
            }),
          };

          return builder;
        },
      };
      const {
        authority,
        authorityService,
        service: automationRecordCreateService,
      } = buildAutomationRecordCreateHarness(coreQueryBuilderService as never);
      const serviceDataSource = {
        createQueryBuilder:
          coreDataSource.createQueryBuilder.bind(coreDataSource),
        getRepository: (target: unknown) => ({
          findOne: async ({ where }: { where: Record<string, unknown> }) => {
            if (target === InconnectMessagingMessageEntity) {
              const rows = await coreDataSource.query(
                `SELECT "conversationId" FROM "core"."inconnectMessagingMessage" WHERE "id" = $1 AND "workspaceId" = $2 AND "direction" = 'INBOUND'`,
                [where.id, where.workspaceId],
              );

              return rows[0] ?? null;
            }
            if (target === InconnectMessagingConversationEntity) {
              const rows = await coreDataSource.query(
                `SELECT * FROM "core"."inconnectMessagingConversation" WHERE "id" = $1 AND "workspaceId" = $2`,
                [where.id, where.workspaceId],
              );

              return rows[0] ?? null;
            }
            if (target === InconnectMessagingConfigurationEntity) {
              const rows = await coreDataSource.query(
                `SELECT * FROM "core"."inconnectMessagingConfiguration" WHERE "workspaceId" = $1`,
                [where.workspaceId],
              );

              return rows[0] ?? null;
            }

            throw new Error('Unexpected initial F13 repository target');
          },
        }),
      };
      const backgroundWorkspaceCacheService = {
        getOrRecompute: jest.fn().mockResolvedValue({
          flatObjectMetadataMaps,
        }),
      };
      const backgroundResolver =
        new InconnectMessagingBackgroundPhoneIdentityResolverService(
          serviceDataSource as never,
          backgroundWorkspaceCacheService as never,
          coreQueryBuilderService as never,
        );
      const runnerCapture: {
        queryRunner?: WorkspaceQueryRunner;
        manager?: WorkspaceQueryRunner['manager'];
      } = {};
      const transactionDataSource = {
        createQueryRunner: () => {
          const queryRunner =
            GlobalWorkspaceDataSource.prototype.createQueryRunner.call(
              workspaceDataSource,
            );

          runnerCapture.queryRunner = queryRunner;
          runnerCapture.manager = queryRunner.manager;

          return queryRunner;
        },
      };
      const globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(transactionDataSource),
      };

      return {
        authority,
        authorityService,
        coreQueryBuilderService,
        runnerCapture,
        transactionIdentities,
        service: new InconnectMessagingInboundAutoLinkService(
          serviceDataSource as never,
          globalWorkspaceOrmManager as never,
          coreQueryBuilderService as never,
          backgroundResolver,
          authorityService,
          automationRecordCreateService,
        ),
      };
    };

    const buildMonolithicRealAuthorityHarness = async () => {
      const gatewayBindings: Array<{
        manager: WorkspaceQueryRunner['manager'];
        queryRunner: WorkspaceQueryRunner;
      }> = [];
      const resolvedAuthorityPlans: InconnectMessagingAutoCreateAuthorityPlan[] =
        [];
      const backgroundResolutions: Array<{ state: string }> = [];
      const inboundResults: Array<{ state: string }> = [];
      const deliberatePayloads: Array<Record<string, unknown>> = [];
      const transactionObservations: Array<{
        stage: string;
        pid: number;
        txid: string;
        active: boolean;
        managerMatches: boolean;
      }> = [];
      const runnerCapture: {
        queryRunner?: WorkspaceQueryRunner;
        manager?: WorkspaceQueryRunner['manager'];
      } = {};
      const workspaceCacheService = {
        getOrRecompute: jest.fn().mockImplementation(async () => ({
          flatWorkspaceMemberMaps: {
            byId: {
              [AUTOMATION_PRINCIPAL_IDS.workspaceMemberId]: {
                id: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
                userId: AUTOMATION_PRINCIPAL_IDS.userId,
                name: {
                  firstName:
                    INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
                  lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
                },
                deletedAt: null,
              },
            },
            idByUserId: {
              [AUTOMATION_PRINCIPAL_IDS.userId]:
                AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
            },
          },
          flatObjectMetadataMaps,
          flatFieldMetadataMaps,
          flatIndexMaps: emptyFlatEntityMaps(),
        })),
        invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceCacheService;
      const gatewayService = new WorkspaceQueryRunnerCoreQueryBuilderService(
        coreDataSource,
        {
          getGlobalWorkspaceDataSource: () => workspaceDataSource,
        } as never,
      );
      const originalCreateCoreQueryBuilder =
        gatewayService.createCoreQueryBuilder.bind(gatewayService);

      jest
        .spyOn(gatewayService, 'createCoreQueryBuilder')
        .mockImplementation((input) => {
          const queryBuilder = originalCreateCoreQueryBuilder(input);

          gatewayBindings.push({
            manager: input.queryRunner.manager,
            queryRunner: input.queryRunner,
          });
          expect(
            (queryBuilder as unknown as { queryRunner: WorkspaceQueryRunner })
              .queryRunner,
          ).toBe(input.queryRunner);

          return queryBuilder;
        });
      const primaryValidatorService =
        new InconnectMessagingAutoCreatePrimaryValidatorService();
      const eligibilityService =
        new InconnectMessagingAutoCreateEligibilityService(
          workspaceCacheService,
        );
      const recordAccessConfigurationService = {
        replaceConfiguration: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'The physical fixture expected the exact existing automation policy',
            ),
          ),
      };
      const automationRecordAccessService =
        new InconnectMessagingAutomationRecordAccessService(
          coreDataSource,
          recordAccessConfigurationService as never,
        );
      const automationPrincipalService =
        new InconnectMessagingAutomationPrincipalService(
          automationRecordAccessService,
        );
      const provisioningWorkspaceRepository = {
        find: async () =>
          coreDataSource.query(
            `SELECT * FROM "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" WHERE "id" = $1 OR "userId" = $2`,
            [
              AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
              AUTOMATION_PRINCIPAL_IDS.userId,
            ],
          ),
        insert: async (values: {
          id: string;
          userId: string;
          userEmail: string;
          name: { firstName: string; lastName: string };
          colorScheme: string;
          openRecordIn: string;
          avatarUrl: string | null;
          locale: string;
          deletedAt: Date | null;
        }) =>
          coreDataSource.query(
            `INSERT INTO "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" ("id", "userId", "userEmail", "nameFirstName", "nameLastName", "colorScheme", "openRecordIn", "avatarUrl", "locale", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              values.id,
              values.userId,
              values.userEmail,
              values.name.firstName,
              values.name.lastName,
              values.colorScheme,
              values.openRecordIn,
              values.avatarUrl,
              values.locale,
              values.deletedAt,
            ],
          ),
        update: async (
          criteria: { id: string },
          values: {
            userId: string;
            userEmail: string;
            name: { firstName: string; lastName: string };
            colorScheme: string;
            openRecordIn: string;
            avatarUrl: string | null;
            locale: string;
            deletedAt: Date | null;
          },
        ) =>
          coreDataSource.query(
            `UPDATE "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" SET "userId" = $1, "userEmail" = $2, "nameFirstName" = $3, "nameLastName" = $4, "colorScheme" = $5, "openRecordIn" = $6, "avatarUrl" = $7, "locale" = $8, "deletedAt" = $9 WHERE "id" = $10`,
            [
              values.userId,
              values.userEmail,
              values.name.firstName,
              values.name.lastName,
              values.colorScheme,
              values.openRecordIn,
              values.avatarUrl,
              values.locale,
              values.deletedAt,
              criteria.id,
            ],
          ),
      };
      const provisioningGlobalWorkspaceOrmManager = {
        executeInWorkspaceContext: (callback: () => Promise<unknown>) =>
          callback(),
        getRepository: async () => provisioningWorkspaceRepository,
      };
      const provisioningService =
        new InconnectMessagingAutomationPrincipalProvisioningService(
          coreDataSource,
          provisioningGlobalWorkspaceOrmManager as never,
          workspaceCacheService,
          primaryValidatorService,
          automationPrincipalService,
          automationRecordAccessService,
        );
      const provisioningCommand =
        new InconnectMessagingProvisionAutomationPrincipalCommand(
          provisioningService,
        );

      await provisioningCommand.run([], { workspaceId: WORKSPACE_ID });

      const configurationService =
        new InconnectMessagingAutoCreateConfigurationService(
          coreDataSource,
          { canManageMessaging: jest.fn().mockResolvedValue(true) } as never,
          eligibilityService,
          primaryValidatorService,
          automationPrincipalService,
        );
      const readiness = await configurationService.getConfiguration({
        authContext,
      });

      if (readiness.readiness !== 'READY_FOR_RUNTIME') {
        throw new Error(
          `Unexpected real readiness: ${JSON.stringify(readiness)}`,
        );
      }
      const authorityService = new InconnectMessagingAutoCreateAuthorityService(
        gatewayService,
        eligibilityService,
        primaryValidatorService,
        automationPrincipalService,
      );
      const automationRecordCreateService =
        new InconnectMessagingAutomationRecordCreateService(
          gatewayService,
          authorityService,
          automationPrincipalService,
          workspaceCacheService,
          createOneRunner,
        );
      const backgroundResolver =
        new InconnectMessagingBackgroundPhoneIdentityResolverService(
          coreDataSource,
          workspaceCacheService,
          gatewayService,
        );
      const captureStage = async (
        stage: string,
        queryRunner: WorkspaceQueryRunner,
      ) => {
        const [identity] = (await queryRunner.query(
          'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
        )) as Array<{ pid: number; txid: string }>;

        transactionObservations.push({
          stage,
          ...identity,
          active: queryRunner.isTransactionActive,
          managerMatches:
            queryRunner === runnerCapture.queryRunner &&
            queryRunner.manager === runnerCapture.manager &&
            queryRunner.manager.queryRunner === queryRunner,
        });
      };
      const transactionDataSource = {
        createQueryRunner: () => {
          const queryRunner =
            GlobalWorkspaceDataSource.prototype.createQueryRunner.call(
              workspaceDataSource,
            ) as WorkspaceQueryRunner;
          const originalQuery = queryRunner.query.bind(queryRunner);

          runnerCapture.queryRunner = queryRunner;
          runnerCapture.manager = queryRunner.manager;
          queryRunner.query = (async (
            statement: string,
            parameters?: unknown[],
            useStructuredResult?: boolean,
          ) => {
            const result = await originalQuery(
              statement,
              parameters,
              useStructuredResult,
            );
            const normalized = String(statement);
            let stage: string | null = null;

            if (normalized.includes('pg_advisory_xact_lock')) {
              stage = 'advisory-lock';
            } else if (
              normalized.includes('inconnectMessagingConversation') &&
              normalized.includes('FOR UPDATE')
            ) {
              stage = 'conversation-for-update';
            } else if (
              normalized.startsWith('SELECT') &&
              normalized.includes(TABLE_NAME) &&
              normalized.includes('phonePrimaryPhoneNumber')
            ) {
              stage = 'background-resolver';
            } else if (
              normalized.startsWith('INSERT INTO') &&
              normalized.includes(TABLE_NAME)
            ) {
              stage = 'crm-insert';
            } else if (
              normalized.startsWith('UPDATE') &&
              normalized.includes('inconnectMessagingConversation')
            ) {
              stage = 'conversation-update';
            } else if (
              normalized.startsWith('INSERT INTO') &&
              normalized.includes('inconnectMessagingOutboxEvent')
            ) {
              stage = 'link-outbox-insert';
            }

            if (stage !== null) {
              const [identity] = (await originalQuery(
                'SELECT pg_backend_pid() AS "pid", txid_current()::text AS "txid"',
              )) as Array<{ pid: number; txid: string }>;

              transactionObservations.push({
                stage,
                ...identity,
                active: queryRunner.isTransactionActive,
                managerMatches:
                  queryRunner === runnerCapture.queryRunner &&
                  queryRunner.manager === runnerCapture.manager &&
                  queryRunner.manager.queryRunner === queryRunner,
              });
            }

            return result;
          }) as WorkspaceQueryRunner['query'];

          return queryRunner;
        },
      };
      const transactionGlobalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(transactionDataSource),
      };
      const inboundService = new InconnectMessagingInboundAutoLinkService(
        coreDataSource,
        transactionGlobalWorkspaceOrmManager as never,
        gatewayService,
        backgroundResolver,
        authorityService,
        automationRecordCreateService,
      );
      const inboundAttemptImplementation =
        inboundService.attemptForInboundMessage.bind(inboundService);

      jest
        .spyOn(inboundService, 'attemptForInboundMessage')
        .mockImplementation(async (input) => {
          const result = await inboundAttemptImplementation(input);

          inboundResults.push(result);

          return result;
        });
      const authorityIssueImplementation =
        authorityService.issueAuthority.bind(authorityService);
      const resolvePlanImplementation =
        authorityService.resolveCreatePlan.bind(authorityService);

      jest
        .spyOn(authorityService, 'resolveCreatePlan')
        .mockImplementation(async (input) => {
          const plan = await resolvePlanImplementation(input);

          resolvedAuthorityPlans.push(plan);

          return plan;
        });
      const authorityIssueSpy = jest
        .spyOn(authorityService, 'issueAuthority')
        .mockImplementation(async (input) => {
          await captureStage('real-authority', input.queryRunner);

          return authorityIssueImplementation(input);
        });
      const principalValidateImplementation =
        automationPrincipalService.validate.bind(automationPrincipalService);
      const principalValidateSpy = jest
        .spyOn(automationPrincipalService, 'validate')
        .mockImplementation(async (input) => {
          if (input.queryRunner !== undefined) {
            await captureStage('real-principal', input.queryRunner);
          }

          return principalValidateImplementation(input);
        });
      const automationCreateImplementation =
        automationRecordCreateService.execute.bind(
          automationRecordCreateService,
        );
      const automationCreateSpy = jest
        .spyOn(automationRecordCreateService, 'execute')
        .mockImplementation(async (input) => {
          await captureStage('automation-record-create', input.queryRunner);

          return automationCreateImplementation(input);
        });
      const backgroundResolveImplementation =
        backgroundResolver.resolvePhoneIdentityForLink.bind(backgroundResolver);

      jest
        .spyOn(backgroundResolver, 'resolvePhoneIdentityForLink')
        .mockImplementation(async (input) => {
          const resolution = await backgroundResolveImplementation(input);

          backgroundResolutions.push(resolution);

          return resolution;
        });
      const commonCreateImplementation =
        CommonCreateOneQueryRunnerService.prototype.executeCreateOnlyForWriteReceiptWithQueryRunner.bind(
          createOneRunner,
        );
      const commonCreateSpy = jest
        .spyOn(
          createOneRunner,
          'executeCreateOnlyForWriteReceiptWithQueryRunner',
        )
        .mockImplementation(async (args, context, queryRunner) => {
          deliberatePayloads.push(structuredClone(args.data));
          await captureStage('common-create', queryRunner);

          return commonCreateImplementation(args, context, queryRunner);
        });

      commonCreateSpy.mockClear();
      const messageQueueService = {
        add: jest.fn().mockResolvedValue(undefined),
      };
      const outboxService = new InconnectMessagingOutboxService(
        coreDataSource,
        coreDataSource.getRepository(InconnectMessagingOutboxEventEntity),
        messageQueueService as never,
        {
          findAuthorizedConversation: jest.fn(),
        } as never,
        {
          getCandidateAuthContexts: jest.fn().mockResolvedValue([]),
        } as never,
        { publishToMember: jest.fn() } as never,
        inboundService,
      );

      return {
        authorityIssueSpy,
        authorityService,
        automationCreateSpy,
        automationPrincipalService,
        automationRecordAccessService,
        automationRecordCreateService,
        backgroundResolutions,
        deliberatePayloads,
        backgroundResolver,
        commonCreateSpy,
        configurationService,
        eligibilityService,
        gatewayBindings,
        gatewayService,
        inboundService,
        inboundResults,
        messageQueueService,
        outboxService,
        primaryValidatorService,
        principalValidateSpy,
        readiness,
        resolvedAuthorityPlans,
        runnerCapture,
        transactionObservations,
      };
    };

    const seedInboundConversation = async () => {
      await coreDataSource.query(
        `INSERT INTO "core"."inconnectMessagingConfiguration" ("workspaceId", "anchorObjectMetadataId", "autoCreateEnabled") VALUES ($1, $2, true)`,
        [WORKSPACE_ID, OBJECT_ID],
      );
      await coreDataSource.query(
        `INSERT INTO "core"."inconnectMessagingConversation" ("id", "workspaceId", "externalAddressNormalized", "linkedRecordObjectMetadataId", "linkedRecordId", "lastInboundAt", "pendingAt") VALUES ($1, $2, '+525514552571', NULL, NULL, now(), now())`,
        [CONVERSATION_ID, WORKSPACE_ID],
      );
      await coreDataSource.query(
        `INSERT INTO "core"."inconnectMessagingMessage" ("id", "workspaceId", "conversationId", "direction") VALUES ($1, $2, $3, 'INBOUND')`,
        [MESSAGE_ID, WORKSPACE_ID, CONVERSATION_ID],
      );
    };

    const seedRealAuthorityMetadata = async () => {
      await coreDataSource.getRepository(WorkspaceEntity).insert({
        id: WORKSPACE_ID,
        displayName: 'F13 monolithic physical fixture',
        databaseSchema: WORKSPACE_SCHEMA,
        workspaceCustomApplicationId: APPLICATION_ID,
      });
      await coreDataSource.getRepository(ApplicationEntity).insert({
        id: APPLICATION_ID,
        workspaceId: WORKSPACE_ID,
        universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
      });
      await coreDataSource.getRepository(ObjectMetadataEntity).insert([
        {
          id: OBJECT_ID,
          workspaceId: WORKSPACE_ID,
          applicationId: APPLICATION_ID,
          universalIdentifier: OBJECT_ID,
          nameSingular: OBJECT_NAME,
          labelSingular: 'Transactional contact',
          isActive: true,
          isRemote: false,
        },
        {
          id: WORKSPACE_MEMBER_OBJECT_ID,
          workspaceId: WORKSPACE_ID,
          applicationId: APPLICATION_ID,
          universalIdentifier: WORKSPACE_MEMBER_OBJECT_UNIVERSAL_IDENTIFIER,
          nameSingular: 'workspaceMember',
          labelSingular: 'Workspace member',
          isActive: true,
          isRemote: false,
        },
      ]);
      const fixtureFields = [
        idFieldMetadata,
        nameFieldMetadata,
        hookInjectedFieldMetadata,
        statusFieldMetadata,
        positionFieldMetadata,
        createdAtFieldMetadata,
        updatedAtFieldMetadata,
        phoneFieldMetadata,
        ownerFieldMetadata,
        createdByFieldMetadata,
        updatedByFieldMetadata,
      ];

      await coreDataSource.getRepository(FieldMetadataEntity).insert(
        fixtureFields.map((field) => ({
          id: field.id,
          workspaceId: WORKSPACE_ID,
          applicationId: APPLICATION_ID,
          objectMetadataId: OBJECT_ID,
          universalIdentifier: field.universalIdentifier,
          name: field.name,
          label: field.label,
          type: field.type,
          isActive: field.isActive,
          isNullable: field.isNullable,
          isSystem: field.isSystem,
          isSystemSideEffect: field.isSystemSideEffect,
          isUIEditable: field.isUIEditable,
          defaultValue: field.defaultValue,
          settings: field.settings,
          relationTargetObjectMetadataId: field.relationTargetObjectMetadataId,
        })),
      );
      await coreDataSource.getRepository(RoleEntity).insert({
        id: OWNER_ROLE_ID,
        workspaceId: WORKSPACE_ID,
        applicationId: APPLICATION_ID,
        universalIdentifier: OWNER_ROLE_ID,
        label: 'Supervisor business owner',
        isEditable: true,
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
        canUpdateAllSettings: false,
        canAccessAllTools: false,
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
      });
      await coreDataSource.getRepository(UserEntity).insert({
        id: USER_ID,
        firstName: 'Supervisor',
        lastName: 'Owner',
        email: 'supervisor-owner@fixture.invalid',
        passwordHash: null as never,
        isEmailVerified: false,
        disabled: false,
        canImpersonate: false,
        canAccessFullAdminPanel: false,
        locale: 'en',
      });
      await coreDataSource.getRepository(UserWorkspaceEntity).insert({
        id: USER_WORKSPACE_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        defaultAvatarUrl: null as never,
        locale: 'en',
      });
      await coreDataSource.getRepository(RoleTargetEntity).insert({
        id: ROLE_ID,
        workspaceId: WORKSPACE_ID,
        applicationId: APPLICATION_ID,
        universalIdentifier: ROLE_ID,
        roleId: OWNER_ROLE_ID,
        userWorkspaceId: USER_WORKSPACE_ID,
        agentId: null,
        apiKeyId: null,
      });
      await coreDataSource.query(
        `UPDATE "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" SET "userId" = $1, "nameFirstName" = 'Supervisor', "nameLastName" = 'Owner' WHERE "id" = $2`,
        [USER_ID, SUPERVISOR_WORKSPACE_MEMBER_ID],
      );
      await coreDataSource
        .getRepository(InconnectRecordAccessConfigurationEntity)
        .insert({
          workspaceId: WORKSPACE_ID,
          enforcementMode: 'MANAGED',
          revision: '1',
        });
      await coreDataSource
        .getRepository(InconnectRecordAccessManagedObjectEntity)
        .insert({
          id: RECORD_ACCESS_MANAGED_OBJECT_ID,
          workspaceId: WORKSPACE_ID,
          objectMetadataId: OBJECT_ID,
          ownerFieldMetadataId: OWNER_FIELD_ID,
          ownerRequirement: 'required',
        });
      await coreDataSource
        .getRepository(InconnectRecordAccessPolicyEntity)
        .insert({
          id: RECORD_ACCESS_POLICY_ID,
          workspaceId: WORKSPACE_ID,
          managedObjectId: RECORD_ACCESS_MANAGED_OBJECT_ID,
          roleId: AUTOMATION_PRINCIPAL_IDS.roleId,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'ownRecords',
          createPolicy: 'standardPermissionsOnly',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
          defaultOwnerRoleId: null,
        });
    };

    const seedRealInboundAuthorityFixture = async () => {
      await coreDataSource
        .getRepository(InconnectMessagingConfigurationEntity)
        .insert({
          workspaceId: WORKSPACE_ID,
          anchorObjectMetadataId: OBJECT_ID,
          revision: '1',
          autoCreateEnabled: true,
          autoCreateAnchorObjectMetadataId: OBJECT_ID,
          autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
          autoCreateOwnerRoleId: OWNER_ROLE_ID,
          autoCreateLabelPolicy: 'OMIT',
          automationUserWorkspaceId: null,
        });
      await coreDataSource
        .getRepository(InconnectMessagingPhoneIdentityFieldEntity)
        .insert({
          id: PHONE_IDENTITY_FIELD_ID,
          workspaceId: WORKSPACE_ID,
          objectMetadataId: OBJECT_ID,
          fieldMetadataId: PHONE_FIELD_ID,
          role: 'PRIMARY',
          ordinal: 0,
        });
      await coreDataSource
        .getRepository(InconnectMessagingConversationEntity)
        .insert({
          id: CONVERSATION_ID,
          workspaceId: WORKSPACE_ID,
          externalAddressNormalized: '+525514552571',
          linkedRecordObjectMetadataId: null,
          linkedRecordId: null,
          lastInboundAt: new Date(),
          pendingAt: new Date(),
        });
      await coreDataSource
        .getRepository(InconnectMessagingMessageEntity)
        .insert({
          id: MESSAGE_ID,
          workspaceId: WORKSPACE_ID,
          conversationId: CONVERSATION_ID,
          direction: 'INBOUND',
        });
      await coreDataSource
        .getRepository(InconnectMessagingOutboxEventEntity)
        .insert({
          id: INITIAL_OUTBOX_EVENT_ID,
          workspaceId: WORKSPACE_ID,
          aggregateType: 'MESSAGE',
          aggregateId: MESSAGE_ID,
          eventType: 'INBOUND_MESSAGE_RECEIVED',
          immutablePayload: { conversationId: CONVERSATION_ID },
          deduplicationKey: `fixture:inbound:${MESSAGE_ID}`,
          availableAt: new Date(),
          processingState: 'PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          error: null,
          publishedAt: null,
        });
    };

    const runRepositoryCreateMany = (
      queryRunner: WorkspaceQueryRunner,
      records: Array<{
        id: string;
        name: string;
        hookInjected: string;
        ownerId?: string;
      }>,
    ) =>
      withWorkspaceContext(buildWorkspaceContext() as never, () => {
        const repository = (
          queryRunner.manager as WorkspaceEntityManager
        ).getRepository(OBJECT_NAME, { unionOf: [ROLE_ID] }, authContext);

        return repository.insert(records, undefined, ['id']);
      });

    const getConnectionIdentity = async (queryRunner: WorkspaceQueryRunner) => {
      const [identity] = (await queryRunner.query(
        `SELECT pg_backend_pid() AS "backendPid", txid_current()::text AS "transactionId"`,
      )) as Array<{ backendPid: number; transactionId: string }>;

      return identity;
    };

    beforeAll(async () => {
      const url = getDisposableDatabaseUrl();
      const schemaBootstrapDataSource = new DataSource({
        type: 'postgres',
        url,
      });

      await schemaBootstrapDataSource.initialize();
      await schemaBootstrapDataSource.query(
        `CREATE SCHEMA IF NOT EXISTS "core"`,
      );
      await schemaBootstrapDataSource.query(
        `CREATE SCHEMA IF NOT EXISTS "${WORKSPACE_SCHEMA}"`,
      );
      await schemaBootstrapDataSource.destroy();

      coreDataSource = new DataSource({
        type: 'postgres',
        url,
        entities: coreEntitySchemas,
        synchronize: true,
      });
      await coreDataSource.initialize();

      const [{ currentDatabase }] = await coreDataSource.query<
        Array<{ currentDatabase: string }>
      >('SELECT current_database() AS "currentDatabase"');

      expect(currentDatabase).toBe(disposableDatabaseName);
      expect(currentDatabase).not.toBe('default');

      await coreDataSource.query(`
        CREATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "name" text NOT NULL DEFAULT 'Automation contact',
          "hookInjected" text NOT NULL DEFAULT 'NOT_HOOKED',
          "status" text NOT NULL DEFAULT 'NEW',
          "position" bigint NOT NULL DEFAULT 0,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now(),
          "deletedAt" timestamptz,
          "phonePrimaryPhoneNumber" text,
          "phonePrimaryPhoneCountryCode" text,
          "phonePrimaryPhoneCallingCode" text,
          "phoneAdditionalPhones" jsonb,
          "ownerId" uuid NOT NULL DEFAULT '${WORKSPACE_MEMBER_ID}',
          "createdBySource" text NOT NULL DEFAULT 'MANUAL',
          "createdByWorkspaceMemberId" uuid,
          "createdByName" text NOT NULL DEFAULT '',
          "createdByContext" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "updatedBySource" text NOT NULL DEFAULT 'MANUAL',
          "updatedByWorkspaceMemberId" uuid,
          "updatedByName" text NOT NULL DEFAULT '',
          "updatedByContext" jsonb NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await coreDataSource.query(
        `INSERT INTO "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" ("id", "nameFirstName", "nameLastName") VALUES ($1, 'Transaction', 'Tester'), ($2, 'Supervisor', 'Owner')`,
        [WORKSPACE_MEMBER_ID, SUPERVISOR_WORKSPACE_MEMBER_ID],
      );
      await coreDataSource.query(`
        CREATE FUNCTION "${WORKSPACE_SCHEMA}"."setTransactionalContactStatus"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          NEW."status" := 'TRIGGERED';
          RETURN NEW;
        END;
        $function$
      `);
      await coreDataSource.query(`
        CREATE TRIGGER "setTransactionalContactStatusBeforeInsert"
        BEFORE INSERT ON "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"
        FOR EACH ROW
        EXECUTE FUNCTION "${WORKSPACE_SCHEMA}"."setTransactionalContactStatus"()
      `);
      await coreDataSource.query(`
        CREATE TABLE "core"."transactionalCreateProbe" (
          "id" uuid PRIMARY KEY,
          "label" text NOT NULL
        )
      `);
      await coreDataSource.query(
        `CREATE UNIQUE INDEX "IDX_F13_PRIMARY_PHONE_UNIQUE" ON "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" ("phonePrimaryPhoneCountryCode", "phonePrimaryPhoneCallingCode", "phonePrimaryPhoneNumber")`,
      );
      eventEmitter = new EventEmitter2();
      eventEmitterSpy = jest.spyOn(eventEmitter, 'emit');
      workspaceDataSource = new GlobalWorkspaceDataSource(
        {
          type: 'postgres',
          url,
          entities: [transactionalContactSchema, workspaceMemberSchema],
        },
        new WorkspaceEventEmitter(eventEmitter),
        coreDataSource,
      );
      await workspaceDataSource.initialize();
      await seedRealAuthorityMetadata();

      const globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(workspaceDataSource),
        executeInWorkspaceContext: jest
          .fn()
          .mockImplementation((callback, contextAuth = authContext) =>
            withWorkspaceContext(
              buildWorkspaceContext(contextAuth) as never,
              callback,
            ),
          ),
        getRepository: jest.fn().mockImplementation(async () => ({
          minimum: async () => {
            const [{ minimum }] = await coreDataSource.query<
              Array<{ minimum: string | null }>
            >(
              `SELECT MIN("position")::text AS "minimum" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
            );

            return minimum === null ? null : Number(minimum);
          },
          maximum: async () => {
            const [{ maximum }] = await coreDataSource.query<
              Array<{ maximum: string | null }>
            >(
              `SELECT MAX("position")::text AS "maximum" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
            );

            return maximum === null ? null : Number(maximum);
          },
        })),
      };
      const recordPositionService = new RecordPositionService(
        globalWorkspaceOrmManager as never,
      );
      const dataArgProcessor = new DataArgProcessorService(
        recordPositionService,
      );
      createManyRunner = new CommonCreateManyQueryRunnerService(
        recordPositionService,
      );
      executePostQueryHooksSpy = jest.fn();
      const actorFromAuthContextService = new ActorFromAuthContextService({
        getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
          flatObjectMetadataMaps,
          flatFieldMetadataMaps,
        }),
      } as never);
      const createdByCreateOnePreQueryHook = new CreatedByCreateOnePreQueryHook(
        actorFromAuthContextService,
      );
      executePreQueryHooksSpy = jest
        .fn()
        .mockImplementation(async (hookAuth, objectName, _operation, args) => {
          const actorInjected = await createdByCreateOnePreQueryHook.execute(
            hookAuth,
            objectName,
            args,
          );

          if (
            hookAuth.userWorkspaceId ===
            AUTOMATION_PRINCIPAL_IDS.userWorkspaceId
          ) {
            return actorInjected;
          }

          return {
            ...actorInjected,
            data: {
              ...actorInjected.data,
              name: actorInjected.data.name ?? 'Automation contact',
              hookInjected: 'HOOKED',
            },
          };
        });
      const workspaceQueryHookService = {
        executePreQueryHooks: executePreQueryHooksSpy,
        executePostQueryHooks: executePostQueryHooksSpy,
      };

      fetchUpsertedRecordsSpy = jest.spyOn(
        createManyRunner as unknown as {
          fetchUpsertedRecords: (...parameters: unknown[]) => Promise<unknown>;
        },
        'fetchUpsertedRecords',
      );
      processNestedRelationsIfNeededSpy = jest.spyOn(
        createManyRunner as unknown as {
          processNestedRelationsIfNeeded: (
            ...parameters: unknown[]
          ) => Promise<unknown>;
        },
        'processNestedRelationsIfNeeded',
      );

      Object.assign(createManyRunner, {
        processNestedRelationsHelper: {
          processNestedRelations: jest.fn(),
        },
      });

      createOneRunner = new CommonCreateOneQueryRunnerService(createManyRunner);
      processRecordSpy = jest.fn().mockImplementation((record) => record);
      Object.assign(createOneRunner, {
        dataArgProcessor,
        workspaceQueryHookService,
        globalWorkspaceOrmManager,
        commonResultGettersService: {
          processRecord: processRecordSpy,
        },
        throttlerService: {
          tokenBucketThrottleOrThrow: jest.fn(),
        },
        twentyConfigService: {
          get: jest.fn((key: string) =>
            key === 'COMMON_QUERY_COMPLEXITY_LIMIT' ? 100 : 1,
          ),
        },
        metricsService: { incrementCounterForEvent: jest.fn() },
        permissionsService: { userHasWorkspaceSettingPermission: jest.fn() },
        featureFlagService: {},
        workspaceDataSourceV2Service: {},
      });

      queryRunnerContext = {
        authContext,
        flatObjectMetadata,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        flatIndexMaps: emptyFlatEntityMaps(),
        objectIdByNameSingular: { [OBJECT_NAME]: OBJECT_ID },
        rolePermissionConfig: { unionOf: [ROLE_ID] },
      };
    });

    beforeEach(async () => {
      canReadObjectRecords = true;
      inconnectRecordAccessPolicy = { status: 'not-configured' };
      eventEmitterSpy.mockClear();
      fetchUpsertedRecordsSpy.mockClear();
      processNestedRelationsIfNeededSpy.mockClear();
      processRecordSpy.mockClear();
      executePreQueryHooksSpy.mockClear();
      executePostQueryHooksSpy.mockClear();
      await coreDataSource.query(
        `TRUNCATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}", "core"."transactionalCreateProbe", "core"."inconnectMessagingOutboxEvent", "core"."inconnectMessagingMessage", "core"."inconnectMessagingConversation", "core"."inconnectMessagingPhoneIdentityField", "core"."inconnectMessagingConfiguration"`,
      );
    });

    afterAll(async () => {
      if (workspaceDataSource?.isInitialized) {
        await workspaceDataSource.destroy();
      }
      if (coreDataSource?.isInitialized) {
        await coreDataSource.destroy();
      }
    });

    it('rolls back workspace create and core SQL on the same connection without publishing events', async () => {
      const recordId = '99999999-9999-4999-8999-999999999999';
      const probeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const createQueryRunnerSpy = jest.spyOn(
        workspaceDataSource,
        'createQueryRunner',
      );

      createQueryRunnerSpy.mockClear();
      const startSpy = jest.spyOn(queryRunner, 'startTransaction');
      const commitSpy = jest.spyOn(queryRunner, 'commitTransaction');
      const rollbackSpy = jest.spyOn(queryRunner, 'rollbackTransaction');
      const releaseSpy = jest.spyOn(queryRunner, 'release');
      const identityBefore = await getConnectionIdentity(queryRunner);

      const { results } = await runCreate(
        queryRunner,
        recordId,
        'Rollback contact',
      );
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'rollback'],
      );
      const identityAfter = await getConnectionIdentity(queryRunner);

      expect(results).toMatchObject({ id: recordId, name: 'Rollback contact' });
      expect(identityAfter).toEqual(identityBefore);
      expect(createQueryRunnerSpy).not.toHaveBeenCalled();
      expect(startSpy).not.toHaveBeenCalled();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(releaseSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();
      expect(fetchUpsertedRecordsSpy).toHaveBeenCalledTimes(1);
      expect(processNestedRelationsIfNeededSpy).toHaveBeenCalledTimes(1);

      const [insideWorkspaceCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      )) as Array<{ count: string }>;
      const [insideCoreCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      )) as Array<{ count: string }>;
      const [outsideWorkspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [outsideCoreCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(insideWorkspaceCount.count).toBe('1');
      expect(insideCoreCount.count).toBe('1');
      expect(outsideWorkspaceCount.count).toBe('0');
      expect(outsideCoreCount.count).toBe('0');

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('0');
      expect(coreCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('commits workspace create and core SQL atomically and publishes buffered events after commit', async () => {
      const recordId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const probeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const createQueryRunnerSpy = jest.spyOn(
        workspaceDataSource,
        'createQueryRunner',
      );

      createQueryRunnerSpy.mockClear();
      const identityBefore = await getConnectionIdentity(queryRunner);

      await runCreate(queryRunner, recordId, 'Commit contact');
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'commit'],
      );
      const identityAfter = await getConnectionIdentity(queryRunner);

      expect(identityAfter).toEqual(identityBefore);
      expect(createQueryRunnerSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.commitTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('1');
      expect(coreCount.count).toBe('1');
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
    });

    it('commits a generated-ID write receipt without ordinary result refetch or read permission', async () => {
      canReadObjectRecords = false;
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const querySpy = jest.spyOn(queryRunner, 'query');

      querySpy.mockClear();

      const receipt = await runReceiptCreate(
        queryRunner,
        'Generated receipt contact',
      );

      expect(receipt).toEqual({
        objectMetadataId: OBJECT_ID,
        recordId: expect.any(String),
      });
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(fetchUpsertedRecordsSpy).not.toHaveBeenCalled();
      expect(processNestedRelationsIfNeededSpy).not.toHaveBeenCalled();
      expect(processRecordSpy).toHaveBeenCalledWith(
        { id: receipt.recordId },
        flatObjectMetadata,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        WORKSPACE_ID,
      );
      expect(executePreQueryHooksSpy).toHaveBeenCalledTimes(1);
      expect(executePostQueryHooksSpy).toHaveBeenCalledTimes(1);
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      const createQueries = querySpy.mock.calls.map(([query]) => String(query));

      expect(createQueries).toHaveLength(1);
      expect(createQueries[0]).toMatch(/^INSERT INTO /);
      expect(createQueries[0]).toContain('RETURNING *');
      expect(createQueries.some((query) => /^SELECT /i.test(query))).toBe(
        false,
      );

      const [insideRecord] = (await queryRunner.query(
        `SELECT "id", "name", "hookInjected", "status", "position"::text AS "position", "createdAt" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      )) as Array<{
        id: string;
        name: string;
        hookInjected: string;
        status: string;
        position: string;
        createdAt: Date;
      }>;

      expect(insideRecord).toMatchObject({
        id: receipt.recordId,
        name: 'Generated receipt contact',
        hookInjected: 'HOOKED',
        status: 'TRIGGERED',
        position: '0',
      });
      expect(insideRecord.createdAt).toBeInstanceOf(Date);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      const [persistedRecord] = await coreDataSource.query<
        Array<{ id: string }>
      >(
        `SELECT "id" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      );

      expect(persistedRecord.id).toBe(receipt.recordId);
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);

      const eventSnapshots = eventEmitterSpy.mock.calls.map(
        ([, eventBatch]) => eventBatch.events[0].properties.after,
      );

      expect(eventSnapshots).toHaveLength(2);
      expect(eventSnapshots[0]).toEqual(eventSnapshots[1]);
      expect(eventSnapshots[0]).toMatchObject({
        id: receipt.recordId,
        name: 'Generated receipt contact',
        hookInjected: 'HOOKED',
        status: 'TRIGGERED',
        position: '0',
        phone: {
          primaryPhoneNumber: '',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: [],
        },
      });
      expect(eventSnapshots[0].createdAt).toBeInstanceOf(Date);
      expect(eventSnapshots[0].updatedAt).toBeInstanceOf(Date);
    });

    it('rolls back a generated-ID write receipt and discards its buffered events', async () => {
      canReadObjectRecords = false;
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const receipt = await runReceiptCreate(
        queryRunner,
        'Rolled back receipt contact',
      );
      const [insideRecordCount] = (await queryRunner.query(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      )) as Array<{ count: string }>;

      expect(insideRecordCount.count).toBe('1');
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [persistedRecordCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      );

      expect(persistedRecordCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('keeps create-many caller projection narrow and orders complete events by identifiers', async () => {
      canReadObjectRecords = false;
      const firstRecordId = 'f1111111-1111-4111-8111-111111111111';
      const secondRecordId = 'f2222222-2222-4222-8222-222222222222';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const querySpy = jest.spyOn(queryRunner, 'query');

      querySpy.mockClear();

      const result = await runRepositoryCreateMany(queryRunner, [
        {
          id: firstRecordId,
          name: 'First create-many contact',
          hookInjected: 'FIRST_HOOK',
        },
        {
          id: secondRecordId,
          name: 'Second create-many contact',
          hookInjected: 'SECOND_HOOK',
        },
      ]);

      expect(result.identifiers).toEqual([
        { id: firstRecordId },
        { id: secondRecordId },
      ]);
      expect(result.generatedMaps).toEqual([
        { id: firstRecordId },
        { id: secondRecordId },
      ]);
      expect(result.raw).toEqual([
        { id: firstRecordId },
        { id: secondRecordId },
      ]);
      expect(
        result.raw.some((record: Record<string, unknown>) =>
          Object.prototype.hasOwnProperty.call(record, 'name'),
        ),
      ).toBe(false);

      const createQueries = querySpy.mock.calls.map(([query]) => String(query));

      expect(createQueries).toHaveLength(1);
      expect(createQueries[0]).toMatch(/^INSERT INTO /);
      expect(createQueries[0]).toContain('RETURNING *');
      expect(createQueries.some((query) => /^SELECT /i.test(query))).toBe(
        false,
      );
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.commitTransaction();
      await queryRunner.release();

      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);

      const eventSnapshotNames = eventEmitterSpy.mock.calls.map(
        ([, eventBatch]) =>
          eventBatch.events.map(
            (event: { properties: { after: { name: string } } }) =>
              event.properties.after.name,
          ),
      );

      expect(eventSnapshotNames).toEqual([
        ['First create-many contact', 'Second create-many contact'],
        ['First create-many contact', 'Second create-many contact'],
      ]);
    });

    it('creates outside ownRecords from INSERT snapshot while ordinary read remains scoped', async () => {
      const recordId = 'f3333333-3333-4333-8333-333333333333';

      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: ROLE_ID,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };

      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const result = await runRepositoryCreateMany(queryRunner, [
        {
          id: recordId,
          name: 'Supervisor-owned contact',
          hookInjected: 'OWNER_SCOPE_HOOK',
          ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        },
      ]);

      expect(result).toMatchObject({
        identifiers: [{ id: recordId }],
        generatedMaps: [{ id: recordId }],
        raw: [{ id: recordId }],
      });
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      const ordinaryRead = await withWorkspaceContext(
        buildWorkspaceContext() as never,
        () =>
          (queryRunner.manager as WorkspaceEntityManager)
            .getRepository(OBJECT_NAME, { unionOf: [ROLE_ID] }, authContext)
            .find({ where: { id: recordId } }),
      );

      expect(ordinaryRead).toEqual([]);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);

      const eventSnapshots = eventEmitterSpy.mock.calls.map(
        ([, eventBatch]) => eventBatch.events[0].properties.after,
      );

      expect(eventSnapshots).toHaveLength(2);
      expect(eventSnapshots[0]).toEqual(eventSnapshots[1]);
      expect(eventSnapshots[0]).toMatchObject({
        id: recordId,
        name: 'Supervisor-owned contact',
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        status: 'TRIGGERED',
      });
      expect(eventSnapshots[0].ownerId).not.toBe(WORKSPACE_MEMBER_ID);
    });

    it('runs the real F13 automation executor with Supervisor Owner while normal reads stay scoped', async () => {
      canReadObjectRecords = false;
      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: ROLE_ID,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };

      const { authority, service } = buildAutomationRecordCreateHarness();
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      const querySpy = jest.spyOn(queryRunner, 'query');

      querySpy.mockClear();

      const receipt = await service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+525514552571',
        authority,
        queryRunner,
      });

      expect(receipt).toEqual({
        objectMetadataId: OBJECT_ID,
        recordId: expect.any(String),
      });
      expect(Object.keys(receipt)).toEqual(['objectMetadataId', 'recordId']);
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      const createQueries = querySpy.mock.calls.map(([query]) => String(query));
      const insertQueries = createQueries.filter((query) =>
        /^INSERT INTO /i.test(query),
      );
      const selectQueries = createQueries.filter((query) =>
        /^SELECT /i.test(query),
      );

      expect(insertQueries).toHaveLength(1);
      expect(insertQueries[0]).toContain('RETURNING *');
      expect(selectQueries).toHaveLength(1);
      expect(selectQueries[0]).toContain(WORKSPACE_MEMBER_TABLE_NAME);
      expect(selectQueries[0]).not.toContain(TABLE_NAME);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      const [persistedRecord] = await coreDataSource.query<
        Array<{
          id: string;
          ownerId: string;
          phonePrimaryPhoneCallingCode: string;
          phonePrimaryPhoneCountryCode: string;
          phonePrimaryPhoneNumber: string;
        }>
      >(
        `SELECT "id", "ownerId", "phonePrimaryPhoneCallingCode", "phonePrimaryPhoneCountryCode", "phonePrimaryPhoneNumber" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [receipt.recordId],
      );

      expect(persistedRecord).toEqual({
        id: receipt.recordId,
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        phonePrimaryPhoneCallingCode: '+52',
        phonePrimaryPhoneCountryCode: 'MX',
        phonePrimaryPhoneNumber: '5514552571',
      });
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
      expect(
        eventEmitterSpy.mock.calls.map(([eventName]) => eventName),
      ).toEqual([
        computeEventName(OBJECT_NAME, DatabaseEventAction.CREATED),
        computeEventName(OBJECT_NAME, DatabaseEventAction.UPSERTED),
      ]);

      const eventSnapshots = eventEmitterSpy.mock.calls.map(
        ([, eventBatch]) => eventBatch.events[0].properties.after,
      );

      expect(eventSnapshots[0]).toEqual(eventSnapshots[1]);
      expect(fetchUpsertedRecordsSpy).not.toHaveBeenCalled();
      expect(eventSnapshots[0]).toMatchObject({
        id: receipt.recordId,
        name: 'Automation contact',
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        status: 'TRIGGERED',
        phone: {
          primaryPhoneNumber: '5514552571',
          primaryPhoneCountryCode: 'MX',
          primaryPhoneCallingCode: '+52',
          additionalPhones: [],
        },
      });

      const readQueryRunner = workspaceDataSource.createQueryRunner();

      await readQueryRunner.connect();

      await expect(
        withWorkspaceContext(buildWorkspaceContext() as never, () =>
          (readQueryRunner.manager as WorkspaceEntityManager)
            .getRepository(OBJECT_NAME, { unionOf: [ROLE_ID] }, authContext)
            .find({ where: { id: receipt.recordId } }),
        ),
      ).rejects.toThrow('does not have permission');
      await readQueryRunner.release();

      eventEmitterSpy.mockClear();

      const rollbackQueryRunner = workspaceDataSource.createQueryRunner();

      await rollbackQueryRunner.connect();
      await rollbackQueryRunner.startTransaction();

      const rolledBackReceipt = await service.execute({
        workspaceId: WORKSPACE_ID,
        canonicalPhoneIdentity: '+14155552671',
        authority,
        queryRunner: rollbackQueryRunner,
      });

      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await rollbackQueryRunner.rollbackTransaction();
      await rollbackQueryRunner.release();

      const [rolledBackRecordCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [rolledBackReceipt.recordId],
      );

      expect(rolledBackRecordCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('composes inbound NO_MATCH through real Common Create, CRM events, link, and Outbox on one runner', async () => {
      canReadObjectRecords = false;
      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: ROLE_ID,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };
      await seedInboundConversation();

      const harness = buildRealInboundCompositionHarness();

      jest
        .mocked(harness.authorityService.issueAuthority)
        .mockImplementation(async ({ queryRunner }) => {
          expect(queryRunner).toBe(harness.runnerCapture.queryRunner);
          expect(queryRunner.manager).toBe(harness.runnerCapture.manager);
          expect(queryRunner.isTransactionActive).toBe(true);

          return harness.authority;
        });

      await expect(
        harness.service.attemptForInboundMessage({
          workspaceId: WORKSPACE_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toMatchObject({ state: 'CREATED_AND_LINKED' });

      expect(harness.runnerCapture.queryRunner).toBeDefined();
      expect(harness.runnerCapture.queryRunner?.manager).toBe(
        harness.runnerCapture.manager,
      );
      expect(harness.runnerCapture.queryRunner?.isTransactionActive).toBe(
        false,
      );
      expect(harness.transactionIdentities.length).toBeGreaterThan(5);
      expect(
        new Set(harness.transactionIdentities.map(({ pid }) => pid)).size,
      ).toBe(1);
      expect(
        new Set(harness.transactionIdentities.map(({ txid }) => txid)).size,
      ).toBe(1);

      const records = await coreDataSource.query<
        Array<{
          id: string;
          ownerId: string;
          phonePrimaryPhoneCallingCode: string;
          phonePrimaryPhoneCountryCode: string;
          phonePrimaryPhoneNumber: string;
        }>
      >(
        `SELECT "id", "ownerId", "phonePrimaryPhoneCallingCode", "phonePrimaryPhoneCountryCode", "phonePrimaryPhoneNumber" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );
      const [conversation] = await coreDataSource.query<
        Array<{
          linkedRecordObjectMetadataId: string;
          linkedRecordId: string;
        }>
      >(
        `SELECT "linkedRecordObjectMetadataId", "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const outboxRows = await coreDataSource.query<
        Array<{
          eventType: string;
          immutablePayload: { conversationId: string };
        }>
      >(
        `SELECT "eventType", "immutablePayload" FROM "core"."inconnectMessagingOutboxEvent"`,
      );

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        phonePrimaryPhoneCallingCode: '+52',
        phonePrimaryPhoneCountryCode: 'MX',
        phonePrimaryPhoneNumber: '5514552571',
      });
      expect(conversation).toEqual({
        linkedRecordObjectMetadataId: OBJECT_ID,
        linkedRecordId: records[0].id,
      });
      expect(outboxRows).toEqual([
        {
          eventType: 'CONVERSATION_LINKED',
          immutablePayload: {
            conversationId: CONVERSATION_ID,
            actor: 'SYSTEM_PHONE_IDENTITY_RESOLUTION',
          },
        },
      ]);
      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
      expect(
        eventEmitterSpy.mock.calls.map(([eventName]) => eventName),
      ).toEqual([
        computeEventName(OBJECT_NAME, DatabaseEventAction.CREATED),
        computeEventName(OBJECT_NAME, DatabaseEventAction.UPSERTED),
      ]);
    });

    it('accepts the monolithic Outbox NO_MATCH flow with real Authority and real Automation Principal', async () => {
      canReadObjectRecords = false;
      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: AUTOMATION_PRINCIPAL_IDS.roleId,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };
      await seedRealInboundAuthorityFixture();
      const harness = await buildMonolithicRealAuthorityHarness();
      const [durableInboundBeforeProcessing] = await coreDataSource.query<
        Array<{ processingState: string }>
      >(
        `SELECT "processingState" FROM "core"."inconnectMessagingOutboxEvent" WHERE "id" = $1`,
        [INITIAL_OUTBOX_EVENT_ID],
      );

      expect(durableInboundBeforeProcessing.processingState).toBe('PENDING');
      expect(harness.readiness).toMatchObject({
        readiness: 'READY_FOR_RUNTIME',
        effectiveEnabled: true,
      });
      expect(harness.outboxService).toBeInstanceOf(
        InconnectMessagingOutboxService,
      );
      expect(harness.inboundService).toBeInstanceOf(
        InconnectMessagingInboundAutoLinkService,
      );
      expect(harness.backgroundResolver).toBeInstanceOf(
        InconnectMessagingBackgroundPhoneIdentityResolverService,
      );
      expect(harness.authorityService).toBeInstanceOf(
        InconnectMessagingAutoCreateAuthorityService,
      );
      expect(harness.eligibilityService).toBeInstanceOf(
        InconnectMessagingAutoCreateEligibilityService,
      );
      expect(harness.primaryValidatorService).toBeInstanceOf(
        InconnectMessagingAutoCreatePrimaryValidatorService,
      );
      expect(harness.automationPrincipalService).toBeInstanceOf(
        InconnectMessagingAutomationPrincipalService,
      );
      expect(harness.automationRecordAccessService).toBeInstanceOf(
        InconnectMessagingAutomationRecordAccessService,
      );
      expect(harness.automationRecordCreateService).toBeInstanceOf(
        InconnectMessagingAutomationRecordCreateService,
      );
      expect(harness.gatewayService).toBeInstanceOf(
        WorkspaceQueryRunnerCoreQueryBuilderService,
      );

      await harness.outboxService.publishEvent(INITIAL_OUTBOX_EVENT_ID);

      expect(harness.backgroundResolutions[0]).toEqual({ state: 'NO_MATCH' });
      expect(harness.authorityIssueSpy).toHaveBeenCalledTimes(1);
      expect(harness.automationCreateSpy).toHaveBeenCalledTimes(1);
      expect(harness.commonCreateSpy).toHaveBeenCalledTimes(1);
      expect(
        harness.principalValidateSpy.mock.calls.some(
          ([input]) => input.queryRunner === harness.runnerCapture.queryRunner,
        ),
      ).toBe(true);

      const plan = harness.resolvedAuthorityPlans[0];

      expect(plan).toMatchObject({
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OBJECT_ID,
        primaryPhoneIdentityFieldId: PHONE_IDENTITY_FIELD_ID,
        primaryPhoneFieldMetadataId: PHONE_FIELD_ID,
        ownerRoleId: OWNER_ROLE_ID,
        ownerWorkspaceMemberId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        ownerFieldMetadataId: OWNER_FIELD_ID,
        automationUserId: AUTOMATION_PRINCIPAL_IDS.userId,
        automationUserWorkspaceId: AUTOMATION_PRINCIPAL_IDS.userWorkspaceId,
        automationWorkspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
        automationRoleId: AUTOMATION_PRINCIPAL_IDS.roleId,
        allowedFieldMetadataIds: [PHONE_FIELD_ID, OWNER_FIELD_ID],
      });
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.allowedFieldMetadataIds)).toBe(true);

      const deliberatePayload = harness.deliberatePayloads[0];

      expect(Object.keys(deliberatePayload).sort()).toEqual(['owner', 'phone']);
      expect(deliberatePayload).toEqual({
        phone: {
          primaryPhoneCountryCode: 'MX',
          primaryPhoneCallingCode: '+52',
          primaryPhoneNumber: '5514552571',
          additionalPhones: null,
        },
        owner: {
          connect: { where: { id: SUPERVISOR_WORKSPACE_MEMBER_ID } },
        },
      });
      expect(deliberatePayload).not.toHaveProperty('position');

      const receipt = await harness.automationCreateSpy.mock.results[0].value;
      const records = await coreDataSource.query<
        Array<{
          id: string;
          ownerId: string;
          position: string;
          status: string;
          phonePrimaryPhoneCallingCode: string;
          phonePrimaryPhoneCountryCode: string;
          phonePrimaryPhoneNumber: string;
          createdBySource: string;
          createdByWorkspaceMemberId: string;
          updatedBySource: string;
          updatedByWorkspaceMemberId: string;
        }>
      >(
        `SELECT "id", "ownerId", "position"::text AS "position", "status", "phonePrimaryPhoneCallingCode", "phonePrimaryPhoneCountryCode", "phonePrimaryPhoneNumber", "createdBySource", "createdByWorkspaceMemberId", "updatedBySource", "updatedByWorkspaceMemberId" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );

      expect(records).toHaveLength(1);
      expect(receipt).toEqual({
        objectMetadataId: OBJECT_ID,
        recordId: records[0].id,
      });
      expect(records[0]).toEqual({
        id: receipt.recordId,
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        position: '0',
        status: 'TRIGGERED',
        phonePrimaryPhoneCallingCode: '+52',
        phonePrimaryPhoneCountryCode: 'MX',
        phonePrimaryPhoneNumber: '5514552571',
        createdBySource: 'MANUAL',
        createdByWorkspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
        updatedBySource: 'MANUAL',
        updatedByWorkspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
      });
      expect(records[0].ownerId).not.toBe(
        AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
      );

      const [conversation] = await coreDataSource.query<
        Array<{
          linkedRecordObjectMetadataId: string;
          linkedRecordId: string;
        }>
      >(
        `SELECT "linkedRecordObjectMetadataId", "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const linkOutboxRows = await coreDataSource.query<
        Array<{
          eventType: string;
          immutablePayload: {
            actor: string;
            conversationId: string;
          };
        }>
      >(
        `SELECT "eventType", "immutablePayload" FROM "core"."inconnectMessagingOutboxEvent" WHERE "eventType" = 'CONVERSATION_LINKED'`,
      );
      const [initialOutboxAfterProcessing] = await coreDataSource.query<
        Array<{ processingState: string }>
      >(
        `SELECT "processingState" FROM "core"."inconnectMessagingOutboxEvent" WHERE "id" = $1`,
        [INITIAL_OUTBOX_EVENT_ID],
      );

      expect(conversation).toEqual({
        linkedRecordObjectMetadataId: OBJECT_ID,
        linkedRecordId: receipt.recordId,
      });
      expect(linkOutboxRows).toEqual([
        {
          eventType: 'CONVERSATION_LINKED',
          immutablePayload: {
            conversationId: CONVERSATION_ID,
            actor: 'SYSTEM_PHONE_IDENTITY_RESOLUTION',
          },
        },
      ]);
      expect(initialOutboxAfterProcessing.processingState).toBe('PUBLISHED');
      expect(harness.messageQueueService.add).toHaveBeenCalledTimes(1);

      expect(eventEmitterSpy).toHaveBeenCalledTimes(2);
      expect(
        eventEmitterSpy.mock.calls.map(([eventName]) => eventName),
      ).toEqual([
        computeEventName(OBJECT_NAME, DatabaseEventAction.CREATED),
        computeEventName(OBJECT_NAME, DatabaseEventAction.UPSERTED),
      ]);
      const eventSnapshots = eventEmitterSpy.mock.calls.map(
        ([, eventBatch]) => eventBatch.events[0].properties.after,
      );

      expect(eventSnapshots[0]).toEqual(eventSnapshots[1]);
      expect(eventSnapshots[0]).toMatchObject({
        id: receipt.recordId,
        ownerId: SUPERVISOR_WORKSPACE_MEMBER_ID,
        position: '0',
        status: 'TRIGGERED',
        phone: {
          primaryPhoneCountryCode: 'MX',
          primaryPhoneCallingCode: '+52',
          primaryPhoneNumber: '5514552571',
          additionalPhones: [],
        },
        createdBy: {
          source: 'MANUAL',
          workspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
        },
        updatedBy: {
          source: 'MANUAL',
          workspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
        },
      });

      expect(harness.runnerCapture.queryRunner).toBeDefined();
      expect(harness.runnerCapture.queryRunner?.manager).toBe(
        harness.runnerCapture.manager,
      );
      expect(
        harness.gatewayBindings.every(
          ({ manager, queryRunner }) =>
            queryRunner === harness.runnerCapture.queryRunner &&
            manager === harness.runnerCapture.manager &&
            queryRunner.manager === manager &&
            manager.queryRunner === queryRunner,
        ),
      ).toBe(true);
      expect(harness.gatewayBindings.length).toBeGreaterThan(20);
      expect(
        new Set(harness.transactionObservations.map(({ pid }) => pid)).size,
      ).toBe(1);
      expect(
        new Set(harness.transactionObservations.map(({ txid }) => txid)).size,
      ).toBe(1);
      expect(
        harness.transactionObservations.every(
          ({ active, managerMatches }) => active && managerMatches,
        ),
      ).toBe(true);
      expect(harness.transactionObservations.map(({ stage }) => stage)).toEqual(
        expect.arrayContaining([
          'advisory-lock',
          'conversation-for-update',
          'background-resolver',
          'real-authority',
          'real-principal',
          'automation-record-create',
          'common-create',
          'crm-insert',
          'conversation-update',
          'link-outbox-insert',
        ]),
      );

      const [objectPermission] = await coreDataSource.query<
        Array<{ canReadObjectRecords: boolean }>
      >(
        `SELECT "canReadObjectRecords" FROM "core"."objectPermission" WHERE "roleId" = $1`,
        [AUTOMATION_PRINCIPAL_IDS.roleId],
      );
      const automationAuthContext = {
        type: 'user',
        user: { id: AUTOMATION_PRINCIPAL_IDS.userId },
        workspace: { id: WORKSPACE_ID },
        workspaceMemberId: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
        workspaceMember: {
          id: AUTOMATION_PRINCIPAL_IDS.workspaceMemberId,
          name: {
            firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
            lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
          },
        },
        userWorkspaceId: AUTOMATION_PRINCIPAL_IDS.userWorkspaceId,
      } as unknown as WorkspaceAuthContext;
      const readQueryRunner = workspaceDataSource.createQueryRunner();

      expect(objectPermission.canReadObjectRecords).toBe(false);
      await readQueryRunner.connect();
      await readQueryRunner.startTransaction();
      try {
        await expect(
          withWorkspaceContext(
            buildWorkspaceContext(automationAuthContext) as never,
            () =>
              (readQueryRunner.manager as WorkspaceEntityManager)
                .getRepository(
                  OBJECT_NAME,
                  { unionOf: [AUTOMATION_PRINCIPAL_IDS.roleId] },
                  automationAuthContext,
                )
                .find({ where: { id: receipt.recordId } }),
          ),
        ).rejects.toThrow('does not have permission');
      } finally {
        await readQueryRunner.rollbackTransaction();
        await readQueryRunner.release();
      }
    });

    it('rolls back the real monolithic Authority and Principal flow after CRM INSERT', async () => {
      canReadObjectRecords = false;
      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: AUTOMATION_PRINCIPAL_IDS.roleId,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };
      await seedRealInboundAuthorityFixture();
      const harness = await buildMonolithicRealAuthorityHarness();

      await coreDataSource.query(`
        CREATE FUNCTION "core"."rejectF13LinkOutbox"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW."eventType" = 'CONVERSATION_LINKED' THEN
            RAISE EXCEPTION 'forced physical link Outbox rejection';
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER "rejectF13LinkOutboxBeforeInsert"
        BEFORE INSERT ON "core"."inconnectMessagingOutboxEvent"
        FOR EACH ROW EXECUTE FUNCTION "core"."rejectF13LinkOutbox"()
      `);

      try {
        await expect(
          harness.outboxService.publishEvent(INITIAL_OUTBOX_EVENT_ID),
        ).rejects.toThrow('forced physical link Outbox rejection');
      } finally {
        await coreDataSource.query(`
          DROP TRIGGER IF EXISTS "rejectF13LinkOutboxBeforeInsert" ON "core"."inconnectMessagingOutboxEvent";
          DROP FUNCTION IF EXISTS "core"."rejectF13LinkOutbox"()
        `);
      }

      const [{ recordCount }] = await coreDataSource.query<
        Array<{ recordCount: string }>
      >(
        `SELECT COUNT(*)::text AS "recordCount" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );
      const [conversation] = await coreDataSource.query<
        Array<{
          linkedRecordObjectMetadataId: string | null;
          linkedRecordId: string | null;
        }>
      >(
        `SELECT "linkedRecordObjectMetadataId", "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const [{ linkOutboxCount }] = await coreDataSource.query<
        Array<{ linkOutboxCount: string }>
      >(
        `SELECT COUNT(*)::text AS "linkOutboxCount" FROM "core"."inconnectMessagingOutboxEvent" WHERE "eventType" = 'CONVERSATION_LINKED'`,
      );

      expect(harness.authorityIssueSpy).toHaveBeenCalledTimes(1);
      expect(harness.automationCreateSpy).toHaveBeenCalledTimes(1);
      expect(recordCount).toBe('0');
      expect(conversation).toEqual({
        linkedRecordObjectMetadataId: null,
        linkedRecordId: null,
      });
      expect(linkOutboxCount).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('rejects real Automation Principal READ drift before the CRM INSERT', async () => {
      await seedRealInboundAuthorityFixture();
      const harness = await buildMonolithicRealAuthorityHarness();

      await coreDataSource
        .getRepository(ObjectPermissionEntity)
        .update(
          { roleId: AUTOMATION_PRINCIPAL_IDS.roleId },
          { canReadObjectRecords: true },
        );

      try {
        const driftedReadiness =
          await harness.configurationService.getConfiguration({ authContext });

        expect(driftedReadiness).toMatchObject({
          readiness: 'NOT_READY',
          effectiveEnabled: false,
        });
        await harness.outboxService.publishEvent(INITIAL_OUTBOX_EVENT_ID);
        expect(harness.inboundResults).toEqual([
          expect.objectContaining({ state: 'NO_MATCH_NOT_READY' }),
        ]);
      } finally {
        await coreDataSource
          .getRepository(ObjectPermissionEntity)
          .update(
            { roleId: AUTOMATION_PRINCIPAL_IDS.roleId },
            { canReadObjectRecords: false },
          );
      }

      const [{ recordCount }] = await coreDataSource.query<
        Array<{ recordCount: string }>
      >(
        `SELECT COUNT(*)::text AS "recordCount" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );

      expect(harness.authorityIssueSpy).toHaveBeenCalledTimes(1);
      expect(harness.automationCreateSpy).not.toHaveBeenCalled();
      expect(recordCount).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('keeps the real Outbox UNIQUE path create-free with real Authority available', async () => {
      await seedRealInboundAuthorityFixture();
      const harness = await buildMonolithicRealAuthorityHarness();
      const existingRecordId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';

      await coreDataSource.query(
        `INSERT INTO "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" ("id", "name", "hookInjected", "status", "position", "phonePrimaryPhoneNumber", "phonePrimaryPhoneCountryCode", "phonePrimaryPhoneCallingCode", "ownerId") VALUES ($1, 'Existing', 'EXISTING', 'TRIGGERED', 0, '5514552571', 'MX', '+52', $2)`,
        [existingRecordId, SUPERVISOR_WORKSPACE_MEMBER_ID],
      );

      await harness.outboxService.publishEvent(INITIAL_OUTBOX_EVENT_ID);

      const [{ recordCount }] = await coreDataSource.query<
        Array<{ recordCount: string }>
      >(
        `SELECT COUNT(*)::text AS "recordCount" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );
      const [conversation] = await coreDataSource.query<
        Array<{ linkedRecordId: string }>
      >(
        `SELECT "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const [{ linkOutboxCount }] = await coreDataSource.query<
        Array<{ linkOutboxCount: string }>
      >(
        `SELECT COUNT(*)::text AS "linkOutboxCount" FROM "core"."inconnectMessagingOutboxEvent" WHERE "eventType" = 'CONVERSATION_LINKED'`,
      );

      expect(harness.backgroundResolutions[0]).toEqual({
        state: 'UNIQUE',
        recordId: existingRecordId,
        objectMetadataId: OBJECT_ID,
      });
      expect(harness.authorityIssueSpy).not.toHaveBeenCalled();
      expect(harness.automationCreateSpy).not.toHaveBeenCalled();
      expect(recordCount).toBe('1');
      expect(conversation.linkedRecordId).toBe(existingRecordId);
      expect(linkOutboxCount).toBe('1');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('rolls back real CRM INSERT and buffered events when final F13 Outbox persistence fails', async () => {
      inconnectRecordAccessPolicy = {
        status: 'configured',
        managedObjectMetadataIds: [OBJECT_ID],
        rules: [
          {
            roleId: ROLE_ID,
            objectMetadataId: OBJECT_ID,
            ownerFieldMetadataId: OWNER_FIELD_ID,
            ownerFieldName: 'owner',
            ownerJoinColumnName: 'ownerId',
            recordEffect: 'ownRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'denied',
            ownerRequirement: 'required',
            missingOwnerPolicy: 'requireExplicit',
          },
        ],
      };
      await seedInboundConversation();
      const harness = buildRealInboundCompositionHarness({
        failOutboxInsert: true,
      });

      await expect(
        harness.service.attemptForInboundMessage({
          workspaceId: WORKSPACE_ID,
          messageId: MESSAGE_ID,
        }),
      ).rejects.toThrow('forced F13 Outbox failure');

      const [{ recordCount }] = await coreDataSource.query<
        Array<{ recordCount: string }>
      >(
        `SELECT COUNT(*)::text AS "recordCount" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );
      const [conversation] = await coreDataSource.query<
        Array<{
          linkedRecordObjectMetadataId: string | null;
          linkedRecordId: string | null;
        }>
      >(
        `SELECT "linkedRecordObjectMetadataId", "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const [{ outboxCount }] = await coreDataSource.query<
        Array<{ outboxCount: string }>
      >(
        `SELECT COUNT(*)::text AS "outboxCount" FROM "core"."inconnectMessagingOutboxEvent"`,
      );

      expect(recordCount).toBe('0');
      expect(conversation).toEqual({
        linkedRecordObjectMetadataId: null,
        linkedRecordId: null,
      });
      expect(outboxCount).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('preserves UNIQUE existing behavior without invoking real Common Create', async () => {
      await seedInboundConversation();
      const existingRecordId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

      await coreDataSource.query(
        `INSERT INTO "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" ("id", "name", "hookInjected", "status", "position", "phonePrimaryPhoneNumber", "phonePrimaryPhoneCountryCode", "phonePrimaryPhoneCallingCode", "ownerId") VALUES ($1, 'Existing', 'EXISTING', 'TRIGGERED', 0, '5514552571', 'MX', '+52', $2)`,
        [existingRecordId, SUPERVISOR_WORKSPACE_MEMBER_ID],
      );

      const harness = buildRealInboundCompositionHarness();

      await expect(
        harness.service.attemptForInboundMessage({
          workspaceId: WORKSPACE_ID,
          messageId: MESSAGE_ID,
        }),
      ).resolves.toMatchObject({ state: 'LINKED_EXISTING' });

      expect(harness.authorityService.issueAuthority).not.toHaveBeenCalled();
      const [{ recordCount }] = await coreDataSource.query<
        Array<{ recordCount: string }>
      >(
        `SELECT COUNT(*)::text AS "recordCount" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}"`,
      );
      const [conversation] = await coreDataSource.query<
        Array<{ linkedRecordId: string }>
      >(
        `SELECT "linkedRecordId" FROM "core"."inconnectMessagingConversation" WHERE "id" = $1`,
        [CONVERSATION_ID],
      );
      const [{ outboxCount }] = await coreDataSource.query<
        Array<{ outboxCount: string }>
      >(
        `SELECT COUNT(*)::text AS "outboxCount" FROM "core"."inconnectMessagingOutboxEvent"`,
      );

      expect(recordCount).toBe('1');
      expect(conversation.linkedRecordId).toBe(existingRecordId);
      expect(outboxCount).toBe('1');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('rejects upsert and multi-record receipt attempts', async () => {
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();

      await expect(
        createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
          {
            data: { name: 'Upsert receipt' },
            upsert: true,
          },
          queryRunnerContext,
          queryRunner,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        createOneRunner.executeCreateOnlyForWriteReceiptWithQueryRunner(
          {
            data: [{ name: 'First receipt' }, { name: 'Second receipt' }],
          } as unknown as Parameters<
            CommonCreateOneQueryRunnerService['executeCreateOnlyForWriteReceiptWithQueryRunner']
          >[0],
          queryRunnerContext,
          queryRunner,
        ),
      ).rejects.toBeInstanceOf(Error);

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      expect(fetchUpsertedRecordsSpy).not.toHaveBeenCalled();
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });

    it('propagates create failure so the caller can roll back every prior write', async () => {
      const recordId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const probeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const queryRunner = workspaceDataSource.createQueryRunner();

      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.query(
        `INSERT INTO "core"."transactionalCreateProbe" ("id", "label") VALUES ($1, $2)`,
        [probeId, 'error'],
      );
      await runCreate(queryRunner, recordId, 'First create');

      await expect(
        runCreate(queryRunner, recordId, 'Duplicate create'),
      ).rejects.toBeDefined();
      expect(queryRunner.isTransactionActive).toBe(true);
      expect(eventEmitterSpy).not.toHaveBeenCalled();

      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const [workspaceCount] = await coreDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT COUNT(*)::text AS "count" FROM "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" WHERE "id" = $1`,
        [recordId],
      );
      const [coreCount] = await coreDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS "count" FROM "core"."transactionalCreateProbe" WHERE "id" = $1`,
        [probeId],
      );

      expect(workspaceCount.count).toBe('0');
      expect(coreCount.count).toBe('0');
      expect(eventEmitterSpy).not.toHaveBeenCalled();
    });
  },
);
