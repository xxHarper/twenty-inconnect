import { type DataSource, type EntityManager } from 'typeorm';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import {
  createEightRulePersistedCandidateFixture,
  INCONNECT_PERSISTED_FIXTURE_IDS,
} from 'src/engine/core-modules/inconnect-record-access/__tests__/fixtures/inconnect-record-access-persisted-candidate.fixture';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { InconnectRecordAccessConfigurationExceptionCode } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access-configuration.exception';
import { type InconnectRecordAccessConfigurationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration.service';
import { InconnectRecordAccessSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-settings.service';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

const createReadFixture = () => {
  const candidate = createEightRulePersistedCandidateFixture();
  const objectById = new Map(
    candidate.objects.map((object, index) => [
      object.id,
      {
        ...object,
        nameSingular:
          index === 0 ? 'lead' : index === 1 ? 'folioIso' : 'workspaceMember',
        namePlural:
          index === 0
            ? 'leads'
            : index === 1
              ? 'foliosIso'
              : 'workspaceMembers',
        labelSingular:
          index === 0 ? 'Lead' : index === 1 ? 'Folio ISO' : 'Workspace Member',
        labelPlural:
          index === 0
            ? 'Leads'
            : index === 1
              ? 'Folios ISO'
              : 'Workspace Members',
      } as unknown as ObjectMetadataEntity,
    ]),
  );
  const roleLabels = ['Ejecutivo', 'Coordinador', 'Supervisor', 'Admin'];
  const roleById = new Map(
    candidate.roles.map((role, index) => [
      role.id,
      {
        ...role,
        label: roleLabels[index],
        universalIdentifier: role.id,
      } as RoleEntity,
    ]),
  );
  const fieldById = new Map(
    candidate.fields.map((field, index) => [
      field.id,
      {
        ...field,
        universalIdentifier: field.id,
        label: index === 0 ? 'Propietario de Lead' : 'Propietario de Folio',
        relationTargetObjectMetadata:
          objectById.get(field.relationTargetObjectMetadataId ?? '') ?? null,
      } as unknown as FieldMetadataEntity,
    ]),
  );
  const managedObjects = candidate.managedObjects.map(
    (managedObject) =>
      ({
        ...managedObject,
        objectMetadata: objectById.get(managedObject.objectMetadataId),
        ownerFieldMetadata: fieldById.get(managedObject.ownerFieldMetadataId),
      }) as InconnectRecordAccessManagedObjectEntity,
  );
  const policies = candidate.policies.map(
    (policy) =>
      ({
        ...policy,
        role: roleById.get(policy.roleId),
        defaultOwnerRole: policy.defaultOwnerRoleId
          ? roleById.get(policy.defaultOwnerRoleId)
          : null,
      }) as InconnectRecordAccessPolicyEntity,
  );

  return {
    candidate,
    configuration:
      candidate.configuration as InconnectRecordAccessConfigurationEntity,
    fields: [...fieldById.values()],
    managedObjects,
    objects: [...objectById.values()],
    policies,
    roles: [...roleById.values()],
  };
};

const buildService = ({
  configuration,
  managedObjects = [],
  policies = [],
  objects = [],
  fields = [],
  roles = [],
  replaceResult = {
    revision: '2',
    cacheStatus: 'recomputed' as const,
    changedFromManagedToUnmanaged: false,
  },
}: {
  configuration: InconnectRecordAccessConfigurationEntity | null;
  managedObjects?: InconnectRecordAccessManagedObjectEntity[];
  policies?: InconnectRecordAccessPolicyEntity[];
  objects?: ObjectMetadataEntity[];
  fields?: FieldMetadataEntity[];
  roles?: RoleEntity[];
  replaceResult?: {
    revision: string;
    cacheStatus: 'recomputed' | 'recomputation-failed';
    changedFromManagedToUnmanaged: boolean;
  };
}) => {
  const query = jest.fn().mockResolvedValue(undefined);
  const findCalls: Array<{ entity: unknown; options: unknown }> = [];
  const manager = {
    query,
    getRepository: jest.fn((entity: unknown) => ({
      findOne: jest.fn(async (options: unknown) => {
        findCalls.push({ entity, options });

        return entity === InconnectRecordAccessConfigurationEntity
          ? configuration
          : null;
      }),
      find: jest.fn(async (options: unknown) => {
        findCalls.push({ entity, options });

        if (entity === InconnectRecordAccessManagedObjectEntity) {
          return managedObjects;
        }

        if (entity === InconnectRecordAccessPolicyEntity) {
          return policies;
        }

        if (entity === ObjectMetadataEntity) {
          return objects;
        }

        if (entity === FieldMetadataEntity) {
          return fields;
        }

        if (entity === RoleEntity) {
          return roles;
        }

        throw new Error('Unexpected repository');
      }),
    })),
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      isolation: string,
      operation: (manager: EntityManager) => Promise<unknown>,
    ) => operation(manager),
  );
  const replaceConfiguration = jest.fn().mockResolvedValue(replaceResult);
  const service = new InconnectRecordAccessSettingsService(
    { transaction } as unknown as DataSource,
    {
      replaceConfiguration,
    } as unknown as InconnectRecordAccessConfigurationService,
  );

  return {
    findCalls,
    query,
    replaceConfiguration,
    service,
    transaction,
  };
};

describe('InconnectRecordAccessSettingsService', () => {
  it('reads a coherent MANAGED configuration with two objects and eight policies', async () => {
    const fixture = createReadFixture();
    const harness = buildService(fixture);

    const result = await harness.service.getConfiguration(
      INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
    );

    expect(result).toMatchObject({
      status: 'MANAGED',
      enforcementMode: 'MANAGED',
      revision: '1',
    });
    expect(result.managedObjects).toHaveLength(2);
    expect(
      result.managedObjects.flatMap(({ policies }) => policies),
    ).toHaveLength(8);
    expect(result.managedObjects[0]).toMatchObject({
      objectLabelSingular: 'Lead',
      ownerFieldLabel: 'Propietario de Lead',
    });
    expect(result.managedObjects[0].policies[0]).not.toHaveProperty(
      'recordScopeOwnerWorkspaceMemberIds',
    );
    expect(harness.transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(harness.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
  });

  it('distinguishes absent and UNMANAGED configurations', async () => {
    const absentHarness = buildService({ configuration: null });

    await expect(
      absentHarness.service.getConfiguration(
        INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
      ),
    ).resolves.toEqual({
      status: 'ABSENT',
      enforcementMode: null,
      revision: null,
      managedObjects: [],
    });

    const unmanagedHarness = buildService({
      configuration: {
        workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
        enforcementMode: 'UNMANAGED',
        revision: '4',
      } as InconnectRecordAccessConfigurationEntity,
    });

    await expect(
      unmanagedHarness.service.getConfiguration(
        INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
      ),
    ).resolves.toEqual({
      status: 'UNMANAGED',
      enforcementMode: 'UNMANAGED',
      revision: '4',
      managedObjects: [],
    });
  });

  it('lists only active objects with derivable MANY_TO_ONE workspaceMember owner fields and workspace roles', async () => {
    const fixture = createReadFixture();
    const invalidField = {
      ...fixture.fields[0],
      id: '00000000-0000-4000-8000-000000000099',
      universalIdentifier: '00000000-0000-4000-8000-000000000099',
      settings: { relationType: RelationType.ONE_TO_MANY },
    } as unknown as FieldMetadataEntity;
    const harness = buildService({
      configuration: null,
      objects: fixture.objects,
      fields: [...fixture.fields, invalidField],
      roles: fixture.roles,
    });

    const result = await harness.service.getAvailableMetadata(
      INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
    );

    expect(result.objects).toHaveLength(2);
    expect(
      result.objects.flatMap(({ ownerFields }) => ownerFields),
    ).toHaveLength(2);
    expect(result.objects[0].ownerFields[0].joinColumnName).toBeDefined();
    expect(result.roles).toHaveLength(4);
    expect(harness.findCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: ObjectMetadataEntity,
          options: expect.objectContaining({
            where: {
              workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
              isActive: true,
            },
          }),
        }),
        expect.objectContaining({
          entity: RoleEntity,
          options: {
            where: {
              workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
            },
          },
        }),
      ]),
    );
  });

  it('delegates a full replacement for the trusted workspace and preserves post-commit cache status', async () => {
    const harness = buildService({
      configuration: null,
      replaceResult: {
        revision: '2',
        cacheStatus: 'recomputation-failed',
        changedFromManagedToUnmanaged: false,
      },
    });
    const input = {
      expectedRevision: '1',
      enforcementMode: 'MANAGED' as const,
      managedObjects: [
        {
          objectMetadataId: INCONNECT_PERSISTED_FIXTURE_IDS.leadObject,
          ownerFieldMetadataId: INCONNECT_PERSISTED_FIXTURE_IDS.leadOwnerField,
          ownerRequirement: 'required' as const,
        },
      ],
      policies: [
        {
          objectMetadataId: INCONNECT_PERSISTED_FIXTURE_IDS.leadObject,
          roleId: INCONNECT_PERSISTED_FIXTURE_IDS.executiveRole,
          principalType: 'WORKSPACE_MEMBER' as const,
          recordEffect: 'ownRecords' as const,
          createPolicy: 'denied' as const,
          ownerTransferPolicy: 'denied' as const,
          missingOwnerPolicy: 'requireExplicit' as const,
          defaultOwnerRoleId: null,
        },
      ],
    };

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
        input,
      }),
    ).resolves.toEqual({
      revision: '2',
      cacheStatus: 'recomputation-failed',
      changedFromManagedToUnmanaged: false,
    });
    expect(harness.replaceConfiguration).toHaveBeenCalledWith({
      workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
      expectedRevision: '1',
      enforcementMode: 'MANAGED',
      managedObjects: input.managedObjects,
      policies: [
        {
          objectMetadataId: INCONNECT_PERSISTED_FIXTURE_IDS.leadObject,
          roleId: INCONNECT_PERSISTED_FIXTURE_IDS.executiveRole,
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
          defaultOwnerRoleId: undefined,
        },
      ],
    });
  });

  it('rejects unsupported principal types before the configuration service', async () => {
    const harness = buildService({ configuration: null });
    const input = {
      expectedRevision: null,
      enforcementMode: 'UNMANAGED' as const,
      managedObjects: [],
      policies: [
        {
          objectMetadataId: INCONNECT_PERSISTED_FIXTURE_IDS.leadObject,
          roleId: INCONNECT_PERSISTED_FIXTURE_IDS.executiveRole,
          principalType: 'UNSUPPORTED',
          recordEffect: 'ownRecords' as const,
          createPolicy: 'denied' as const,
          ownerTransferPolicy: 'denied' as const,
          missingOwnerPolicy: 'requireExplicit' as const,
        },
      ],
    };

    await expect(
      harness.service.replaceConfiguration({
        workspaceId: INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
        input: input as never,
      }),
    ).rejects.toMatchObject({
      code: InconnectRecordAccessConfigurationExceptionCode.INVALID_INPUT,
    });
    expect(harness.replaceConfiguration).not.toHaveBeenCalled();
  });

  it('does not offer a relation targeting a non-workspaceMember object', async () => {
    const fixture = createReadFixture();
    const wrongTargetField = {
      ...fixture.fields[0],
      id: '00000000-0000-4000-8000-000000000098',
      universalIdentifier: '00000000-0000-4000-8000-000000000098',
      relationTargetObjectMetadataId:
        INCONNECT_PERSISTED_FIXTURE_IDS.folioObject,
      relationTargetObjectMetadata: fixture.objects.find(
        ({ id }) => id === INCONNECT_PERSISTED_FIXTURE_IDS.folioObject,
      ),
      type: FieldMetadataType.RELATION,
      settings: { relationType: RelationType.MANY_TO_ONE },
    } as unknown as FieldMetadataEntity;
    const harness = buildService({
      configuration: null,
      objects: fixture.objects,
      fields: [wrongTargetField],
      roles: fixture.roles,
    });

    await expect(
      harness.service.getAvailableMetadata(
        INCONNECT_PERSISTED_FIXTURE_IDS.workspace,
      ),
    ).resolves.toEqual({
      objects: [],
      roles: expect.any(Array),
    });
    expect(
      fixture.objects.find(
        ({ universalIdentifier }) =>
          universalIdentifier ===
          STANDARD_OBJECTS.workspaceMember.universalIdentifier,
      ),
    ).toBeDefined();
  });
});
