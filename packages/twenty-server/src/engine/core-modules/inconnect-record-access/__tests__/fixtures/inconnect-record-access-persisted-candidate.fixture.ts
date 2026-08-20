import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import { type InconnectRecordAccessPersistedCandidate } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

export const INCONNECT_PERSISTED_FIXTURE_IDS = {
  workspace: '00000000-0000-4000-8000-000000000001',
  otherWorkspace: '00000000-0000-4000-8000-000000000002',
  leadObject: '00000000-0000-4000-8000-000000000010',
  folioObject: '00000000-0000-4000-8000-000000000011',
  workspaceMemberObject: '00000000-0000-4000-8000-000000000012',
  leadOwnerField: '00000000-0000-4000-8000-000000000020',
  folioOwnerField: '00000000-0000-4000-8000-000000000021',
  leadManagedObject: '00000000-0000-4000-8000-000000000030',
  folioManagedObject: '00000000-0000-4000-8000-000000000031',
  executiveRole: '00000000-0000-4000-8000-000000000040',
  coordinatorRole: '00000000-0000-4000-8000-000000000041',
  supervisorRole: '00000000-0000-4000-8000-000000000042',
  adminRole: '00000000-0000-4000-8000-000000000043',
} as const;

export const createEightRulePersistedCandidateFixture =
  (): InconnectRecordAccessPersistedCandidate => {
    const ids = INCONNECT_PERSISTED_FIXTURE_IDS;
    const roleIds = [
      ids.executiveRole,
      ids.coordinatorRole,
      ids.supervisorRole,
      ids.adminRole,
    ];

    return {
      configuration: {
        workspaceId: ids.workspace,
        enforcementMode: 'MANAGED',
        revision: '1',
      },
      managedObjects: [
        {
          id: ids.leadManagedObject,
          workspaceId: ids.workspace,
          objectMetadataId: ids.leadObject,
          ownerFieldMetadataId: ids.leadOwnerField,
          ownerRequirement: 'required',
        },
        {
          id: ids.folioManagedObject,
          workspaceId: ids.workspace,
          objectMetadataId: ids.folioObject,
          ownerFieldMetadataId: ids.folioOwnerField,
          ownerRequirement: 'required',
        },
      ],
      policies: [
        {
          id: '00000000-0000-4000-8000-000000000101',
          workspaceId: ids.workspace,
          managedObjectId: ids.leadManagedObject,
          roleId: ids.executiveRole,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'ownRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
          defaultOwnerRoleId: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000102',
          workspaceId: ids.workspace,
          managedObjectId: ids.leadManagedObject,
          roleId: ids.coordinatorRole,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'denied',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'requireExplicit',
          defaultOwnerRoleId: null,
        },
        ...[ids.supervisorRole, ids.adminRole].map((roleId, index) => ({
          id: `00000000-0000-4000-8000-00000000010${index + 3}`,
          workspaceId: ids.workspace,
          managedObjectId: ids.leadManagedObject,
          roleId,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'allRecords',
          createPolicy: 'standardPermissionsOnly',
          ownerTransferPolicy: 'standardPermissionsOnly',
          missingOwnerPolicy: 'singleActiveMemberOfRole',
          defaultOwnerRoleId: ids.supervisorRole,
        })),
        {
          id: '00000000-0000-4000-8000-000000000105',
          workspaceId: ids.workspace,
          managedObjectId: ids.folioManagedObject,
          roleId: ids.executiveRole,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'ownRecords',
          createPolicy: 'defaultOwner',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'self',
          defaultOwnerRoleId: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000106',
          workspaceId: ids.workspace,
          managedObjectId: ids.folioManagedObject,
          roleId: ids.coordinatorRole,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'ownAndTeamRecords',
          createPolicy: 'defaultOwner',
          ownerTransferPolicy: 'denied',
          missingOwnerPolicy: 'self',
          defaultOwnerRoleId: null,
        },
        ...[ids.supervisorRole, ids.adminRole].map((roleId, index) => ({
          id: `00000000-0000-4000-8000-00000000010${index + 7}`,
          workspaceId: ids.workspace,
          managedObjectId: ids.folioManagedObject,
          roleId,
          principalType: 'WORKSPACE_MEMBER',
          recordEffect: 'allRecords',
          createPolicy: 'standardPermissionsOnly',
          ownerTransferPolicy: 'standardPermissionsOnly',
          missingOwnerPolicy: 'self',
          defaultOwnerRoleId: null,
        })),
      ],
      roles: roleIds.map((id) => ({ id, workspaceId: ids.workspace })),
      objects: [
        {
          id: ids.leadObject,
          workspaceId: ids.workspace,
          universalIdentifier: '10000000-0000-4000-8000-000000000001',
          isActive: true,
        },
        {
          id: ids.folioObject,
          workspaceId: ids.workspace,
          universalIdentifier: '10000000-0000-4000-8000-000000000002',
          isActive: true,
        },
        {
          id: ids.workspaceMemberObject,
          workspaceId: ids.workspace,
          universalIdentifier:
            STANDARD_OBJECTS.workspaceMember.universalIdentifier,
          isActive: true,
        },
      ],
      fields: [
        {
          id: ids.leadOwnerField,
          workspaceId: ids.workspace,
          objectMetadataId: ids.leadObject,
          name: 'leadOwner',
          type: FieldMetadataType.RELATION,
          isActive: true,
          relationTargetObjectMetadataId: ids.workspaceMemberObject,
          settings: { relationType: RelationType.MANY_TO_ONE },
        },
        {
          id: ids.folioOwnerField,
          workspaceId: ids.workspace,
          objectMetadataId: ids.folioObject,
          name: 'folioOwner',
          type: FieldMetadataType.RELATION,
          isActive: true,
          relationTargetObjectMetadataId: ids.workspaceMemberObject,
          settings: { relationType: RelationType.MANY_TO_ONE },
        },
      ],
    };
  };
