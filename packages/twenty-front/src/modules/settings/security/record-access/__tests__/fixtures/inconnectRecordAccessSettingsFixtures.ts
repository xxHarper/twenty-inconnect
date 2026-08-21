import {
  InconnectRecordAccessConfigurationStatus,
  InconnectRecordAccessCreatePolicy,
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessMissingOwnerPolicy,
  InconnectRecordAccessOwnerRequirement,
  InconnectRecordAccessOwnerTransferPolicy,
  InconnectRecordAccessPrincipalType,
  InconnectRecordAccessRecordEffect,
  type GetInconnectRecordAccessAvailableMetadataQuery,
  type GetInconnectRecordAccessConfigurationQuery,
} from '~/generated-metadata/graphql';

export const ROLE_IDS = {
  executive: '10000000-0000-4000-8000-000000000001',
  coordinator: '10000000-0000-4000-8000-000000000002',
  supervisor: '10000000-0000-4000-8000-000000000003',
  admin: '10000000-0000-4000-8000-000000000004',
} as const;

export const OBJECT_IDS = {
  lead: '20000000-0000-4000-8000-000000000001',
  folio: '20000000-0000-4000-8000-000000000002',
} as const;

export const FIELD_IDS = {
  leadOwner: '30000000-0000-4000-8000-000000000001',
  folioOwner: '30000000-0000-4000-8000-000000000002',
} as const;

const roles = [
  {
    roleId: ROLE_IDS.executive,
    universalIdentifier: '40000000-0000-4000-8000-000000000001',
    label: 'Ejecutivo INCONNECT',
  },
  {
    roleId: ROLE_IDS.coordinator,
    universalIdentifier: '40000000-0000-4000-8000-000000000002',
    label: 'Coordinador INCONNECT',
  },
  {
    roleId: ROLE_IDS.supervisor,
    universalIdentifier: '40000000-0000-4000-8000-000000000003',
    label: 'Supervisor INCONNECT',
  },
  {
    roleId: ROLE_IDS.admin,
    universalIdentifier: '40000000-0000-4000-8000-000000000004',
    label: 'Admin',
  },
];

const policy = ({
  objectMetadataId,
  roleId,
  recordEffect,
  createPolicy,
  missingOwnerPolicy,
  ownerTransferPolicy,
  defaultOwnerRoleId = null,
}: {
  objectMetadataId: string;
  roleId: string;
  recordEffect: InconnectRecordAccessRecordEffect;
  createPolicy: InconnectRecordAccessCreatePolicy;
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;
  defaultOwnerRoleId?: string | null;
}) => {
  const role = roles.find((candidate) => candidate.roleId === roleId);

  return {
    __typename: 'InconnectRecordAccessSettingsPolicy' as const,
    id: `50000000-0000-4000-8000-${objectMetadataId.slice(-6)}${roleId.slice(-6)}`.slice(
      0,
      36,
    ),
    roleId,
    roleLabel: role?.label ?? '',
    roleUniversalIdentifier: role?.universalIdentifier ?? '',
    principalType: InconnectRecordAccessPrincipalType.WORKSPACE_MEMBER,
    recordEffect,
    createPolicy,
    ownerTransferPolicy,
    missingOwnerPolicy,
    defaultOwnerRoleId,
    defaultOwnerRoleLabel:
      defaultOwnerRoleId === ROLE_IDS.supervisor
        ? 'Supervisor INCONNECT'
        : null,
  };
};

export const availableMetadataFixture: GetInconnectRecordAccessAvailableMetadataQuery =
  {
    __typename: 'Query',
    getInconnectRecordAccessAvailableMetadata: {
      __typename: 'InconnectRecordAccessSettingsAvailableMetadata',
      objects: [
        {
          __typename: 'InconnectRecordAccessSettingsObjectCandidate',
          objectMetadataId: OBJECT_IDS.lead,
          universalIdentifier: '60000000-0000-4000-8000-000000000001',
          nameSingular: 'lead',
          namePlural: 'leads',
          labelSingular: 'Lead',
          labelPlural: 'Leads',
          isActive: true,
          ownerFields: [
            {
              __typename: 'InconnectRecordAccessSettingsOwnerFieldCandidate',
              fieldMetadataId: FIELD_IDS.leadOwner,
              universalIdentifier: '70000000-0000-4000-8000-000000000001',
              name: 'propietarioDeLead',
              label: 'Propietario de lead',
              isActive: true,
              joinColumnName: 'propietarioDeLeadId',
            },
          ],
        },
        {
          __typename: 'InconnectRecordAccessSettingsObjectCandidate',
          objectMetadataId: OBJECT_IDS.folio,
          universalIdentifier: '60000000-0000-4000-8000-000000000002',
          nameSingular: 'folioIso',
          namePlural: 'foliosIso',
          labelSingular: 'Folio ISO',
          labelPlural: 'Folios ISO',
          isActive: true,
          ownerFields: [
            {
              __typename: 'InconnectRecordAccessSettingsOwnerFieldCandidate',
              fieldMetadataId: FIELD_IDS.folioOwner,
              universalIdentifier: '70000000-0000-4000-8000-000000000002',
              name: 'propietarioDeFolio',
              label: 'Propietario de Folio',
              isActive: true,
              joinColumnName: 'propietarioDeFolioId',
            },
          ],
        },
      ],
      roles,
    },
  };

