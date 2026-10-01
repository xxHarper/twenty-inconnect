import { FieldActorSource, FieldMetadataType } from 'twenty-shared/types';
import { type DataSource, type EntityManager } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InconnectRecordAccessException } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { InconnectMessagingAutoCreatePrimaryStatusDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  InconnectMessagingAutoCreateAuthorityException,
  InconnectMessagingAutoCreateAuthorityExceptionCode,
} from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import {
  type InconnectMessagingAutoCreateAuthority,
  InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { type InconnectMessagingAutoCreateEligibilityService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { type InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';
import { INCONNECT_MESSAGING_SYSTEM_PHONE_IDENTITY_RECORD_CREATION_ACTOR } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';
import { INCONNECT_MESSAGING_AUTO_CREATE_SYSTEM_ACTOR_NAME } from 'src/modules/inconnect-messaging/utils/build-inconnect-messaging-auto-create-system-actor.util';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '11111111-1111-4111-8111-222222222222';
const ANCHOR_OBJECT_ID = '22222222-2222-4222-8222-111111111111';
const OTHER_OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_MEMBER_OBJECT_ID = '22222222-2222-4222-8222-333333333333';
const OWNER_ROLE_ID = '33333333-3333-4333-8333-111111111111';
const OWNER_WORKSPACE_MEMBER_ID = '44444444-4444-4444-8444-111111111111';
const OTHER_OWNER_WORKSPACE_MEMBER_ID = '44444444-4444-4444-8444-222222222222';
const PRIMARY_IDENTITY_ID = '55555555-5555-4555-8555-111111111111';
const PRIMARY_FIELD_ID = '66666666-6666-4666-8666-111111111111';
const OWNER_FIELD_ID = '66666666-6666-4666-8666-222222222222';
const WORKSPACE_SCHEMA = 'workspace_11111111-1111-4111-8111-111111111111';

const configuration = {
  workspaceId: WORKSPACE_ID,
  anchorObjectMetadataId: ANCHOR_OBJECT_ID,
  revision: '17',
  autoCreateEnabled: true,
  autoCreateAnchorObjectMetadataId: ANCHOR_OBJECT_ID,
  autoCreateOwnerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
  autoCreateOwnerRoleId: OWNER_ROLE_ID,
  autoCreateLabelPolicy: 'OMIT',
  updatedAt: new Date('2026-10-01T12:00:00.000Z'),
} as InconnectMessagingConfigurationEntity;

const anchorObject = {
  id: ANCHOR_OBJECT_ID,
  workspaceId: WORKSPACE_ID,
  nameSingular: 'lead',
  isActive: true,
  isRemote: false,
} as ObjectMetadataEntity;

const workspaceMemberObject = {
  id: WORKSPACE_MEMBER_OBJECT_ID,
  workspaceId: WORKSPACE_ID,
} as ObjectMetadataEntity;

const primaryField = {
  id: PRIMARY_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: ANCHOR_OBJECT_ID,
  name: 'phone',
  type: FieldMetadataType.PHONES,
  isActive: true,
} as FieldMetadataEntity;

const ownerField = {
  id: OWNER_FIELD_ID,
  workspaceId: WORKSPACE_ID,
  objectMetadataId: ANCHOR_OBJECT_ID,
  name: 'owner',
  type: FieldMetadataType.RELATION,
  isActive: true,
  relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
  settings: { relationType: RelationType.MANY_TO_ONE },
} as FieldMetadataEntity;

type LockedQueryBuilder = {
  setLock: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  getOne: jest.Mock;
  getMany: jest.Mock;
};

const buildLockedQueryBuilder = ({
  one = null,
  many = [],
}: {
  one?: unknown;
  many?: unknown[];
} = {}): LockedQueryBuilder => {
  const builder = {
    setLock: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getOne: jest.fn().mockResolvedValue(one),
    getMany: jest.fn().mockResolvedValue(many),
  };

  builder.setLock.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.addOrderBy.mockReturnValue(builder);

  return builder;
};

const buildHarness = ({
  candidateIds = [OWNER_WORKSPACE_MEMBER_ID],
  transactionIds = ['transaction-1', 'transaction-1'],
}: {
  candidateIds?: string[];
  transactionIds?: string[];
} = {}) => {
  const buildersByAlias: Record<string, LockedQueryBuilder> = {
    configuration: buildLockedQueryBuilder({ one: configuration }),
    workspace: buildLockedQueryBuilder({
      one: { id: WORKSPACE_ID, databaseSchema: WORKSPACE_SCHEMA },
    }),
    anchorObject: buildLockedQueryBuilder({ one: anchorObject }),
    workspaceMemberObject: buildLockedQueryBuilder({
      one: workspaceMemberObject,
    }),
    field: buildLockedQueryBuilder({ many: [primaryField, ownerField] }),
    phoneIdentityField: buildLockedQueryBuilder({
      many: [
        {
          id: PRIMARY_IDENTITY_ID,
          workspaceId: WORKSPACE_ID,
          objectMetadataId: ANCHOR_OBJECT_ID,
          fieldMetadataId: PRIMARY_FIELD_ID,
          role: 'PRIMARY',
          ordinal: 0,
        },
      ],
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [
      InconnectMessagingConfigurationEntity,
      {
        createQueryBuilder: jest.fn(() => buildersByAlias.configuration),
      },
    ],
    [
      WorkspaceEntity,
      { createQueryBuilder: jest.fn(() => buildersByAlias.workspace) },
    ],
    [
      ObjectMetadataEntity,
      {
        createQueryBuilder: jest.fn((alias: string) => buildersByAlias[alias]),
      },
    ],
    [
      RoleEntity,
      {
        findOne: jest.fn().mockResolvedValue({
          id: OWNER_ROLE_ID,
          workspaceId: WORKSPACE_ID,
          canBeAssignedToUsers: true,
        }),
      },
    ],
    [
      FieldMetadataEntity,
      { createQueryBuilder: jest.fn(() => buildersByAlias.field) },
    ],
    [
      InconnectMessagingPhoneIdentityFieldEntity,
      {
        createQueryBuilder: jest.fn(() => buildersByAlias.phoneIdentityField),
      },
    ],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  } as unknown as EntityManager;
  let transactionIdIndex = 0;
  const queryRunner = {
    isReleased: false,
    isTransactionActive: true,
    query: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('txid_current')) {
        const transactionId =
          transactionIds[transactionIdIndex] ??
          transactionIds[transactionIds.length - 1];

        transactionIdIndex += 1;

        return Promise.resolve([{ transactionId }]);
      }

      if (sql.includes('FROM "core"."role"')) {
        return Promise.resolve([{ id: OWNER_ROLE_ID }]);
      }

      if (sql.includes('workspace_member."id"')) {
        return Promise.resolve(candidateIds.map((id) => ({ id })));
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as WorkspaceQueryRunner;
  const dataSource = {
    createEntityManager: jest.fn().mockReturnValue(manager),
  } as unknown as DataSource;
  const eligibilityService = {
    evaluate: jest.fn().mockResolvedValue({
      status: 'ELIGIBLE',
      reason: null,
      phoneUniquenessScope: 'ALL_ROWS',
    }),
  } as unknown as InconnectMessagingAutoCreateEligibilityService;
  const primaryValidatorService = {
    evaluate: jest.fn().mockResolvedValue({
      summary: {
        status: InconnectMessagingAutoCreatePrimaryStatusDTO.VALID,
        fieldMetadataId: PRIMARY_FIELD_ID,
        label: 'Phone',
        type: FieldMetadataType.PHONES,
        isActive: true,
      },
      issue: null,
    }),
  } as unknown as InconnectMessagingAutoCreatePrimaryValidatorService;
  const service = new InconnectMessagingAutoCreateAuthorityService(
    dataSource,
    eligibilityService,
    primaryValidatorService,
  );

  return {
    buildersByAlias,
    dataSource,
    eligibilityService,
    manager,
    queryRunner,
    service,
  };
};

describe('InconnectMessagingAutoCreateAuthorityService', () => {
  it('issues an exact transaction-bound authority with system provenance', async () => {
    const harness = buildHarness();

    const authority = await harness.service.issueAuthority({
      workspaceId: WORKSPACE_ID,
      queryRunner: harness.queryRunner,
    });
    const plan = await harness.service.resolveCreatePlan({
      authority,
      queryRunner: harness.queryRunner,
      workspaceId: WORKSPACE_ID,
    });

    expect(plan).toMatchObject({
      purpose: INCONNECT_MESSAGING_SYSTEM_PHONE_IDENTITY_RECORD_CREATION_ACTOR,
      workspaceId: WORKSPACE_ID,
      objectMetadataId: ANCHOR_OBJECT_ID,
      configurationRevision: '17',
      primaryPhoneIdentityFieldId: PRIMARY_IDENTITY_ID,
      primaryPhoneFieldMetadataId: PRIMARY_FIELD_ID,
      ownerRoleId: OWNER_ROLE_ID,
      ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
      ownerFieldMetadataId: OWNER_FIELD_ID,
      allowedFieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
      actor: {
        source: FieldActorSource.SYSTEM,
        workspaceMemberId: null,
        name: INCONNECT_MESSAGING_AUTO_CREATE_SYSTEM_ACTOR_NAME,
        context: {},
      },
    });
    expect(plan.actor.workspaceMemberId).not.toBe(plan.ownerWorkspaceMemberId);
    expect(harness.dataSource.createEntityManager).toHaveBeenCalledWith(
      harness.queryRunner,
    );
    expect(harness.eligibilityService.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ manager: harness.manager }),
    );
    expect(
      Object.values(harness.buildersByAlias).every((builder) =>
        builder.setLock.mock.calls.some(
          ([lockMode]) => lockMode === 'pessimistic_read',
        ),
      ),
    ).toBe(true);
  });

  it('accepts only the exact bound object, owner, and field allowlist', async () => {
    const { queryRunner, service } = buildHarness();
    const authority = await service.issueAuthority({
      workspaceId: WORKSPACE_ID,
      queryRunner,
    });

    await expect(
      service.assertCreateScope({
        authority,
        queryRunner,
        workspaceId: WORKSPACE_ID,
        objectMetadataId: ANCHOR_OBJECT_ID,
        ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
        fieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
      }),
    ).resolves.toMatchObject({ objectMetadataId: ANCHOR_OBJECT_ID });

    for (const mismatchedScope of [
      {
        workspaceId: WORKSPACE_ID,
        objectMetadataId: OTHER_OBJECT_ID,
        ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
        fieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
      },
      {
        workspaceId: WORKSPACE_ID,
        objectMetadataId: ANCHOR_OBJECT_ID,
        ownerWorkspaceMemberId: OTHER_OWNER_WORKSPACE_MEMBER_ID,
        fieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID],
      },
      {
        workspaceId: WORKSPACE_ID,
        objectMetadataId: ANCHOR_OBJECT_ID,
        ownerWorkspaceMemberId: OWNER_WORKSPACE_MEMBER_ID,
        fieldMetadataIds: [PRIMARY_FIELD_ID, OWNER_FIELD_ID, 'arbitrary-field'],
      },
    ]) {
      await expect(
        service.assertCreateScope({
          authority,
          queryRunner,
          ...mismatchedScope,
        }),
      ).rejects.toMatchObject({
        code: InconnectMessagingAutoCreateAuthorityExceptionCode.SCOPE_MISMATCH,
      });
    }

    await expect(
      service.resolveCreatePlan({
        authority,
        queryRunner,
        workspaceId: OTHER_WORKSPACE_ID,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.SCOPE_MISMATCH,
    });
  });

  it('does not recognize a fabricated token from generic system or application code', async () => {
    const { queryRunner, service } = buildHarness();

    await expect(
      service.resolveCreatePlan({
        authority: {} as InconnectMessagingAutoCreateAuthority,
        queryRunner,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      }) as InconnectMessagingAutoCreateAuthorityException,
    );
  });

  it.each([
    ['zero', []],
    ['multiple', [OWNER_WORKSPACE_MEMBER_ID, OTHER_OWNER_WORKSPACE_MEMBER_ID]],
  ])(
    'fails closed when the configured owner Role has %s valid candidates',
    async (_label, candidateIds) => {
      const { queryRunner, service } = buildHarness({ candidateIds });

      await expect(
        service.issueAuthority({
          workspaceId: WORKSPACE_ID,
          queryRunner,
        }),
      ).rejects.toBeInstanceOf(InconnectRecordAccessException);
    },
  );

  it('rejects reuse after the exact issuing transaction changes', async () => {
    const { queryRunner, service } = buildHarness({
      transactionIds: ['transaction-1', 'transaction-2'],
    });
    const authority = await service.issueAuthority({
      workspaceId: WORKSPACE_ID,
      queryRunner,
    });

    await expect(
      service.resolveCreatePlan({
        authority,
        queryRunner,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toMatchObject({
      code: InconnectMessagingAutoCreateAuthorityExceptionCode.INVALID_TRANSACTION,
    });
  });
});
