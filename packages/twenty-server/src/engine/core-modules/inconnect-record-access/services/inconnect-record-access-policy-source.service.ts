import { Injectable } from '@nestjs/common';

import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { type InconnectRecordAccessWorkspacePolicy } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { getInconnectRecordAccessRuleKey } from 'src/engine/core-modules/inconnect-record-access/utils/get-inconnect-record-access-rule-key.util';
import { parseInconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-record-access-policy-maps.util';
import { validateInconnectRecordAccessPolicyMapsAgainstMetadata } from 'src/engine/core-modules/inconnect-record-access/utils/validate-inconnect-record-access-policy-maps-against-metadata.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

type ResolveWorkspacePolicySourceArgs = {
  workspaceId: string;
  flatRoleMaps: FlatEntityMaps<FlatRole>;
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
};

@Injectable()
export class InconnectRecordAccessPolicySourceService {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly envPolicyService: InconnectRecordAccessService,
  ) {}

  async resolveWorkspacePolicy(
    args: ResolveWorkspacePolicySourceArgs,
  ): Promise<InconnectRecordAccessWorkspacePolicy> {
    const sourceMode = this.twentyConfigService.get(
      'INCONNECT_RECORD_ACCESS_SOURCE_MODE',
    );

    if (sourceMode === 'env') {
      return this.envPolicyService.resolveWorkspacePolicy(args);
    }

    let policyMaps: InconnectRecordAccessPolicyMaps;

    try {
      const cacheResult = await this.workspaceCacheService.getOrRecompute(
        args.workspaceId,
        ['inconnectRecordAccessPolicyMaps'],
      );

      policyMaps = parseInconnectRecordAccessPolicyMaps(
        cacheResult.inconnectRecordAccessPolicyMaps,
      );
    } catch {
      return {
        status: 'invalid',
        reason: 'INCONNECT database policy cache is unavailable',
      };
    }

    if (policyMaps.status === 'absent') {
      return sourceMode === 'transition'
        ? this.envPolicyService.resolveWorkspacePolicy(args)
        : {
            status: 'invalid',
            reason: 'INCONNECT database configuration is absent',
          };
    }

    if (policyMaps.status === 'invalid') {
      return {
        status: 'invalid',
        reason: `INCONNECT database policy cache is ${policyMaps.failureKind}: ${policyMaps.reason}`,
      };
    }

    if (policyMaps.enforcementMode === 'UNMANAGED') {
      return { status: 'unmanaged' };
    }

    const metadataValidationError =
      validateInconnectRecordAccessPolicyMapsAgainstMetadata({
        workspaceId: args.workspaceId,
        policyMaps,
        flatRoleMaps: args.flatRoleMaps,
        flatObjectMetadataMaps: args.flatObjectMetadataMaps,
        flatFieldMetadataMaps: args.flatFieldMetadataMaps,
      });

    if (metadataValidationError) {
      return {
        status: 'invalid',
        reason: `INCONNECT database policy cache is invalid: ${metadataValidationError}`,
      };
    }

    const rules = policyMaps.managedObjects.flatMap((managedObject) =>
      managedObject.policies.map((policy) => ({
        roleId: policy.roleId,
        objectMetadataId: managedObject.objectMetadataId,
        ownerFieldMetadataId: managedObject.ownerFieldMetadataId,
        ownerFieldName: managedObject.ownerFieldName,
        ownerJoinColumnName: managedObject.ownerJoinColumnName,
        recordEffect: policy.recordEffect,
        createPolicy: policy.createPolicy,
        ownerTransferPolicy: policy.ownerTransferPolicy,
        ownerRequirement: managedObject.ownerRequirement,
        missingOwnerPolicy: policy.missingOwnerPolicy,
        ...(policy.defaultOwnerRoleId
          ? { defaultOwnerRoleId: policy.defaultOwnerRoleId }
          : {}),
      })),
    );

    return {
      status: 'configured',
      managedObjectMetadataIds: policyMaps.managedObjects.map(
        (managedObject) => managedObject.objectMetadataId,
      ),
      ruleByObjectMetadataIdAndRoleId: Object.fromEntries(
        rules.map((rule) => [
          getInconnectRecordAccessRuleKey({
            objectMetadataId: rule.objectMetadataId,
            roleId: rule.roleId,
          }),
          rule,
        ]),
      ),
      rules,
    };
  }
}
