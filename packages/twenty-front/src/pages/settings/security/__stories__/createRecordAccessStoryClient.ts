import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { of } from 'rxjs';

import {
  ROLE_IDS,
  availableMetadataFixture,
  managedConfigurationFixture,
} from '@/settings/security/record-access/__tests__/fixtures/inconnectRecordAccessSettingsFixtures';
import {
  InconnectRecordAccessCacheStatus,
  InconnectRecordAccessConfigurationStatus,
  InconnectRecordAccessEnforcementMode,
  type InconnectRecordAccessSettingsConfiguration,
  type ReplaceInconnectRecordAccessConfigurationMutation,
  type ReplaceInconnectRecordAccessConfigurationMutationVariables,
} from '~/generated-metadata/graphql';

const { getInconnectRecordAccessAvailableMetadata: metadata } =
  availableMetadataFixture;
const commercialRoles = metadata.roles.filter(
  (role) => role.roleId !== ROLE_IDS.admin,
);
const { getInconnectRecordAccessConfiguration: initialConfiguration } =
  managedConfigurationFixture;

const rejectOperation = (message: string, subCode = 'BAD_USER_INPUT') =>
  of({ errors: [new GraphQLError(message, { extensions: { subCode } })] });

const toManagedObjects = (
  input: ReplaceInconnectRecordAccessConfigurationMutationVariables['input'],
  configuration: InconnectRecordAccessSettingsConfiguration,
): InconnectRecordAccessSettingsConfiguration['managedObjects'] =>
  input.managedObjects.map((managedObject) => {
    const object = metadata.objects.find(
      (candidate) =>
        candidate.objectMetadataId === managedObject.objectMetadataId,
    );
    const owner = object?.ownerFields.find(
      (field) => field.fieldMetadataId === managedObject.ownerFieldMetadataId,
    );
    if (!object || !owner) {
      throw new Error('Unknown demo object or owner field.');
    }

    const previous = configuration.managedObjects.find(
      (candidate) => candidate.objectMetadataId === object.objectMetadataId,
    );

    return {
      __typename: 'InconnectRecordAccessSettingsManagedObject',
      id: previous?.id ?? crypto.randomUUID(),
      ...managedObject,
      objectNameSingular: object.nameSingular,
      objectLabelSingular: object.labelSingular,
      objectUniversalIdentifier: object.universalIdentifier,
      ownerFieldName: owner.name,
      ownerFieldLabel: owner.label,
      ownerFieldUniversalIdentifier: owner.universalIdentifier,
      policies: input.policies
        .filter((policy) => policy.objectMetadataId === object.objectMetadataId)
        .map(({ objectMetadataId: _objectMetadataId, ...policy }) => {
          const role = commercialRoles.find(
            (candidate) => candidate.roleId === policy.roleId,
          );
          const defaultRole = commercialRoles.find(
            (candidate) => candidate.roleId === policy.defaultOwnerRoleId,
          );
          if (!role || (policy.defaultOwnerRoleId && !defaultRole)) {
            throw new Error('Unknown demo role.');
          }

          return {
            __typename: 'InconnectRecordAccessSettingsPolicy',
            id:
              previous?.policies.find((entry) => entry.roleId === role.roleId)
                ?.id ?? crypto.randomUUID(),
            ...policy,
            roleLabel: role.label,
            roleUniversalIdentifier: role.universalIdentifier,
            defaultOwnerRoleId: defaultRole?.roleId ?? null,
            defaultOwnerRoleLabel: defaultRole?.label ?? null,
          };
        }),
    };
  });

export const createRecordAccessStoryClient = (
  cacheStatus = InconnectRecordAccessCacheStatus.recomputed,
) => {
  let configuration: InconnectRecordAccessSettingsConfiguration = {
    ...initialConfiguration,
    managedObjects: initialConfiguration.managedObjects.map((object) => ({
      ...object,
      policies: object.policies.filter(
        (policy) => policy.roleId !== ROLE_IDS.admin,
      ),
    })),
  };

  // Only these three operations can reach the story's in-memory state.
  const link = new ApolloLink(({ operationName, variables }) => {
    switch (operationName) {
      case 'GetInconnectRecordAccessConfiguration':
        return of({
          data: { getInconnectRecordAccessConfiguration: configuration },
        });
      case 'GetInconnectRecordAccessAvailableMetadata':
        return of({
          data: {
            getInconnectRecordAccessAvailableMetadata: {
              ...metadata,
              roles: commercialRoles,
            },
          },
        });
      case 'ReplaceInconnectRecordAccessConfiguration': {
        const { input } =
          variables as Partial<ReplaceInconnectRecordAccessConfigurationMutationVariables>;
        if (!input) return rejectOperation('Missing demo configuration.');

        if (input.expectedRevision !== configuration.revision) {
          return rejectOperation(
            'Demo revision conflict.',
            'REVISION_CONFLICT',
          );
        }

        const unmanaged =
          input.enforcementMode ===
          InconnectRecordAccessEnforcementMode.UNMANAGED;
        const changedFromManagedToUnmanaged =
          unmanaged &&
          configuration.status ===
            InconnectRecordAccessConfigurationStatus.MANAGED;
        const revision = (
          BigInt(configuration.revision ?? '0') + 1n
        ).toString();

        try {
          configuration = {
            ...configuration,
            revision,
            enforcementMode: input.enforcementMode,
            status: unmanaged
              ? InconnectRecordAccessConfigurationStatus.UNMANAGED
              : InconnectRecordAccessConfigurationStatus.MANAGED,
            managedObjects: unmanaged
              ? []
              : toManagedObjects(input, configuration),
          };
        } catch {
          return rejectOperation('The demo cannot load the selected metadata.');
        }

        const data: ReplaceInconnectRecordAccessConfigurationMutation = {
          replaceInconnectRecordAccessConfiguration: {
            __typename: 'ReplaceInconnectRecordAccessConfigurationResult',
            revision,
            cacheStatus,
            changedFromManagedToUnmanaged,
          },
        };
        return of({ data });
      }
      default:
        return rejectOperation(
          'This operation is outside the Record Access demo.',
        );
    }
  });

  return new ApolloClient({ cache: new InMemoryCache(), link });
};
