import { type DataSource, type EntityManager } from 'typeorm';

import { FieldMetadataType } from 'twenty-shared/types';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { type InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import { type InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { InconnectRecordAccessEnvironmentImportService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-environment-import.service';
import { type InconnectRecordAccessConfig } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_MEMBER_OBJECT_ID = '00000000-0000-4000-8000-000000000002';
const LEAD_OBJECT_ID = '00000000-0000-4000-8000-000000000003';
const FOLIO_OBJECT_ID = '00000000-0000-4000-8000-000000000004';
const LEAD_OWNER_FIELD_ID = '00000000-0000-4000-8000-000000000005';
const FOLIO_OWNER_FIELD_ID = '00000000-0000-4000-8000-000000000006';
const EXECUTIVE_ROLE_ID = '00000000-0000-4000-8000-000000000007';
const COORDINATOR_ROLE_ID = '00000000-0000-4000-8000-000000000008';
const SUPERVISOR_ROLE_ID = '00000000-0000-4000-8000-000000000009';
const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000010';

const roleDefinitions = [
  {
    id: EXECUTIVE_ROLE_ID,
    universalIdentifier: 'role-executive',
    label: 'Ejecutivo INCONNECT',
  },
  {
    id: COORDINATOR_ROLE_ID,
    universalIdentifier: 'role-coordinator',
    label: 'Coordinador INCONNECT',
  },
  {
    id: SUPERVISOR_ROLE_ID,
    universalIdentifier: 'role-supervisor',
    label: 'Supervisor INCONNECT',
  },
  { id: ADMIN_ROLE_ID, universalIdentifier: 'role-admin', label: 'Admin' },
].map((role) => ({ ...role, workspaceId: WORKSPACE_ID }));

const objectDefinitions = [
  {
    id: WORKSPACE_MEMBER_OBJECT_ID,
    universalIdentifier: 'object-workspace-member',
    nameSingular: 'workspaceMember',
    labelSingular: 'Workspace Member',
  },
  {
    id: LEAD_OBJECT_ID,
    universalIdentifier: 'object-lead',
    nameSingular: 'lead',
    labelSingular: 'Lead',
  },
  {
    id: FOLIO_OBJECT_ID,
    universalIdentifier: 'object-folio',
    nameSingular: 'folioIso',
    labelSingular: 'Folio ISO',
  },
].map((object) => ({ ...object, workspaceId: WORKSPACE_ID, isActive: true }));

const fieldDefinitions = [
  {
    id: LEAD_OWNER_FIELD_ID,
    universalIdentifier: 'field-lead-owner',
    objectMetadataId: LEAD_OBJECT_ID,
    name: 'leadOwner',
    label: 'Propietario de lead',
  },
  {
    id: FOLIO_OWNER_FIELD_ID,
    universalIdentifier: 'field-folio-owner',
    objectMetadataId: FOLIO_OBJECT_ID,
    name: 'folioOwner',
    label: 'Propietario de Folio',
  },
].map((field) => ({
  ...field,
  workspaceId: WORKSPACE_ID,
  type: FieldMetadataType.RELATION,
  settings: { relationType: RelationType.MANY_TO_ONE },
  relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
  isActive: true,
}));

const rule = ({
  roleUniversalIdentifier,
  objectUniversalIdentifier,
  ownerFieldUniversalIdentifier,
  recordEffect,
  createPolicy,
  ownerTransferPolicy,
  missingOwnerPolicy,
  defaultOwnerRoleUniversalIdentifier,
}: {
  roleUniversalIdentifier: string;
  objectUniversalIdentifier: string;
  ownerFieldUniversalIdentifier: string;
  recordEffect: 'ownRecords' | 'ownAndTeamRecords' | 'allRecords';
  createPolicy: 'denied' | 'defaultOwner' | 'standardPermissionsOnly';
  ownerTransferPolicy: 'denied' | 'standardPermissionsOnly';
  missingOwnerPolicy: 'self' | 'requireExplicit' | 'singleActiveMemberOfRole';
  defaultOwnerRoleUniversalIdentifier?: string;
}) => ({
  roleUniversalIdentifier,
  objectUniversalIdentifier,
  ownerFieldUniversalIdentifier,
  principal: 'workspaceMember' as const,
  recordEffect,
  createPolicy,
  ownerTransferPolicy,
  ownerRequirement: 'required' as const,
  missingOwnerPolicy,
  ...(defaultOwnerRoleUniversalIdentifier
    ? { defaultOwnerRoleUniversalIdentifier }
    : {}),
});

const buildEightRuleConfig = (): InconnectRecordAccessConfig => ({
  workspaces: [
    {
      workspaceId: WORKSPACE_ID,
      rules: [
        rule({
          roleUniversalIdentifier: 'role-executive',
          objectUniversalIdentifier: 'object-lead',
          ownerFieldUniversalIdentifier: 'field-lead-owner',
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
        }),
        rule({
          roleUniversalIdentifier: 'role-coordinator',
          objectUniversalIdentifier: 'object-lead',
          ownerFieldUniversalIdentifier: 'field-lead-owner',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
        }),
        ...['role-supervisor', 'role-admin'].map((roleUniversalIdentifier) =>
          rule({
            roleUniversalIdentifier,
            objectUniversalIdentifier: 'object-lead',
            ownerFieldUniversalIdentifier: 'field-lead-owner',
            recordEffect: 'allRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'standardPermissionsOnly',
            missingOwnerPolicy: 'singleActiveMemberOfRole',
            defaultOwnerRoleUniversalIdentifier: 'role-supervisor',
          }),
        ),
        rule({
          roleUniversalIdentifier: 'role-executive',
          objectUniversalIdentifier: 'object-folio',
          ownerFieldUniversalIdentifier: 'field-folio-owner',
          recordEffect: 'ownRecords',
          createPolicy: 'defaultOwner',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'self',
        }),
        rule({
          roleUniversalIdentifier: 'role-coordinator',
          objectUniversalIdentifier: 'object-folio',
          ownerFieldUniversalIdentifier: 'field-folio-owner',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'defaultOwner',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'self',
        }),
        ...['role-supervisor', 'role-admin'].map((roleUniversalIdentifier) =>
          rule({
            roleUniversalIdentifier,
            objectUniversalIdentifier: 'object-folio',
            ownerFieldUniversalIdentifier: 'field-folio-owner',
            recordEffect: 'allRecords',
            createPolicy: 'standardPermissionsOnly',
            ownerTransferPolicy: 'standardPermissionsOnly',
            missingOwnerPolicy: 'self',
          }),
        ),
      ],
    },
  ],
});

const buildHarness = ({
  config = buildEightRuleConfig(),
  workspaceExists = true,
  currentRevision = null,
  roles = roleDefinitions,
  objects = objectDefinitions,
  fields = fieldDefinitions,
}: {
  config?: unknown;
  workspaceExists?: boolean;
  currentRevision?: string | null;
  roles?: typeof roleDefinitions;
  objects?: typeof objectDefinitions;
  fields?: typeof fieldDefinitions;
} = {}) => {
  const query = jest.fn().mockResolvedValue(undefined);
  const repositories = new Map<unknown, unknown>([
    [
      WorkspaceEntity,
      {
        findOne: jest
          .fn()
          .mockResolvedValue(
            workspaceExists ? { id: WORKSPACE_ID, displayName: 'Apple' } : null,
          ),
      },
    ],
    [RoleEntity, { find: jest.fn().mockResolvedValue(roles) }],
    [ObjectMetadataEntity, { find: jest.fn().mockResolvedValue(objects) }],
    [FieldMetadataEntity, { find: jest.fn().mockResolvedValue(fields) }],
    [
      InconnectRecordAccessConfigurationEntity,
      {
        findOne: jest
          .fn()
          .mockResolvedValue(
            currentRevision === null
              ? null
              : { workspaceId: WORKSPACE_ID, revision: currentRevision },
          ),
      },
    ],
  ]);
  const manager = {
    query,
    getRepository: jest.fn((entity) => repositories.get(entity)),
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolation: string,
      operation: (entityManager: EntityManager) => Promise<unknown>,
    ) => {
      expect(isolation).toBe('REPEATABLE READ');

      return operation(manager);
    },
  );
  const candidate = {
    configuration: {
      workspaceId: WORKSPACE_ID,
      enforcementMode: 'MANAGED',
      revision: currentRevision === null ? '1' : '2',
    },
    managedObjects: [],
    policies: [],
    roles: [],
    objects: [],
    fields: [],
  };
  const buildValidatedCandidate = jest.fn().mockResolvedValue(candidate);
  const replaceConfiguration = jest.fn().mockResolvedValue({
    revision: '1',
    cacheStatus: 'recomputed',
    changedFromManagedToUnmanaged: false,
  });
  const envPolicyService = new InconnectRecordAccessService({
    get: jest.fn().mockReturnValue(config),
  } as unknown as TwentyConfigService);
  const service = new InconnectRecordAccessEnvironmentImportService(
    { transaction } as unknown as DataSource,
    envPolicyService,
    {
      buildValidatedCandidate,
    } as unknown as InconnectRecordAccessConfigurationCandidateService,
    {
      replaceConfiguration,
    } as unknown as InconnectRecordAccessConfigurationService,
  );

  return {
    buildValidatedCandidate,
    query,
    replaceConfiguration,
    service,
    transaction,
  };
};

describe('InconnectRecordAccessEnvironmentImportService', () => {
  it('resolves the eight ENV rules to two managed objects and persisted IDs in a read-only snapshot', async () => {
    const harness = buildHarness();

    const plan = await harness.service.prepareEnvironmentImport(WORKSPACE_ID);

    expect(harness.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(plan).toMatchObject({
      workspaceId: WORKSPACE_ID,
      workspaceDisplayName: 'Apple',
      enforcementMode: 'MANAGED',
      currentRevision: null,
      publishRevision: '1',
      managedObjectCount: 2,
      policyCount: 8,
      validationStatus: 'valid',
    });
    expect(plan.managedObjects).toEqual([
      expect.objectContaining({
        objectLabel: 'Lead',
        objectMetadataId: LEAD_OBJECT_ID,
        ownerFieldMetadataId: LEAD_OWNER_FIELD_ID,
      }),
      expect.objectContaining({
        objectLabel: 'Folio ISO',
        objectMetadataId: FOLIO_OBJECT_ID,
        ownerFieldMetadataId: FOLIO_OWNER_FIELD_ID,
      }),
    ]);
    expect(plan.policies).toHaveLength(8);
    expect(plan.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: EXECUTIVE_ROLE_ID,
          objectLabel: 'Lead',
          recordEffect: 'ownRecords',
        }),
        expect.objectContaining({
          roleId: SUPERVISOR_ROLE_ID,
          objectLabel: 'Lead',
          defaultOwnerRoleId: SUPERVISOR_ROLE_ID,
        }),
        expect.objectContaining({
          roleId: ADMIN_ROLE_ID,
          objectLabel: 'Folio ISO',
          missingOwnerPolicy: 'self',
        }),
      ]),
    );
    expect(harness.buildValidatedCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        revision: '1',
        input: expect.objectContaining({
          managedObjects: expect.arrayContaining([
            expect.objectContaining({ objectMetadataId: LEAD_OBJECT_ID }),
            expect.objectContaining({ objectMetadataId: FOLIO_OBJECT_ID }),
          ]),
          policies: expect.arrayContaining([
            expect.objectContaining({
              objectMetadataId: LEAD_OBJECT_ID,
              roleId: SUPERVISOR_ROLE_ID,
              defaultOwnerRoleId: SUPERVISOR_ROLE_ID,
            }),
          ]),
        }),
      }),
    );
  });

  it('performs a valid dry-run without invoking the publisher', async () => {
    const harness = buildHarness();

    const result = await harness.service.importEnvironment({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
    });

    expect(result.published).toBe(false);
    expect(result.plan.managedObjectCount).toBe(2);
    expect(result.plan.policyCount).toBe(8);
    expect(harness.replaceConfiguration).not.toHaveBeenCalled();
  });

  it('rejects a missing workspace', async () => {
    const harness = buildHarness({ workspaceExists: false });

    await expect(
      harness.service.prepareEnvironmentImport(WORKSPACE_ID),
    ).rejects.toThrow('Workspace does not exist');
    expect(harness.buildValidatedCandidate).not.toHaveBeenCalled();
  });

  it('rejects a missing ENV workspace block', async () => {
    const harness = buildHarness({ config: { workspaces: [] } });

    await expect(
      harness.service.prepareEnvironmentImport(WORKSPACE_ID),
    ).rejects.toThrow('no managed configuration');
  });

  it.each([
    ['Role', { roles: roleDefinitions.slice(1) }],
    [
      'object',
      {
        objects: objectDefinitions.filter(
          (object) => object.id !== LEAD_OBJECT_ID,
        ),
      },
    ],
    [
      'owner field',
      {
        fields: fieldDefinitions.filter(
          (field) => field.id !== LEAD_OWNER_FIELD_ID,
        ),
      },
    ],
    [
      'default owner role',
      {
        roles: roleDefinitions.filter((role) => role.id !== SUPERVISOR_ROLE_ID),
      },
    ],
  ])('rejects a missing %s universal identifier', async (_label, overrides) => {
    const harness = buildHarness(overrides);

    await expect(
      harness.service.prepareEnvironmentImport(WORKSPACE_ID),
    ).rejects.toThrow(/does not exist/);
    expect(harness.buildValidatedCandidate).not.toHaveBeenCalled();
  });

  it('rejects a cross-workspace resolved reference through the common validator', async () => {
    const harness = buildHarness();

    harness.buildValidatedCandidate.mockRejectedValueOnce(
      new Error('ROLE_WORKSPACE_MISMATCH'),
    );

    await expect(
      harness.service.prepareEnvironmentImport(WORKSPACE_ID),
    ).rejects.toThrow('ROLE_WORKSPACE_MISMATCH');
    expect(harness.replaceConfiguration).not.toHaveBeenCalled();
  });

  it('reports the current and next bigint revision without publishing', async () => {
    const harness = buildHarness({ currentRevision: '9007199254740993' });

    const result = await harness.service.importEnvironment({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
    });

    expect(result.plan.currentRevision).toBe('9007199254740993');
    expect(result.plan.publishRevision).toBe('9007199254740994');
    expect(harness.replaceConfiguration).not.toHaveBeenCalled();
  });

  it('rejects real import when DB authority already exists', async () => {
    const harness = buildHarness({ currentRevision: '7' });

    await expect(
      harness.service.importEnvironment({
        workspaceId: WORKSPACE_ID,
        dryRun: false,
      }),
    ).rejects.toThrow('already exists at revision 7');
    expect(harness.replaceConfiguration).not.toHaveBeenCalled();
  });

  it('publishes an initial import with explicit absent revision', async () => {
    const harness = buildHarness();

    const result = await harness.service.importEnvironment({
      workspaceId: WORKSPACE_ID,
      dryRun: false,
    });

    expect(harness.replaceConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        expectedRevision: null,
        enforcementMode: 'MANAGED',
      }),
    );
    expect(result.published).toEqual({
      revision: '1',
      cacheStatus: 'recomputed',
    });
  });
});
