import { Injectable } from '@nestjs/common';
import { isNonEmptyString } from '@sniptt/guards';

import { FieldMetadataType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type InconnectRecordAccessConfig } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import {
  type InconnectRecordAccessWorkspacePolicy,
  type ResolvedInconnectRecordAccessRule,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { getInconnectRecordAccessRuleKey } from 'src/engine/core-modules/inconnect-record-access/utils/get-inconnect-record-access-rule-key.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { isMorphOrRelationFlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/utils/is-morph-or-relation-flat-field-metadata.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';

type ResolveWorkspacePolicyArgs = {
  workspaceId: string;
  flatRoleMaps: FlatEntityMaps<FlatRole>;
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const resolveRecordEffect = (
  effect: unknown,
): ResolvedInconnectRecordAccessRule['recordEffect'] | undefined => {
  if (
    effect === 'ownerEqualsAuthenticatedWorkspaceMember' ||
    effect === 'ownRecords'
  ) {
    return 'ownRecords';
  }

  if (effect === 'ownAndTeamRecords' || effect === 'allRecords') {
    return effect;
  }

  return undefined;
};

const resolveCreatePolicy = (
  createPolicy: unknown,
): ResolvedInconnectRecordAccessRule['createPolicy'] | undefined => {
  if (createPolicy === undefined) {
    return 'denied';
  }

  if (
    createPolicy === 'denied' ||
    createPolicy === 'defaultOwner' ||
    createPolicy === 'assignableOwners' ||
    createPolicy === 'standardPermissionsOnly'
  ) {
    return createPolicy;
  }

  return undefined;
};

const resolveOwnerTransferPolicy = (
  ownerTransferPolicy: unknown,
): ResolvedInconnectRecordAccessRule['ownerTransferPolicy'] | undefined => {
  if (ownerTransferPolicy === undefined) {
    return 'denied';
  }

  if (
    ownerTransferPolicy === 'denied' ||
    ownerTransferPolicy === 'assignableOwners' ||
    ownerTransferPolicy === 'standardPermissionsOnly'
  ) {
    return ownerTransferPolicy;
  }

  return undefined;
};

const resolveOwnerRequirement = (
  ownerRequirement: unknown,
): ResolvedInconnectRecordAccessRule['ownerRequirement'] | undefined => {
  if (ownerRequirement === undefined) {
    return 'required';
  }

  if (ownerRequirement === 'required' || ownerRequirement === 'optional') {
    return ownerRequirement;
  }

  return undefined;
};

const resolveMissingOwnerPolicy = ({
  missingOwnerPolicy,
  createPolicy,
}: {
  missingOwnerPolicy: unknown;
  createPolicy: ResolvedInconnectRecordAccessRule['createPolicy'] | undefined;
}): ResolvedInconnectRecordAccessRule['missingOwnerPolicy'] | undefined => {
  if (missingOwnerPolicy === undefined) {
    if (
      createPolicy === 'defaultOwner' ||
      createPolicy === 'assignableOwners'
    ) {
      return 'self';
    }

    return 'requireExplicit';
  }

  if (
    missingOwnerPolicy === 'self' ||
    missingOwnerPolicy === 'requireExplicit' ||
    missingOwnerPolicy === 'singleActiveMemberOfRole' ||
    missingOwnerPolicy === 'standard'
  ) {
    return missingOwnerPolicy;
  }

  return undefined;
};

const isValidOwnerIntegrityCombination = ({
  createPolicy,
  ownerRequirement,
  missingOwnerPolicy,
  hasDefaultOwnerRole,
}: {
  createPolicy: ResolvedInconnectRecordAccessRule['createPolicy'];
  ownerRequirement: ResolvedInconnectRecordAccessRule['ownerRequirement'];
  missingOwnerPolicy: ResolvedInconnectRecordAccessRule['missingOwnerPolicy'];
  hasDefaultOwnerRole: boolean;
}): boolean => {
  if (
    (missingOwnerPolicy === 'singleActiveMemberOfRole') !==
    hasDefaultOwnerRole
  ) {
    return false;
  }

  if (ownerRequirement === 'optional') {
    return missingOwnerPolicy === 'standard' && !hasDefaultOwnerRole;
  }

  if (missingOwnerPolicy === 'standard') {
    return false;
  }

  if (createPolicy === 'denied') {
    return missingOwnerPolicy === 'requireExplicit';
  }

  if (createPolicy === 'defaultOwner' || createPolicy === 'assignableOwners') {
    return missingOwnerPolicy === 'self';
  }

  return true;
};

@Injectable()
export class InconnectRecordAccessService {
  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  resolveWorkspacePolicy({
    workspaceId,
    flatRoleMaps,
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
  }: ResolveWorkspacePolicyArgs): InconnectRecordAccessWorkspacePolicy {
    const config = this.twentyConfigService.get(
      'INCONNECT_RECORD_ACCESS_CONFIG',
    );

    if (!this.isValidConfigContainer(config)) {
      return {
        status: 'invalid',
        reason:
          'INCONNECT_RECORD_ACCESS_CONFIG must contain a workspaces array',
      };
    }

    const workspaceConfigs = config.workspaces.filter(
      (workspaceConfig) => workspaceConfig.workspaceId === workspaceId,
    );

    if (workspaceConfigs.length === 0) {
      return { status: 'not-configured' };
    }

    if (workspaceConfigs.length !== 1) {
      return {
        status: 'invalid',
        reason: `Workspace ${workspaceId} is configured more than once`,
      };
    }

    const workspaceConfig = workspaceConfigs[0];

    if (
      !Array.isArray(workspaceConfig.rules) ||
      workspaceConfig.rules.length === 0
    ) {
      return {
        status: 'invalid',
        reason: `Workspace ${workspaceId} must contain at least one rule`,
      };
    }

    const resolvedRules: ResolvedInconnectRecordAccessRule[] = [];
    const configuredRoleAndObjectPairs = new Set<string>();
    const configuredOwnerIntegrityByObjectId = new Map<
      string,
      Pick<
        ResolvedInconnectRecordAccessRule,
        'ownerFieldMetadataId' | 'ownerRequirement'
      >
    >();

    for (const rule of workspaceConfig.rules) {
      const resolvedRule = this.resolveRule({
        rule,
        flatRoleMaps,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
      });

      if (typeof resolvedRule === 'string') {
        return { status: 'invalid', reason: resolvedRule };
      }

      const roleAndObjectPair = `${resolvedRule.roleId}:${resolvedRule.objectMetadataId}`;

      if (configuredRoleAndObjectPairs.has(roleAndObjectPair)) {
        return {
          status: 'invalid',
          reason: 'A role and object pair can only have one owner rule',
        };
      }

      configuredRoleAndObjectPairs.add(roleAndObjectPair);
      const configuredOwnerIntegrity = configuredOwnerIntegrityByObjectId.get(
        resolvedRule.objectMetadataId,
      );

      if (
        isDefined(configuredOwnerIntegrity) &&
        (configuredOwnerIntegrity.ownerFieldMetadataId !==
          resolvedRule.ownerFieldMetadataId ||
          configuredOwnerIntegrity.ownerRequirement !==
            resolvedRule.ownerRequirement)
      ) {
        return {
          status: 'invalid',
          reason:
            'All rules for an INCONNECT-managed object must share its owner field and owner requirement',
        };
      }

      configuredOwnerIntegrityByObjectId.set(resolvedRule.objectMetadataId, {
        ownerFieldMetadataId: resolvedRule.ownerFieldMetadataId,
        ownerRequirement: resolvedRule.ownerRequirement,
      });
      resolvedRules.push(resolvedRule);
    }

    return {
      status: 'configured',
      managedObjectMetadataIds: [
        ...new Set(resolvedRules.map((rule) => rule.objectMetadataId)),
      ],
      ruleByObjectMetadataIdAndRoleId: Object.fromEntries(
        resolvedRules.map((rule) => [
          getInconnectRecordAccessRuleKey({
            objectMetadataId: rule.objectMetadataId,
            roleId: rule.roleId,
          }),
          rule,
        ]),
      ),
      rules: resolvedRules,
    };
  }

  private isValidConfigContainer(
    config: unknown,
  ): config is InconnectRecordAccessConfig {
    if (!isRecord(config) || !Array.isArray(config.workspaces)) {
      return false;
    }

    return config.workspaces.every(
      (workspaceConfig) =>
        isRecord(workspaceConfig) &&
        isNonEmptyString(workspaceConfig.workspaceId),
    );
  }

  private resolveRule({
    rule,
    flatRoleMaps,
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
  }: {
    rule: unknown;
    flatRoleMaps: FlatEntityMaps<FlatRole>;
    flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
    flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  }): ResolvedInconnectRecordAccessRule | string {
    const legacyEffect = isRecord(rule)
      ? resolveRecordEffect(rule.effect)
      : undefined;
    const configuredRecordEffect = isRecord(rule)
      ? resolveRecordEffect(rule.recordEffect)
      : undefined;
    const hasLegacyEffect = isRecord(rule) && rule.effect !== undefined;
    const hasRecordEffect = isRecord(rule) && rule.recordEffect !== undefined;
    const recordEffect = configuredRecordEffect ?? legacyEffect;
    const createPolicy = isRecord(rule)
      ? resolveCreatePolicy(rule.createPolicy)
      : undefined;
    const ownerTransferPolicy = isRecord(rule)
      ? resolveOwnerTransferPolicy(rule.ownerTransferPolicy)
      : undefined;
    const ownerRequirement = isRecord(rule)
      ? resolveOwnerRequirement(rule.ownerRequirement)
      : undefined;
    const missingOwnerPolicy = isRecord(rule)
      ? resolveMissingOwnerPolicy({
          missingOwnerPolicy: rule.missingOwnerPolicy,
          createPolicy,
        })
      : undefined;
    const hasDefaultOwnerRole =
      isRecord(rule) && rule.defaultOwnerRoleUniversalIdentifier !== undefined;
    const hasInvalidOrAmbiguousRecordEffect =
      (!hasLegacyEffect && !hasRecordEffect) ||
      (hasLegacyEffect && !isDefined(legacyEffect)) ||
      (hasRecordEffect && !isDefined(configuredRecordEffect)) ||
      (isDefined(legacyEffect) &&
        isDefined(configuredRecordEffect) &&
        legacyEffect !== configuredRecordEffect);

    if (
      !isRecord(rule) ||
      !isNonEmptyString(rule.roleUniversalIdentifier) ||
      !isNonEmptyString(rule.objectUniversalIdentifier) ||
      !isNonEmptyString(rule.ownerFieldUniversalIdentifier) ||
      rule.principal !== 'workspaceMember' ||
      hasInvalidOrAmbiguousRecordEffect ||
      !isDefined(recordEffect) ||
      !isDefined(createPolicy) ||
      !isDefined(ownerTransferPolicy) ||
      !isDefined(ownerRequirement) ||
      !isDefined(missingOwnerPolicy)
    ) {
      return 'INCONNECT owner rule has an invalid shape';
    }

    if (
      !isValidOwnerIntegrityCombination({
        createPolicy,
        ownerRequirement,
        missingOwnerPolicy,
        hasDefaultOwnerRole,
      }) ||
      (hasDefaultOwnerRole &&
        !isNonEmptyString(rule.defaultOwnerRoleUniversalIdentifier))
    ) {
      return 'INCONNECT owner integrity policy has an invalid shape';
    }

    const role =
      flatRoleMaps.byUniversalIdentifier[rule.roleUniversalIdentifier];
    const defaultOwnerRole =
      missingOwnerPolicy === 'singleActiveMemberOfRole'
        ? flatRoleMaps.byUniversalIdentifier[
            rule.defaultOwnerRoleUniversalIdentifier as string
          ]
        : undefined;
    const objectMetadata =
      flatObjectMetadataMaps.byUniversalIdentifier[
        rule.objectUniversalIdentifier
      ];
    const ownerField =
      flatFieldMetadataMaps.byUniversalIdentifier[
        rule.ownerFieldUniversalIdentifier
      ];

    if (!isDefined(role)) {
      return `Configured role ${rule.roleUniversalIdentifier} does not exist`;
    }

    if (
      missingOwnerPolicy === 'singleActiveMemberOfRole' &&
      !isDefined(defaultOwnerRole)
    ) {
      return `Configured default owner role ${rule.defaultOwnerRoleUniversalIdentifier} does not exist`;
    }

    if (!isDefined(objectMetadata)) {
      return `Configured object ${rule.objectUniversalIdentifier} does not exist`;
    }

    if (!isDefined(ownerField)) {
      return `Configured owner field ${rule.ownerFieldUniversalIdentifier} does not exist`;
    }

    if (ownerField.objectMetadataId !== objectMetadata.id) {
      return 'Configured owner field does not belong to the configured object';
    }

    if (
      ownerField.type !== FieldMetadataType.RELATION ||
      !isMorphOrRelationFlatFieldMetadata(ownerField) ||
      ownerField.settings?.relationType !== RelationType.MANY_TO_ONE
    ) {
      return 'Configured owner field must be a MANY_TO_ONE relation';
    }

    const targetObjectUniversalIdentifier =
      flatObjectMetadataMaps.universalIdentifierById[
        ownerField.relationTargetObjectMetadataId
      ];
    const targetObjectMetadata = isDefined(targetObjectUniversalIdentifier)
      ? flatObjectMetadataMaps.byUniversalIdentifier[
          targetObjectUniversalIdentifier
        ]
      : undefined;

    if (
      !isDefined(targetObjectMetadata) ||
      targetObjectMetadata.nameSingular !== 'workspaceMember'
    ) {
      return 'Configured owner field must target workspaceMember';
    }

    return {
      roleId: role.id,
      objectMetadataId: objectMetadata.id,
      ownerFieldMetadataId: ownerField.id,
      ownerFieldName: ownerField.name,
      ownerJoinColumnName: computeMorphOrRelationFieldJoinColumnName({
        name: ownerField.name,
      }),
      recordEffect,
      createPolicy,
      ownerTransferPolicy,
      ownerRequirement,
      missingOwnerPolicy,
      ...(isDefined(defaultOwnerRole)
        ? { defaultOwnerRoleId: defaultOwnerRole.id }
        : {}),
    };
  }
}
