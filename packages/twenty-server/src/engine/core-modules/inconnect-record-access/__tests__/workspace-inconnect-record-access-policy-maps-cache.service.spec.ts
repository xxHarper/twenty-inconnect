import { type DataSource, type EntityManager } from 'typeorm';

import { createEightRulePersistedCandidateFixture } from 'src/engine/core-modules/inconnect-record-access/__tests__/fixtures/inconnect-record-access-persisted-candidate.fixture';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { WorkspaceInconnectRecordAccessPolicyMapsCacheService } from 'src/engine/core-modules/inconnect-record-access/services/workspace-inconnect-record-access-policy-maps-cache.service';
import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  WORKSPACE_CACHE_KEY,
  WORKSPACE_CACHE_OPTIONS,
} from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';

const buildService = (
  candidate: InconnectRecordAccessPersistedCandidate | undefined,
) => {
  const query = jest.fn().mockResolvedValue(undefined);
  const findOne = jest.fn(async () =>
    candidate
      ? {
          ...candidate.configuration,
          revision: String(candidate.configuration.revision),
        }
      : null,
  );
  const find = jest.fn(async (entity: unknown) => {
    if (!candidate) {
      return [];
    }

    if (entity === InconnectRecordAccessManagedObjectEntity) {
      return candidate.managedObjects;
    }
    if (entity === InconnectRecordAccessPolicyEntity) {
      return candidate.policies;
    }
    if (entity === RoleEntity) {
      return candidate.roles;
    }
    if (entity === FieldMetadataEntity) {
      return candidate.fields;
    }
    if (entity === ObjectMetadataEntity) {
      return candidate.objects;
    }

    throw new Error('Unexpected repository');
  });
  const getRepository = jest.fn((entity) => ({
    find: jest.fn(() => find(entity)),
    findOne:
      entity === InconnectRecordAccessConfigurationEntity ? findOne : jest.fn(),
  }));
  const manager = { getRepository, query } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolation: string,
      operation: (transactionManager: EntityManager) => unknown,
    ) => {
      expect(isolation).toBe('REPEATABLE READ');

      return operation(manager);
    },
  );
  const dataSource = { transaction } as unknown as DataSource;

  return {
    find,
    findOne,
    getRepository,
    query,
    service: new WorkspaceInconnectRecordAccessPolicyMapsCacheService(
      dataSource,
    ),
    transaction,
  };
};

describe('WorkspaceInconnectRecordAccessPolicyMapsCacheService', () => {
  it('builds the current two-object/eight-policy configuration in one read-only snapshot without N+1', async () => {
    const candidate = createEightRulePersistedCandidateFixture();
    const { find, query, service, transaction } = buildService(candidate);

    const result = await service.computeForCache(
      candidate.configuration.workspaceId,
    );

    expect(result).toMatchObject({
      version: 1,
      status: 'valid',
      enforcementMode: 'MANAGED',
      revision: '1',
    });
    expect(
      result.status === 'valid' &&
        result.enforcementMode === 'MANAGED' &&
        result.managedObjects,
    ).toHaveLength(2);
    expect(
      result.status === 'valid' &&
        result.enforcementMode === 'MANAGED' &&
        result.managedObjects.flatMap(
          (managedObject) => managedObject.policies,
        ),
    ).toHaveLength(8);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(find).toHaveBeenCalledTimes(5);
  });

  it('represents a missing Configuration as database absent', async () => {
    const { find, service } = buildService(undefined);

    await expect(
      service.computeForCache('00000000-0000-4000-8000-000000000099'),
    ).resolves.toEqual({ version: 1, status: 'absent' });
    expect(find).not.toHaveBeenCalled();
  });

  it('accepts explicit UNMANAGED only without child rows', async () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.configuration.enforcementMode = 'UNMANAGED';
    candidate.managedObjects = [];
    candidate.policies = [];
    candidate.roles = [];
    candidate.objects = [];
    candidate.fields = [];

    const { service } = buildService(candidate);

    await expect(
      service.computeForCache(candidate.configuration.workspaceId),
    ).resolves.toEqual({
      version: 1,
      status: 'valid',
      enforcementMode: 'UNMANAGED',
      revision: '1',
    });
  });

  it('fails closed when persisted references are invalid', async () => {
    const candidate = createEightRulePersistedCandidateFixture();

    candidate.objects = candidate.objects.filter(
      (objectMetadata) =>
        objectMetadata.id !== candidate.managedObjects[0].objectMetadataId,
    );
    const { service } = buildService(candidate);

    await expect(
      service.computeForCache(candidate.configuration.workspaceId),
    ).resolves.toMatchObject({
      version: 1,
      status: 'invalid',
      failureKind: 'invalid',
    });
  });

  it('decodes corrupt Redis data and invalidates failed recomputations as denied states', () => {
    const { service } = buildService(undefined);

    expect(service.decodeFromCacheStorage({ version: 2 })).toMatchObject({
      status: 'invalid',
      failureKind: 'corrupt',
    });
    expect(service.getInvalidationValue('post-commit failure')).toEqual({
      version: 1,
      status: 'invalid',
      reason: 'post-commit failure',
      failureKind: 'recomputation-failed',
    });
  });

  it('registers strict shared generation-fenced cache authority', () => {
    expect(
      Reflect.getMetadata(
        WORKSPACE_CACHE_KEY,
        WorkspaceInconnectRecordAccessPolicyMapsCacheService,
      ),
    ).toBe('inconnectRecordAccessPolicyMaps');
    expect(
      Reflect.getMetadata(
        WORKSPACE_CACHE_OPTIONS,
        WorkspaceInconnectRecordAccessPolicyMapsCacheService,
      ),
    ).toEqual({
      generationFenced: true,
      strictSharedCache: true,
    });
  });
});
