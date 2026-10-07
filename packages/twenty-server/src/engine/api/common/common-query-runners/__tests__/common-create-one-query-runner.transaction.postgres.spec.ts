import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  FieldMetadataType,
  ObjectOpenRecordIn,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';
import { DataSource, EntitySchema, type EntityManager } from 'typeorm';

import { DataArgProcessorService } from 'src/engine/api/common/common-args-processors/data-arg-processor/data-arg-processor.service';
import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import { CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { type RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
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
import {
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import {
  type InconnectMessagingAutoCreateAuthority,
  type InconnectMessagingAutoCreateAuthorityPlan,
  type InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { type InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutomationRecordCreateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-create.service';

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
const WORKSPACE_MEMBER_TABLE_NAME = '_workspaceMember';

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
  phonePrimaryPhoneNumber: string | null;
  phonePrimaryPhoneCountryCode: string | null;
  phonePrimaryPhoneCallingCode: string | null;
  phoneAdditionalPhones: object[] | null;
  ownerId: string;
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
    phonePrimaryPhoneNumber: { type: String, nullable: true },
    phonePrimaryPhoneCountryCode: { type: String, nullable: true },
    phonePrimaryPhoneCallingCode: { type: String, nullable: true },
    phoneAdditionalPhones: { type: 'jsonb', nullable: true },
    ownerId: { type: 'uuid' },
  },
});

const workspaceMemberSchema = new EntitySchema<{ id: string }>({
  name: 'workspaceMember',
  tableName: WORKSPACE_MEMBER_TABLE_NAME,
  schema: WORKSPACE_SCHEMA,
  columns: {
    id: { type: 'uuid', primary: true },
  },
});

const buildFlatFieldMetadata = ({
  id,
  name,
  type,
  isNullable = false,
  isSystem = false,
  settings = null,
  relationTargetObjectMetadataId = null,
}: {
  id: string;
  name: string;
  type: FieldMetadataType;
  isNullable?: boolean;
  isSystem?: boolean;
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
    isSystemSideEffect: false,
    isActive: true,
    isUnique: name === 'id',
    isUIEditable: name !== 'id',
    isLabelSyncedWithName: false,
    defaultValue: null,
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
});
const hookInjectedFieldMetadata = buildFlatFieldMetadata({
  id: HOOK_INJECTED_FIELD_ID,
  name: 'hookInjected',
  type: FieldMetadataType.TEXT,
});
const statusFieldMetadata = buildFlatFieldMetadata({
  id: STATUS_FIELD_ID,
  name: 'status',
  type: FieldMetadataType.TEXT,
});
const positionFieldMetadata = buildFlatFieldMetadata({
  id: POSITION_FIELD_ID,
  name: 'position',
  type: FieldMetadataType.NUMBER,
  isSystem: true,
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

    const buildObjectPermissions = () => ({
      [OBJECT_ID]: {
        canReadObjectRecords,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: true,
        canDestroyObjectRecords: true,
        restrictedFields: {},
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

    const buildWorkspaceContext = () => ({
      authContext,
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
      permissionsPerRoleId: { [ROLE_ID]: buildObjectPermissions() },
      entityMetadatas: workspaceDataSource.entityMetadatas,
      userWorkspaceRoleMap: { [USER_WORKSPACE_ID]: ROLE_ID },
      apiKeyRoleMap: {},
    });

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

    const buildAutomationRecordCreateHarness = () => {
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
                  lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
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
        service: new InconnectMessagingAutomationRecordCreateService(
          dataSource,
          authorityService,
          automationPrincipalService,
          workspaceCacheService,
          createOneRunner,
        ),
      };
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

      coreDataSource = new DataSource({ type: 'postgres', url });
      await coreDataSource.initialize();

      const [{ currentDatabase }] = await coreDataSource.query<
        Array<{ currentDatabase: string }>
      >('SELECT current_database() AS "currentDatabase"');

      expect(currentDatabase).toBe(disposableDatabaseName);
      expect(currentDatabase).not.toBe('default');

      await coreDataSource.query(`CREATE SCHEMA "${WORKSPACE_SCHEMA}"`);
      await coreDataSource.query('CREATE SCHEMA "core"');
      await coreDataSource.query(`
        CREATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "name" text NOT NULL,
          "hookInjected" text NOT NULL,
          "status" text NOT NULL DEFAULT 'NEW',
          "position" bigint NOT NULL DEFAULT 0,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now(),
          "phonePrimaryPhoneNumber" text DEFAULT '5514552571',
          "phonePrimaryPhoneCountryCode" text DEFAULT 'MX',
          "phonePrimaryPhoneCallingCode" text DEFAULT '+52',
          "phoneAdditionalPhones" jsonb,
          "ownerId" uuid NOT NULL DEFAULT '${WORKSPACE_MEMBER_ID}'
        )
      `);
      await coreDataSource.query(`
        CREATE TABLE "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" (
          "id" uuid PRIMARY KEY
        )
      `);
      await coreDataSource.query(
        `INSERT INTO "${WORKSPACE_SCHEMA}"."${WORKSPACE_MEMBER_TABLE_NAME}" ("id") VALUES ($1), ($2)`,
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

      const recordPositionService = {
        overridePositionOnRecords: jest
          .fn()
          .mockImplementation(({ partialRecordInputs }) =>
            Promise.resolve(partialRecordInputs),
          ),
      } as unknown as RecordPositionService;
      const dataArgProcessor = new DataArgProcessorService(
        recordPositionService,
      );
      createManyRunner = new CommonCreateManyQueryRunnerService(
        recordPositionService,
      );
      const globalWorkspaceOrmManager = {
        getGlobalWorkspaceDataSource: jest
          .fn()
          .mockResolvedValue(workspaceDataSource),
        executeInWorkspaceContext: jest
          .fn()
          .mockImplementation((callback) =>
            withWorkspaceContext(buildWorkspaceContext() as never, callback),
          ),
      };
      executePreQueryHooksSpy = jest
        .fn()
        .mockImplementation((_auth, _object, _operation, args) => ({
          ...args,
          data: {
            ...args.data,
            name: args.data.name ?? 'Automation contact',
            hookInjected: 'HOOKED',
          },
        }));
      executePostQueryHooksSpy = jest.fn();
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
        `TRUNCATE TABLE "${WORKSPACE_SCHEMA}"."${TABLE_NAME}", "core"."transactionalCreateProbe"`,
      );
    });

    afterAll(async () => {
      if (workspaceDataSource.isInitialized) {
        await workspaceDataSource.destroy();
      }
      if (coreDataSource.isInitialized) {
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
          primaryPhoneNumber: '5514552571',
          primaryPhoneCountryCode: 'MX',
          primaryPhoneCallingCode: '+52',
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