const leadPolicies = [
  policy({
    objectMetadataId: OBJECT_IDS.lead,
    roleId: ROLE_IDS.executive,
    recordEffect: InconnectRecordAccessRecordEffect.ownRecords,
    createPolicy: InconnectRecordAccessCreatePolicy.denied,
    ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy.denied,
    missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
  }),
  policy({
    objectMetadataId: OBJECT_IDS.lead,
    roleId: ROLE_IDS.coordinator,
    recordEffect: InconnectRecordAccessRecordEffect.ownAndTeamRecords,
    createPolicy: InconnectRecordAccessCreatePolicy.denied,
    ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy.denied,
    missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.requireExplicit,
  }),
  ...[ROLE_IDS.supervisor, ROLE_IDS.admin].map((roleId) =>
    policy({
      objectMetadataId: OBJECT_IDS.lead,
      roleId,
      recordEffect: InconnectRecordAccessRecordEffect.allRecords,
      createPolicy: InconnectRecordAccessCreatePolicy.standardPermissionsOnly,
      ownerTransferPolicy:
        InconnectRecordAccessOwnerTransferPolicy.standardPermissionsOnly,
      missingOwnerPolicy:
        InconnectRecordAccessMissingOwnerPolicy.singleActiveMemberOfRole,
      defaultOwnerRoleId: ROLE_IDS.supervisor,
    }),
  ),
];

const folioPolicies = [
  ...[
    {
      roleId: ROLE_IDS.executive,
      effect: InconnectRecordAccessRecordEffect.ownRecords,
      create: InconnectRecordAccessCreatePolicy.defaultOwner,
      transfer: InconnectRecordAccessOwnerTransferPolicy.denied,
    },
    {
      roleId: ROLE_IDS.coordinator,
      effect: InconnectRecordAccessRecordEffect.ownAndTeamRecords,
      create: InconnectRecordAccessCreatePolicy.defaultOwner,
      transfer: InconnectRecordAccessOwnerTransferPolicy.denied,
    },
    {
      roleId: ROLE_IDS.supervisor,
      effect: InconnectRecordAccessRecordEffect.allRecords,
      create: InconnectRecordAccessCreatePolicy.standardPermissionsOnly,
      transfer:
        InconnectRecordAccessOwnerTransferPolicy.standardPermissionsOnly,
    },
    {
      roleId: ROLE_IDS.admin,
      effect: InconnectRecordAccessRecordEffect.allRecords,
      create: InconnectRecordAccessCreatePolicy.standardPermissionsOnly,
      transfer:
        InconnectRecordAccessOwnerTransferPolicy.standardPermissionsOnly,
    },
  ].map(({ roleId, effect, create, transfer }) =>
    policy({
      objectMetadataId: OBJECT_IDS.folio,
      roleId,
      recordEffect: effect,
      createPolicy: create,
      ownerTransferPolicy: transfer,
      missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy.self,
    }),
  ),
];

export const managedConfigurationFixture: GetInconnectRecordAccessConfigurationQuery =
  {
    __typename: 'Query',
    getInconnectRecordAccessConfiguration: {
      __typename: 'InconnectRecordAccessSettingsConfiguration',
      status: InconnectRecordAccessConfigurationStatus.MANAGED,
      enforcementMode: InconnectRecordAccessEnforcementMode.MANAGED,
      revision: '1',
      managedObjects: [
        {
          __typename: 'InconnectRecordAccessSettingsManagedObject',
          id: '80000000-0000-4000-8000-000000000001',
          objectMetadataId: OBJECT_IDS.lead,
          objectUniversalIdentifier: '60000000-0000-4000-8000-000000000001',
          objectNameSingular: 'lead',
          objectLabelSingular: 'Lead',
          ownerFieldMetadataId: FIELD_IDS.leadOwner,
          ownerFieldUniversalIdentifier: '70000000-0000-4000-8000-000000000001',
          ownerFieldName: 'propietarioDeLead',
          ownerFieldLabel: 'Propietario de lead',
          ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
          policies: leadPolicies,
        },
        {
          __typename: 'InconnectRecordAccessSettingsManagedObject',
          id: '80000000-0000-4000-8000-000000000002',
          objectMetadataId: OBJECT_IDS.folio,
          objectUniversalIdentifier: '60000000-0000-4000-8000-000000000002',
          objectNameSingular: 'folioIso',
          objectLabelSingular: 'Folio ISO',
          ownerFieldMetadataId: FIELD_IDS.folioOwner,
          ownerFieldUniversalIdentifier: '70000000-0000-4000-8000-000000000002',
          ownerFieldName: 'propietarioDeFolio',
          ownerFieldLabel: 'Propietario de Folio',
          ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
          policies: folioPolicies,
        },
      ],
    },
  };
