import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import { type InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { validate } from 'src/engine/core-modules/twenty-config/config-variables';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const MANAGED_OBJECT_ID = '00000000-0000-4000-8000-000000000002';
const OBJECT_METADATA_ID = '00000000-0000-4000-8000-000000000003';
const OWNER_FIELD_METADATA_ID = '00000000-0000-4000-8000-000000000004';
const POLICY_ID = '00000000-0000-4000-8000-000000000005';
const ROLE_ID = '00000000-0000-4000-8000-000000000006';
const WORKSPACE_MEMBER_OBJECT_ID = '00000000-0000-4000-8000-000000000007';

const buildMaps = <TEntity extends { id: string; universalIdentifier: string }>(
  entities: TEntity[],
) =>
  ({
    byUniversalIdentifier: Object.fromEntries(
      entities.map((entity) => [entity.universalIdentifier, entity]),
    ),
    universalIdentifierById: Object.fromEntries(
      entities.map((entity) => [entity.id, entity.universalIdentifier]),
    ),
  }) as never;

const flatRoleMaps = buildMaps([
  {
    id: ROLE_ID,
    workspaceId: WORKSPACE_ID,
    universalIdentifier: 'role-universal-identifier',
  },
]);
const flatObjectMetadataMaps = buildMaps([
  {
    id: OBJECT_METADATA_ID,
    workspaceId: WORKSPACE_ID,
    universalIdentifier: 'object-universal-identifier',
    isActive: true,
  },
  {
    id: WORKSPACE_MEMBER_OBJECT_ID,
    workspaceId: WORKSPACE_ID,
    universalIdentifier: STANDARD_OBJECTS.workspaceMember.universalIdentifier,
    isActive: true,
  },
]);
const flatFieldMetadataMaps = buildMaps([
  {
    id: OWNER_FIELD_METADATA_ID,
    workspaceId: WORKSPACE_ID,
    objectMetadataId: OBJECT_METADATA_ID,
    universalIdentifier: 'owner-field-universal-identifier',
    name: 'owner',
    type: FieldMetadataType.RELATION,
    isActive: true,
    relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
    settings: { relationType: RelationType.MANY_TO_ONE },
  },
]);

const ENV_POLICY: InconnectRecordAccessWorkspacePolicy = {
  status: 'configured',
  managedObjectMetadataIds: ['env-object'],
  rules: [],
};

const DB_MANAGED_MAPS: InconnectRecordAccessPolicyMaps = {
  version: 1,
  status: 'valid',
  enforcementMode: 'MANAGED',
  revision: '7',
  managedObjects: [
    {
      id: MANAGED_OBJECT_ID,
      objectMetadataId: OBJECT_METADATA_ID,
      ownerFieldMetadataId: OWNER_FIELD_METADATA_ID,
      ownerFieldName: 'owner',
      ownerJoinColumnName: 'ownerId',
      ownerRequirement: 'required',
      policies: [
        {
          id: POLICY_ID,
          roleId: ROLE_ID,
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    },
  ],
};

const buildHarness = ({
  mode,
  cacheValue,
  cacheError,
}: {
  mode: 'env' | 'transition' | 'database';
  cacheValue?: unknown;
  cacheError?: Error;
}) => {
  const get = jest.fn(() => mode);
  const getOrRecompute = cacheError
    ? jest.fn().mockRejectedValue(cacheError)
    : jest.fn().mockResolvedValue({
        inconnectRecordAccessPolicyMaps: cacheValue,
      });
  const resolveWorkspacePolicy = jest.fn(() => ENV_POLICY);
  const service = new InconnectRecordAccessPolicySourceService(
    { get } as unknown as TwentyConfigService,
    { getOrRecompute } as unknown as WorkspaceCacheService,
    { resolveWorkspacePolicy } as unknown as InconnectRecordAccessService,
  );
  const args = {
    workspaceId: WORKSPACE_ID,
    flatRoleMaps,
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
  };

  return { args, getOrRecompute, resolveWorkspacePolicy, service };
};

describe('InconnectRecordAccessPolicySourceService', () => {
  it('defaults source mode to env and rejects unknown values at startup validation', () => {
    expect(validate({}).INCONNECT_RECORD_ACCESS_SOURCE_MODE).toBe('env');
    expect(() =>
      validate({
        INCONNECT_RECORD_ACCESS_SOURCE_MODE: 'unknown',
      }),
    ).toThrow('Config variables validation failed');
    expect(
      validate({
        INCONNECT_RECORD_ACCESS_SOURCE_MODE: 'transition',
      }).INCONNECT_RECORD_ACCESS_SOURCE_MODE,
    ).toBe('transition');
  });

  it.each([
    ['absent', { version: 1, status: 'absent' }],
    ['managed', DB_MANAGED_MAPS],
    [
      'invalid',
      {
        version: 1,
        status: 'invalid',
        reason: 'invalid DB',
        failureKind: 'invalid',
      },
    ],
    ['corrupt', { version: 2, status: 'valid' }],
  ])('uses only ENV in env mode when DB is %s', async (_name, cacheValue) => {
    const { args, getOrRecompute, resolveWorkspacePolicy, service } =
      buildHarness({ mode: 'env', cacheValue });

    await expect(service.resolveWorkspacePolicy(args)).resolves.toBe(
      ENV_POLICY,
    );
    expect(resolveWorkspacePolicy).toHaveBeenCalledTimes(1);
    expect(getOrRecompute).not.toHaveBeenCalled();
  });

  it('falls back to ENV in transition only when DB configuration is absent', async () => {
    const { args, resolveWorkspacePolicy, service } = buildHarness({
      mode: 'transition',
      cacheValue: { version: 1, status: 'absent' },
    });

    await expect(service.resolveWorkspacePolicy(args)).resolves.toBe(
      ENV_POLICY,
    );
    expect(resolveWorkspacePolicy).toHaveBeenCalledTimes(1);
  });

  it('uses valid MANAGED and UNMANAGED DB authority in transition', async () => {
    const managed = buildHarness({
      mode: 'transition',
      cacheValue: DB_MANAGED_MAPS,
    });
    const unmanaged = buildHarness({
      mode: 'transition',
      cacheValue: {
        version: 1,
        status: 'valid',
        enforcementMode: 'UNMANAGED',
        revision: '1',
      },
    });

    await expect(
      managed.service.resolveWorkspacePolicy(managed.args),
    ).resolves.toEqual({
      status: 'configured',
      managedObjectMetadataIds: [OBJECT_METADATA_ID],
      ruleByObjectMetadataIdAndRoleId: {
        [`${OBJECT_METADATA_ID}:${ROLE_ID}`]: {
          roleId: ROLE_ID,
          objectMetadataId: OBJECT_METADATA_ID,
          ownerFieldMetadataId: OWNER_FIELD_METADATA_ID,
          ownerFieldName: 'owner',
          ownerJoinColumnName: 'ownerId',
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      },
      rules: [
        {
          roleId: ROLE_ID,
          objectMetadataId: OBJECT_METADATA_ID,
          ownerFieldMetadataId: OWNER_FIELD_METADATA_ID,
          ownerFieldName: 'owner',
          ownerJoinColumnName: 'ownerId',
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          ownerRequirement: 'required',
          missingOwnerPolicy: 'requireExplicit',
        },
      ],
    });
    await expect(
      unmanaged.service.resolveWorkspacePolicy(unmanaged.args),
    ).resolves.toEqual({ status: 'unmanaged' });
    expect(managed.resolveWorkspacePolicy).not.toHaveBeenCalled();
    expect(unmanaged.resolveWorkspacePolicy).not.toHaveBeenCalled();
  });

  it('denies a structurally valid cache with stale metadata references', async () => {
    const staleMaps = structuredClone(DB_MANAGED_MAPS);

    staleMaps.managedObjects[0].objectMetadataId =
      '00000000-0000-4000-8000-000000000099';
    const { args, resolveWorkspacePolicy, service } = buildHarness({
      mode: 'transition',
      cacheValue: staleMaps,
    });

    await expect(service.resolveWorkspacePolicy(args)).resolves.toMatchObject({
      status: 'invalid',
    });
    expect(resolveWorkspacePolicy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid',
      {
        version: 1,
        status: 'invalid',
        reason: 'invalid DB',
        failureKind: 'invalid',
      },
    ],
    ['corrupt', { version: 2, status: 'valid' }],
    [
      'recomputation failed',
      {
        version: 1,
        status: 'invalid',
        reason: 'revoked',
        failureKind: 'recomputation-failed',
      },
    ],
  ])(
    'denies transition DB authority when cache is %s',
    async (_name, cacheValue) => {
      const { args, resolveWorkspacePolicy, service } = buildHarness({
        mode: 'transition',
        cacheValue,
      });

      await expect(service.resolveWorkspacePolicy(args)).resolves.toMatchObject(
        {
          status: 'invalid',
        },
      );
      expect(resolveWorkspacePolicy).not.toHaveBeenCalled();
    },
  );

  it.each(['transition', 'database'] as const)(
    'denies when shared cache is unavailable in %s mode',
    async (mode) => {
      const { args, resolveWorkspacePolicy, service } = buildHarness({
        mode,
        cacheError: new Error('Redis unavailable'),
      });

      await expect(service.resolveWorkspacePolicy(args)).resolves.toEqual({
        status: 'invalid',
        reason: 'INCONNECT database policy cache is unavailable',
      });
      expect(resolveWorkspacePolicy).not.toHaveBeenCalled();
    },
  );

  it('denies absent DB in database mode and ignores valid ENV', async () => {
    const { args, resolveWorkspacePolicy, service } = buildHarness({
      mode: 'database',
      cacheValue: { version: 1, status: 'absent' },
    });

    await expect(service.resolveWorkspacePolicy(args)).resolves.toEqual({
      status: 'invalid',
      reason: 'INCONNECT database configuration is absent',
    });
    expect(resolveWorkspacePolicy).not.toHaveBeenCalled();
  });

  it('uses valid MANAGED and UNMANAGED DB authority in database mode while ignoring ENV', async () => {
    const managed = buildHarness({
      mode: 'database',
      cacheValue: DB_MANAGED_MAPS,
    });
    const unmanaged = buildHarness({
      mode: 'database',
      cacheValue: {
        version: 1,
        status: 'valid',
        enforcementMode: 'UNMANAGED',
        revision: '1',
      },
    });

    await expect(
      managed.service.resolveWorkspacePolicy(managed.args),
    ).resolves.toMatchObject({
      status: 'configured',
      managedObjectMetadataIds: [OBJECT_METADATA_ID],
    });
    await expect(
      unmanaged.service.resolveWorkspacePolicy(unmanaged.args),
    ).resolves.toEqual({ status: 'unmanaged' });
    expect(managed.resolveWorkspacePolicy).not.toHaveBeenCalled();
    expect(unmanaged.resolveWorkspacePolicy).not.toHaveBeenCalled();
  });

  it('denies corrupt DB authority in database mode instead of using ENV', async () => {
    const { args, resolveWorkspacePolicy, service } = buildHarness({
      mode: 'database',
      cacheValue: { version: 99, status: 'valid' },
    });

    await expect(service.resolveWorkspacePolicy(args)).resolves.toMatchObject({
      status: 'invalid',
    });
    expect(resolveWorkspacePolicy).not.toHaveBeenCalled();
  });
});
