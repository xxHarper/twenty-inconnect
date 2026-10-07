import { Injectable } from '@nestjs/common';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { FieldMetadataType } from 'twenty-shared/types';
import { isDefined, normalizePhoneIdentity } from 'twenty-shared/utils';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type InternalCreateWriteReceipt } from 'src/engine/api/common/types/internal-create-write-receipt.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { fromWorkspaceEntityToFlat } from 'src/engine/core-modules/workspace/utils/from-workspace-entity-to-flat.util';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import {
  InconnectMessagingAutoCreateAuthorityException,
  InconnectMessagingAutoCreateAuthorityExceptionCode,
} from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import {
  type InconnectMessagingAutoCreateAuthority,
  type InconnectMessagingAutoCreateAuthorityPlan,
  InconnectMessagingAutoCreateAuthorityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';

type ExecuteAutomationRecordCreateInput = Readonly<{
  workspaceId: string;
  canonicalPhoneIdentity: string;
  authority: InconnectMessagingAutoCreateAuthority;
  queryRunner: WorkspaceQueryRunner;
}>;

const throwAuthorityDenied = (message: string): never => {
  throw new InconnectMessagingAutoCreateAuthorityException(
    message,
    InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
  );
};

const assertExactDeliberateFields = (
  plan: InconnectMessagingAutoCreateAuthorityPlan,
): void => {
  const expectedFieldMetadataIds = new Set([
    plan.primaryPhoneFieldMetadataId,
    plan.ownerFieldMetadataId,
  ]);

  if (
    plan.primaryPhoneFieldName === plan.ownerFieldName ||
    expectedFieldMetadataIds.size !== 2 ||
    plan.allowedFieldMetadataIds.length !== expectedFieldMetadataIds.size ||
    plan.allowedFieldMetadataIds.some(
      (fieldMetadataId) => !expectedFieldMetadataIds.has(fieldMetadataId),
    )
  ) {
    throwAuthorityDenied(
      'Messaging automation create field allowlist is not exactly PRIMARY plus Owner',
    );
  }
};

// This provider is intentionally module-private. It accepts only semantic
// phone identity plus transaction-bound authority and constructs one exact CRM write.
@Injectable()
export class InconnectMessagingAutomationRecordCreateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorityService: InconnectMessagingAutoCreateAuthorityService,
    private readonly automationPrincipalService: InconnectMessagingAutomationPrincipalService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly commonCreateOneQueryRunnerService: CommonCreateOneQueryRunnerService,
  ) {}

  async execute({
    workspaceId,
    canonicalPhoneIdentity,
    authority,
    queryRunner,
  }: ExecuteAutomationRecordCreateInput): Promise<InternalCreateWriteReceipt> {
    const plan = await this.authorityService.revalidateCreatePlan({
      authority,
      queryRunner,
      workspaceId,
    });
    const manager = this.dataSource.createEntityManager(queryRunner);
    const principalValidation = await this.automationPrincipalService.validate({
      manager,
      workspaceId,
      lock: true,
    });

    if (principalValidation.status !== 'VALID') {
      return throwAuthorityDenied(
        `Messaging automation principal is not ready: ${principalValidation.reason}`,
      );
    }

    const principal = principalValidation.principal;

    if (
      principal.workspaceId !== plan.workspaceId ||
      principal.userId !== plan.automationUserId ||
      principal.userWorkspaceId !== plan.automationUserWorkspaceId ||
      principal.workspaceMemberId !== plan.automationWorkspaceMemberId ||
      principal.roleId !== plan.automationRoleId ||
      principal.name !== plan.automationPrincipalName ||
      principal.workspaceMemberId === plan.ownerWorkspaceMemberId
    ) {
      return throwAuthorityDenied(
        'Messaging automation principal no longer matches the transaction-bound plan',
      );
    }

    assertExactDeliberateFields(plan);

    const canonicalIdentity = normalizePhoneIdentity(canonicalPhoneIdentity);
    const parsedPhone =
      canonicalIdentity === canonicalPhoneIdentity
        ? parsePhoneNumberFromString(canonicalIdentity)
        : undefined;

    if (parsedPhone?.isValid() !== true || parsedPhone.country === undefined) {
      return throwAuthorityDenied(
        'Messaging automation create requires a canonical international phone identity',
      );
    }

    const {
      flatWorkspaceMemberMaps,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatWorkspaceMemberMaps',
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'flatIndexMaps',
    ]);
    const workspaceMember =
      flatWorkspaceMemberMaps.byId[principal.workspaceMemberId];
    const flatObjectMetadata = findFlatEntityByIdInFlatEntityMaps({
      flatEntityId: plan.objectMetadataId,
      flatEntityMaps: flatObjectMetadataMaps,
    });
    const primaryPhoneFieldMetadata = findFlatEntityByIdInFlatEntityMaps({
      flatEntityId: plan.primaryPhoneFieldMetadataId,
      flatEntityMaps: flatFieldMetadataMaps,
    });
    const ownerFieldMetadata = findFlatEntityByIdInFlatEntityMaps({
      flatEntityId: plan.ownerFieldMetadataId,
      flatEntityMaps: flatFieldMetadataMaps,
    });

    if (
      !isDefined(workspaceMember) ||
      workspaceMember.id !== principal.workspaceMemberId ||
      workspaceMember.userId !== principal.userId ||
      workspaceMember.name.firstName !==
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME ||
      workspaceMember.name.lastName !==
        INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME ||
      isDefined(workspaceMember.deletedAt) ||
      !isDefined(flatObjectMetadata) ||
      flatObjectMetadata.id !== plan.objectMetadataId ||
      flatObjectMetadata.workspaceId !== workspaceId ||
      flatObjectMetadata.nameSingular !== plan.objectMetadataNameSingular ||
      !isDefined(primaryPhoneFieldMetadata) ||
      primaryPhoneFieldMetadata.objectMetadataId !== plan.objectMetadataId ||
      primaryPhoneFieldMetadata.name !== plan.primaryPhoneFieldName ||
      primaryPhoneFieldMetadata.type !== FieldMetadataType.PHONES ||
      !isDefined(ownerFieldMetadata) ||
      ownerFieldMetadata.objectMetadataId !== plan.objectMetadataId ||
      ownerFieldMetadata.name !== plan.ownerFieldName ||
      ownerFieldMetadata.type !== FieldMetadataType.RELATION
    ) {
      return throwAuthorityDenied(
        'Messaging automation create metadata or WorkspaceMember context is unavailable',
      );
    }

    const userWorkspace = await this.resolveUserWorkspace({
      manager,
      plan,
      workspaceId,
    });
    const authContext = buildUserAuthContext({
      workspace: fromWorkspaceEntityToFlat(userWorkspace.workspace),
      userWorkspaceId: userWorkspace.id,
      user: fromUserEntityToFlat(userWorkspace.user),
      workspaceMemberId: workspaceMember.id,
      workspaceMember,
    });
    const deliberatePayload = {
      [plan.primaryPhoneFieldName]: {
        primaryPhoneCountryCode: parsedPhone.country,
        primaryPhoneCallingCode: `+${parsedPhone.countryCallingCode}`,
        primaryPhoneNumber: parsedPhone.nationalNumber,
        additionalPhones: null,
      },
      [plan.ownerFieldName]: {
        connect: { where: { id: plan.ownerWorkspaceMemberId } },
      },
    };

    if (
      Object.keys(deliberatePayload).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(
        deliberatePayload,
        plan.primaryPhoneFieldName,
      ) ||
      !Object.prototype.hasOwnProperty.call(
        deliberatePayload,
        plan.ownerFieldName,
      )
    ) {
      return throwAuthorityDenied(
        'Messaging automation create payload is not exactly PRIMARY plus Owner',
      );
    }

    await this.authorityService.assertCreateScope({
      authority,
      queryRunner,
      workspaceId,
      objectMetadataId: flatObjectMetadata.id,
      ownerWorkspaceMemberId: plan.ownerWorkspaceMemberId,
      fieldMetadataIds: [primaryPhoneFieldMetadata.id, ownerFieldMetadata.id],
    });

    const { idByNameSingular } = buildObjectIdByNameMaps(
      flatObjectMetadataMaps,
    );

    return this.commonCreateOneQueryRunnerService.executeCreateOnlyForWriteReceiptWithQueryRunner(
      { data: deliberatePayload },
      {
        authContext,
        flatObjectMetadata,
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
        flatIndexMaps,
        objectIdByNameSingular: idByNameSingular,
      },
      queryRunner,
    );
  }

  private async resolveUserWorkspace({
    manager,
    plan,
    workspaceId,
  }: {
    manager: EntityManager;
    plan: InconnectMessagingAutoCreateAuthorityPlan;
    workspaceId: string;
  }): Promise<UserWorkspaceEntity> {
    const userWorkspace = await manager
      .getRepository(UserWorkspaceEntity)
      .findOne({
        where: {
          id: plan.automationUserWorkspaceId,
          userId: plan.automationUserId,
          workspaceId,
          deletedAt: IsNull(),
        },
        relations: { user: true, workspace: true },
      });

    if (
      userWorkspace === null ||
      !isDefined(userWorkspace.user) ||
      !isDefined(userWorkspace.workspace) ||
      userWorkspace.user.id !== plan.automationUserId ||
      userWorkspace.workspace.id !== workspaceId
    ) {
      return throwAuthorityDenied(
        'Messaging automation user auth context is unavailable',
      );
    }

    return userWorkspace;
  }
}
