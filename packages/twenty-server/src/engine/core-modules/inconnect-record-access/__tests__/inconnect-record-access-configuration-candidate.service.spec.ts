import { type EntityManager } from 'typeorm';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import { InconnectRecordAccessConfigurationCandidateService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-configuration-candidate.service';
import { type InconnectRecordAccessConfigurationSetInput } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-configuration-input.type';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const OBJECT_ID = '00000000-0000-4000-8000-000000000003';
const OWNER_FIELD_ID = '00000000-0000-4000-8000-000000000004';
const ROLE_ID = '00000000-0000-4000-8000-000000000005';
const WORKSPACE_MEMBER_OBJECT_ID = '00000000-0000-4000-8000-000000000006';

const MANAGED_INPUT: InconnectRecordAccessConfigurationSetInput = {
  enforcementMode: 'MANAGED',
  managedObjects: [
    {
      objectMetadataId: OBJECT_ID,
      ownerFieldMetadataId: OWNER_FIELD_ID,
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

const buildManager = ({
  roleWorkspaceId = WORKSPACE_ID,
  fieldType = FieldMetadataType.RELATION,
}: {
  roleWorkspaceId?: string;
  fieldType?: FieldMetadataType;
} = {}) => {
  const roleFind = jest
    .fn()
    .mockResolvedValue([{ id: ROLE_ID, workspaceId: roleWorkspaceId }]);
  const fieldFind = jest.fn().mockResolvedValue([
    {
      id: OWNER_FIELD_ID,
      workspaceId: WORKSPACE_ID,
      objectMetadataId: OBJECT_ID,
      name: 'owner',
      type: fieldType,
      isActive: true,
      relationTargetObjectMetadataId: WORKSPACE_MEMBER_OBJECT_ID,
      settings: { relationType: RelationType.MANY_TO_ONE },
    },
  ]);
  const objectFind = jest.fn().mockResolvedValue([
    {
      id: OBJECT_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: 'object-under-test',
      isActive: true,
    },
    {
      id: WORKSPACE_MEMBER_OBJECT_ID,
      workspaceId: WORKSPACE_ID,
      universalIdentifier: STANDARD_OBJECTS.workspaceMember.universalIdentifier,
      isActive: true,
    },
  ]);
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === RoleEntity) {
        return { find: roleFind };
      }
      if (entity === FieldMetadataEntity) {
        return { find: fieldFind };
      }
      if (entity === ObjectMetadataEntity) {
        return { find: objectFind };
      }

      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;

  return { fieldFind, manager, objectFind, roleFind };
};

describe('InconnectRecordAccessConfigurationCandidateService', () => {
  const service = new InconnectRecordAccessConfigurationCandidateService();

  it('builds and validates a complete candidate with batched metadata reads', async () => {
    const harness = buildManager();

    const candidate = await service.buildValidatedCandidate({
      manager: harness.manager,
      workspaceId: WORKSPACE_ID,
      revision: '9007199254740993',
      input: MANAGED_INPUT,
    });

    expect(candidate.configuration).toEqual({
      workspaceId: WORKSPACE_ID,
      enforcementMode: 'MANAGED',
      revision: '9007199254740993',
    });
    expect(candidate.managedObjects).toHaveLength(1);
    expect(candidate.policies).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        managedObjectId: candidate.managedObjects[0].id,
        roleId: ROLE_ID,
      }),
    ]);
    expect(harness.roleFind).toHaveBeenCalledTimes(1);
    expect(harness.fieldFind).toHaveBeenCalledTimes(1);
    expect(harness.objectFind).toHaveBeenCalledTimes(1);
  });

  it('accepts a managed object with zero policies', async () => {
    const harness = buildManager();

    const candidate = await service.buildValidatedCandidate({
      manager: harness.manager,
      workspaceId: WORKSPACE_ID,
      revision: '1',
      input: { ...MANAGED_INPUT, policies: [] },
    });

    expect(candidate.managedObjects).toHaveLength(1);
    expect(candidate.policies).toEqual([]);
    expect(harness.roleFind).not.toHaveBeenCalled();
  });

  it('rejects identifiers that are not UUIDs before metadata lookup', async () => {
    const harness = buildManager();

    await expect(
      service.buildValidatedCandidate({
        manager: harness.manager,
        workspaceId: WORKSPACE_ID,
        revision: '1',
        input: {
          ...MANAGED_INPUT,
          policies: [{ ...MANAGED_INPUT.policies[0], roleId: 'not-a-uuid' }],
        },
      }),
    ).rejects.toThrow('invalid UUID');
    expect(harness.roleFind).not.toHaveBeenCalled();
  });

  it('rejects a Role from another workspace', async () => {
    const harness = buildManager({ roleWorkspaceId: OTHER_WORKSPACE_ID });

    await expect(
      service.buildValidatedCandidate({
        manager: harness.manager,
        workspaceId: WORKSPACE_ID,
        revision: '1',
        input: MANAGED_INPUT,
      }),
    ).rejects.toThrow('WORKSPACE_MISMATCH');
  });

  it('rejects an incompatible owner field', async () => {
    const harness = buildManager({ fieldType: FieldMetadataType.TEXT });

    await expect(
      service.buildValidatedCandidate({
        manager: harness.manager,
        workspaceId: WORKSPACE_ID,
        revision: '1',
        input: MANAGED_INPUT,
      }),
    ).rejects.toThrow('INVALID_OWNER_FIELD');
  });

  it.each([
    {
      enforcementMode: 'MANAGED' as const,
      managedObjects: [],
      policies: [],
      expected:
        'A MANAGED configuration must contain at least one managed object',
    },
    {
      enforcementMode: 'UNMANAGED' as const,
      managedObjects: MANAGED_INPUT.managedObjects,
      policies: MANAGED_INPUT.policies,
      expected:
        'An UNMANAGED configuration cannot contain managed objects or policies',
    },
  ])(
    'rejects an invalid enforcement set',
    async ({ enforcementMode, managedObjects, policies, expected }) => {
      const harness = buildManager();

      await expect(
        service.buildValidatedCandidate({
          manager: harness.manager,
          workspaceId: WORKSPACE_ID,
          revision: '1',
          input: { enforcementMode, managedObjects, policies },
        }),
      ).rejects.toThrow(expected);
    },
  );
});
