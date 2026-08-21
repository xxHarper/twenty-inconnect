import { type DataSource, type EntityManager } from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { InconnectRecordAccessConfigurationExceptionCode } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { type InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import { InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { type InconnectRecordAccessConfigurationSetInput } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const OBJECT_ID = '00000000-0000-4000-8000-000000000002';
const FIELD_ID = '00000000-0000-4000-8000-000000000003';
const ROLE_ID = '00000000-0000-4000-8000-000000000004';
const MANAGED_OBJECT_ID = '00000000-0000-4000-8000-000000000005';
const POLICY_ID = '00000000-0000-4000-8000-000000000006';

const MANAGED_INPUT: InconnectRecordAccessConfigurationSetInput = {
  enforcementMode: 'MANAGED',
  managedObjects: [
    {
      objectMetadataId: OBJECT_ID,
      ownerFieldMetadataId: FIELD_ID,
      ownerRequirement: 'required',
    },
  ],
  policies: [
    {
      objectMetadataId: OBJECT_ID,
      roleId: ROLE_ID,
      recordEffect: 'ownRecords',
      createPolicy: 'denied',
      ownerTransferPolicy: 'denied',
      missingOwnerPolicy: 'requireExplicit',
    },
  ],
};

type PersistedState = {
  configuration:
    | {
        workspaceId: string;
        enforcementMode: 'MANAGED' | 'UNMANAGED';
        revision: string;
      }
    | undefined;
  managedObjects: Array<Record<string, unknown>>;
  policies: Array<Record<string, unknown>>;
};

type FailurePoint =
  | 'configuration-save'
  | 'managed-object-save'
  | 'policy-save';

const buildHarness = ({
  initialRevision,
  initialEnforcementMode = 'MANAGED',
  failurePoint,
}: {
  initialRevision?: string;
  initialEnforcementMode?: 'MANAGED' | 'UNMANAGED';
  failurePoint?: FailurePoint;
} = {}) => {
  let state: PersistedState = {
    configuration: initialRevision
      ? {
          workspaceId: WORKSPACE_ID,
          enforcementMode: initialEnforcementMode,
          revision: initialRevision,
        }
      : undefined,
    managedObjects: initialRevision ? [{ old: 'managed' }] : [],
    policies: initialRevision ? [{ old: 'policy' }] : [],
  };
  let transactionTail = Promise.resolve();
  const lockCalls: string[] = [];
  const buildValidatedCandidate = jest.fn(
    async ({
      workspaceId,
      revision,
      input,
    }: {
      workspaceId: string;
      revision: string;
      input: InconnectRecordAccessConfigurationSetInput;
    }) => ({
      configuration: {
        workspaceId,
        enforcementMode: input.enforcementMode,
        revision,
      },
      managedObjects: input.managedObjects.map((managedObject) => ({
        id: MANAGED_OBJECT_ID,
        workspaceId,
        ...managedObject,
      })),
      policies: input.policies.map((policy) => ({
        id: POLICY_ID,
        workspaceId,
        managedObjectId: MANAGED_OBJECT_ID,
        roleId: policy.roleId,
        principalType: 'WORKSPACE_MEMBER',
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        defaultOwnerRoleId: policy.defaultOwnerRoleId ?? null,
      })),
      roles: [],
      objects: [],
      fields: [],
    }),
  );
  const revokeGenerationFencedEntries = jest
    .fn()
    .mockResolvedValue({ inconnectRecordAccessPolicyMaps: 10 });
  const recomputeGenerationFencedEntries = jest
    .fn()
    .mockResolvedValue(undefined);

  const buildManager = (draft: PersistedState): EntityManager =>
    ({
      getRepository: jest.fn((entity) => {
        if (entity === WorkspaceEntity) {
          return {
            findOne: jest.fn(async (options) => {
              lockCalls.push(options.lock?.mode ?? 'none');

              return { id: WORKSPACE_ID };
            }),
          };
        }

        if (entity === InconnectRecordAccessConfigurationEntity) {
          return {
            findOne: jest.fn(async (options) => {
              lockCalls.push(options.lock?.mode ?? 'none');

              return draft.configuration ? { ...draft.configuration } : null;
            }),
            save: jest.fn(async (configuration) => {
              if (failurePoint === 'configuration-save') {
                throw new Error('configuration save failed');
              }

              draft.configuration = {
                workspaceId: configuration.workspaceId,
                enforcementMode: configuration.enforcementMode,
                revision: configuration.revision,
              };

              return configuration;
            }),
          };
        }

        if (entity === InconnectRecordAccessManagedObjectEntity) {
          return {
            delete: jest.fn(async () => {
              draft.managedObjects = [];
            }),
            save: jest.fn(async (managedObjects) => {
              if (failurePoint === 'managed-object-save') {
                throw new Error('managed object save failed');
              }

              draft.managedObjects = structuredClone(managedObjects);

              return managedObjects;
            }),
          };
        }

        if (entity === InconnectRecordAccessPolicyEntity) {
          return {
            delete: jest.fn(async () => {
              draft.policies = [];
            }),
            save: jest.fn(async (policies) => {
              if (failurePoint === 'policy-save') {
                throw new Error('policy save failed');
              }

              draft.policies = structuredClone(policies);

              return policies;
            }),
          };
        }

        throw new Error('Unexpected repository');
      }),
    }) as unknown as EntityManager;

  const transaction = jest.fn(
    async (operation: (manager: EntityManager) => Promise<unknown>) => {
      let releaseTransaction: () => void = () => undefined;
      const priorTransaction = transactionTail;

      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      await priorTransaction;

      const draft = structuredClone(state);

      try {
        const result = await operation(buildManager(draft));

        state = draft;

        return result;
      } finally {
        releaseTransaction();
      }
    },
  );
  const service = new InconnectRecordAccessConfigurationService(
    { transaction } as unknown as DataSource,
    {
      buildValidatedCandidate,
    } as unknown as InconnectRecordAccessConfigurationCandidateService,
    {
      revokeGenerationFencedEntries,
      recomputeGenerationFencedEntries,
    } as unknown as WorkspaceCacheService,
  );

  return {
    buildValidatedCandidate,
    getState: () => structuredClone(state),
    lockCalls,
    recomputeGenerationFencedEntries,
    revokeGenerationFencedEntries,
    service,
  };
};

describe('InconnectRecordAccessConfigurationService', () => {
  it('publishes an initial complete set at revision 1', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...MANAGED_INPUT,
      }),
    ).resolves.toEqual({
      revision: '1',
      cacheStatus: 'recomputed',
      changedFromManagedToUnmanaged: false,
    });

    expect(harness.getState()).toMatchObject({
      configuration: {
        workspaceId: WORKSPACE_ID,
        enforcementMode: 'MANAGED',
        revision: '1',
      },
      managedObjects: [{ objectMetadataId: OBJECT_ID }],
      policies: [{ roleId: ROLE_ID }],
    });
    expect(harness.lockCalls).toEqual([
      'pessimistic_write',
      'pessimistic_write',
    ]);
  });

  it('increments a matching bigint string revision and rejects stale revisions', async () => {
    const harness = buildHarness({ initialRevision: '41' });

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: '41',
        ...MANAGED_INPUT,
      }),
    ).resolves.toMatchObject({ revision: '42' });

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: '41',
        ...MANAGED_INPUT,
      }),
    ).rejects.toMatchObject({
      code: InconnectRecordAccessConfigurationExceptionCode.REVISION_CONFLICT,
    });
    expect(harness.getState().configuration?.revision).toBe('42');
  });

  it('serializes concurrent initial publishers so exactly one claims the workspace', async () => {
    const harness = buildHarness();
    const publish = () =>
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...MANAGED_INPUT,
      });
    const results = await Promise.allSettled([publish(), publish()]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(harness.getState().configuration?.revision).toBe('1');
  });

  it.each([
    'configuration-save',
    'managed-object-save',
    'policy-save',
  ] as const)(
    'rolls back the complete set when %s fails',
    async (failurePoint) => {
      const harness = buildHarness({ failurePoint });
      const before = harness.getState();

      await expect(
        harness.service.replaceConfiguration({
          workspaceId: WORKSPACE_ID,
          expectedRevision: null,
          ...MANAGED_INPUT,
        }),
      ).rejects.toThrow();
      expect(harness.getState()).toEqual(before);
      expect(harness.recomputeGenerationFencedEntries).toHaveBeenCalledWith(
        WORKSPACE_ID,
        { inconnectRecordAccessPolicyMaps: 10 },
      );
    },
  );

  it('does not write when validation fails', async () => {
    const harness = buildHarness();

    harness.buildValidatedCandidate.mockRejectedValueOnce(
      new Error('invalid candidate'),
    );
    const before = harness.getState();

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...MANAGED_INPUT,
      }),
    ).rejects.toThrow('invalid candidate');
    expect(harness.getState()).toEqual(before);
    expect(harness.revokeGenerationFencedEntries).not.toHaveBeenCalled();
  });

  it.each([
    ['MANAGED empty', { ...MANAGED_INPUT, managedObjects: [], policies: [] }],
    [
      'UNMANAGED with children',
      { ...MANAGED_INPUT, enforcementMode: 'UNMANAGED' as const },
    ],
    ['cross-workspace reference', MANAGED_INPUT],
    ['default Role mismatch', MANAGED_INPUT],
  ])('does not publish an invalid candidate: %s', async (_name, input) => {
    const harness = buildHarness();

    harness.buildValidatedCandidate.mockRejectedValueOnce(
      new Error('candidate rejected'),
    );

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...input,
      }),
    ).rejects.toThrow('candidate rejected');
    expect(harness.revokeGenerationFencedEntries).not.toHaveBeenCalled();
    expect(harness.getState().configuration).toBeUndefined();
  });

  it('persists a Managed Object with zero Policies', async () => {
    const harness = buildHarness();

    await harness.service.replaceConfiguration({
      workspaceId: WORKSPACE_ID,
      expectedRevision: null,
      enforcementMode: 'MANAGED',
      managedObjects: MANAGED_INPUT.managedObjects,
      policies: [],
    });

    expect(harness.getState().managedObjects).toHaveLength(1);
    expect(harness.getState().policies).toHaveLength(0);
  });

  it('supports explicit MANAGED to UNMANAGED security expansion', async () => {
    const harness = buildHarness({ initialRevision: '7' });

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: '7',
        enforcementMode: 'UNMANAGED',
        managedObjects: [],
        policies: [],
      }),
    ).resolves.toMatchObject({
      revision: '8',
      changedFromManagedToUnmanaged: true,
    });
    expect(harness.getState()).toMatchObject({
      configuration: { enforcementMode: 'UNMANAGED' },
      managedObjects: [],
      policies: [],
    });
  });

  it('aborts before DB writes when cache revocation fails', async () => {
    const harness = buildHarness();

    harness.revokeGenerationFencedEntries.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...MANAGED_INPUT,
      }),
    ).rejects.toThrow('Redis unavailable');
    expect(harness.getState().configuration).toBeUndefined();
  });

  it('returns committed state and fail-closed cache status when post-commit recompute fails', async () => {
    const harness = buildHarness();

    harness.recomputeGenerationFencedEntries.mockRejectedValueOnce(
      new Error('recompute failed'),
    );

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        ...MANAGED_INPUT,
      }),
    ).resolves.toMatchObject({
      revision: '1',
      cacheStatus: 'recomputation-failed',
    });
    expect(harness.getState().configuration?.revision).toBe('1');
  });

  it('passes each publish generation to fenced recompute so stale publication loses CAS', async () => {
    const harness = buildHarness({ initialRevision: '1' });
    let generation = 9;
    let releaseFirstRecompute: () => void = () => undefined;
    let markFirstRecomputeStarted: () => void = () => undefined;
    const firstRecompute = new Promise<void>((resolve) => {
      releaseFirstRecompute = resolve;
    });
    const firstRecomputeStarted = new Promise<void>((resolve) => {
      markFirstRecomputeStarted = resolve;
    });

    harness.revokeGenerationFencedEntries.mockImplementation(async () => ({
      inconnectRecordAccessPolicyMaps: (generation += 1),
    }));
    harness.recomputeGenerationFencedEntries
      .mockImplementationOnce(async () => {
        markFirstRecomputeStarted();

        return firstRecompute;
      })
      .mockResolvedValueOnce(undefined);

    const publishA = harness.service.replaceConfiguration({
      workspaceId: WORKSPACE_ID,
      expectedRevision: '1',
      ...MANAGED_INPUT,
    });

    await firstRecomputeStarted;

    const publishB = harness.service.replaceConfiguration({
      workspaceId: WORKSPACE_ID,
      expectedRevision: '2',
      ...MANAGED_INPUT,
    });

    await expect(publishB).resolves.toMatchObject({ revision: '3' });
    releaseFirstRecompute();
    await expect(publishA).resolves.toMatchObject({ revision: '2' });
    expect(harness.recomputeGenerationFencedEntries.mock.calls).toEqual([
      [WORKSPACE_ID, { inconnectRecordAccessPolicyMaps: 10 }],
      [WORKSPACE_ID, { inconnectRecordAccessPolicyMaps: 11 }],
    ]);
  });
});
