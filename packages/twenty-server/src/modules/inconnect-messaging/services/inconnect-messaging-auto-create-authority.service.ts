import { Injectable } from '@nestjs/common';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { DataSource, type EntityManager } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { resolveInconnectSingleActiveMemberOfRole } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-single-active-member-of-role.util';
import { InconnectMessagingAutoCreatePrimaryStatusDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import {
  InconnectMessagingAutoCreateAuthorityException,
  InconnectMessagingAutoCreateAuthorityExceptionCode,
} from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-auto-create-authority.exception';
import { InconnectMessagingAutoCreateEligibilityService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';
import { findInconnectMessagingAutoCreateOwnerFields } from 'src/modules/inconnect-messaging/utils/find-inconnect-messaging-auto-create-owner-fields.util';
import { InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';

declare const INCONNECT_MESSAGING_AUTO_CREATE_AUTHORITY_BRAND: unique symbol;

export type InconnectMessagingAutoCreateAuthority = Readonly<{
  [INCONNECT_MESSAGING_AUTO_CREATE_AUTHORITY_BRAND]: true;
}>;

export type InconnectMessagingAutoCreateAuthorityPlan = Readonly<{
  workspaceId: string;
  objectMetadataId: string;
  objectMetadataNameSingular: string;
  configurationRevision: string;
  configurationUpdatedAt: string;
  primaryPhoneIdentityFieldId: string;
  primaryPhoneFieldMetadataId: string;
  primaryPhoneFieldName: string;
  ownerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE';
  ownerRoleId: string;
  ownerWorkspaceMemberId: string;
  ownerFieldMetadataId: string;
  ownerFieldName: string;
  ownerJoinColumnName: string;
  allowedFieldMetadataIds: readonly string[];
  automationUserId: string;
  automationUserWorkspaceId: string;
  automationWorkspaceMemberId: string;
  automationRoleId: string;
  automationPrincipalName: string;
}>;

type AuthoritySnapshot = {
  queryRunner: WorkspaceQueryRunner;
  transactionId: string;
  plan: InconnectMessagingAutoCreateAuthorityPlan;
};

type TransactionIdRow = {
  transactionId: string;
};

const throwAuthorityException = (
  message: string,
  code: InconnectMessagingAutoCreateAuthorityExceptionCode,
): never => {
  throw new InconnectMessagingAutoCreateAuthorityException(message, code);
};

const freezePlan = (
  plan: InconnectMessagingAutoCreateAuthorityPlan,
): InconnectMessagingAutoCreateAuthorityPlan =>
  Object.freeze({
    ...plan,
    allowedFieldMetadataIds: Object.freeze([...plan.allowedFieldMetadataIds]),
  });

// This provider intentionally has no public controller, resolver, or module export.
// The capability it issues is valid only in the exact transaction that validated it.
@Injectable()
export class InconnectMessagingAutoCreateAuthorityService {
  private readonly snapshots = new WeakMap<
    InconnectMessagingAutoCreateAuthority,
    AuthoritySnapshot
  >();

  constructor(
    private readonly dataSource: DataSource,
    private readonly eligibilityService: InconnectMessagingAutoCreateEligibilityService,
    private readonly primaryValidatorService: InconnectMessagingAutoCreatePrimaryValidatorService,
    private readonly automationPrincipalService: InconnectMessagingAutomationPrincipalService,
  ) {}

  async issueAuthority({
    workspaceId,
    queryRunner,
  }: {
    workspaceId: string;
    queryRunner: WorkspaceQueryRunner;
  }): Promise<InconnectMessagingAutoCreateAuthority> {
    this.assertTransactionActive(queryRunner);

    const transactionId = await this.getTransactionId(queryRunner);
    const manager = this.dataSource.createEntityManager(queryRunner);
    const plan = await this.buildPlan({ manager, queryRunner, workspaceId });
    const authority = Object.freeze(
      {},
    ) as InconnectMessagingAutoCreateAuthority;

    this.snapshots.set(authority, {
      queryRunner,
      transactionId,
      plan: freezePlan(plan),
    });

    return authority;
  }

  async resolveCreatePlan({
    authority,
    queryRunner,
    workspaceId,
  }: {
    authority: InconnectMessagingAutoCreateAuthority;
    queryRunner: WorkspaceQueryRunner;
    workspaceId: string;
  }): Promise<InconnectMessagingAutoCreateAuthorityPlan> {
    this.assertTransactionActive(queryRunner);

    const snapshot = this.snapshots.get(authority);

    if (snapshot === undefined || snapshot.queryRunner !== queryRunner) {
      return throwAuthorityException(
        'Messaging auto-create authority is unknown or belongs to another transaction',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const currentTransactionId = await this.getTransactionId(queryRunner);

    if (currentTransactionId !== snapshot.transactionId) {
      return throwAuthorityException(
        'Messaging auto-create authority cannot cross transaction boundaries',
        InconnectMessagingAutoCreateAuthorityExceptionCode.INVALID_TRANSACTION,
      );
    }

    if (workspaceId !== snapshot.plan.workspaceId) {
      return throwAuthorityException(
        'Messaging auto-create authority cannot target another workspace',
        InconnectMessagingAutoCreateAuthorityExceptionCode.SCOPE_MISMATCH,
      );
    }

    return snapshot.plan;
  }

  async assertCreateScope({
    authority,
    queryRunner,
    workspaceId,
    objectMetadataId,
    ownerWorkspaceMemberId,
    fieldMetadataIds,
  }: {
    authority: InconnectMessagingAutoCreateAuthority;
    queryRunner: WorkspaceQueryRunner;
    workspaceId: string;
    objectMetadataId: string;
    ownerWorkspaceMemberId: string;
    fieldMetadataIds: readonly string[];
  }): Promise<InconnectMessagingAutoCreateAuthorityPlan> {
    const plan = await this.resolveCreatePlan({
      authority,
      queryRunner,
      workspaceId,
    });
    const allowedFields = new Set(plan.allowedFieldMetadataIds);

    if (
      objectMetadataId !== plan.objectMetadataId ||
      ownerWorkspaceMemberId !== plan.ownerWorkspaceMemberId ||
      fieldMetadataIds.length !== allowedFields.size ||
      fieldMetadataIds.some(
        (fieldMetadataId) => !allowedFields.has(fieldMetadataId),
      )
    ) {
      return throwAuthorityException(
        'Messaging auto-create authority scope does not match the requested create',
        InconnectMessagingAutoCreateAuthorityExceptionCode.SCOPE_MISMATCH,
      );
    }

    return plan;
  }

  private async buildPlan({
    manager,
    queryRunner,
    workspaceId,
  }: {
    manager: EntityManager;
    queryRunner: WorkspaceQueryRunner;
    workspaceId: string;
  }): Promise<InconnectMessagingAutoCreateAuthorityPlan> {
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .createQueryBuilder('configuration')
      .setLock('pessimistic_read')
      .where('configuration.workspaceId = :workspaceId', { workspaceId })
      .getOne();

    if (
      configuration === null ||
      configuration.autoCreateEnabled !== true ||
      configuration.autoCreateAnchorObjectMetadataId === null ||
      configuration.autoCreateOwnerStrategy !==
        'UNIQUE_ACTIVE_MEMBER_OF_ROLE' ||
      configuration.autoCreateOwnerRoleId === null ||
      configuration.autoCreateLabelPolicy !== 'OMIT' ||
      configuration.autoCreateAnchorObjectMetadataId !==
        configuration.anchorObjectMetadataId
    ) {
      return throwAuthorityException(
        'Messaging auto-create configuration is not currently valid for execution',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const workspace = await manager
      .getRepository(WorkspaceEntity)
      .createQueryBuilder('workspace')
      .setLock('pessimistic_read')
      .where('workspace.id = :workspaceId', { workspaceId })
      .getOne();
    const anchorObject = await manager
      .getRepository(ObjectMetadataEntity)
      .createQueryBuilder('anchorObject')
      .setLock('pessimistic_read')
      .where('anchorObject.id = :anchorObjectMetadataId', {
        anchorObjectMetadataId: configuration.anchorObjectMetadataId,
      })
      .andWhere('anchorObject.workspaceId = :workspaceId', { workspaceId })
      .getOne();
    const workspaceMemberObject = await manager
      .getRepository(ObjectMetadataEntity)
      .createQueryBuilder('workspaceMemberObject')
      .setLock('pessimistic_read')
      .where('workspaceMemberObject.workspaceId = :workspaceId', {
        workspaceId,
      })
      .andWhere(
        'workspaceMemberObject.universalIdentifier = :universalIdentifier',
        {
          universalIdentifier:
            STANDARD_OBJECTS.workspaceMember.universalIdentifier,
        },
      )
      .getOne();

    if (
      workspace?.databaseSchema === undefined ||
      workspace.databaseSchema === null ||
      anchorObject === null ||
      workspaceMemberObject === null
    ) {
      return throwAuthorityException(
        'Messaging auto-create metadata authority is unavailable',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const ownerWorkspaceMemberId =
      await resolveInconnectSingleActiveMemberOfRole({
        queryRunner,
        workspaceId,
        workspaceSchema: workspace.databaseSchema,
        roleId: configuration.autoCreateOwnerRoleId,
      });
    const ownerRole = await manager.getRepository(RoleEntity).findOne({
      where: {
        id: configuration.autoCreateOwnerRoleId,
        workspaceId,
      },
    });

    if (ownerRole?.canBeAssignedToUsers !== true) {
      return throwAuthorityException(
        'Messaging auto-create owner Role is not assignable in this workspace',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const fields = await manager
      .getRepository(FieldMetadataEntity)
      .createQueryBuilder('field')
      .setLock('pessimistic_read')
      .where('field.workspaceId = :workspaceId', { workspaceId })
      .andWhere('field.objectMetadataId = :objectMetadataId', {
        objectMetadataId: anchorObject.id,
      })
      .getMany();
    const phoneIdentityFields = await manager
      .getRepository(InconnectMessagingPhoneIdentityFieldEntity)
      .createQueryBuilder('phoneIdentityField')
      .setLock('pessimistic_read')
      .where('phoneIdentityField.workspaceId = :workspaceId', {
        workspaceId,
      })
      .orderBy('phoneIdentityField.ordinal', 'ASC')
      .addOrderBy('phoneIdentityField.id', 'ASC')
      .getMany();
    const primaryPhoneIdentity = await this.primaryValidatorService.evaluate({
      manager,
      configuration,
    });
    const eligibility = await this.eligibilityService.evaluate({
      manager,
      configuration,
      anchorObject,
      ownerRoleIsValid: true,
      primaryPhoneIdentity,
    });

    if (
      eligibility.status !== 'ELIGIBLE' ||
      primaryPhoneIdentity.summary.status !==
        InconnectMessagingAutoCreatePrimaryStatusDTO.VALID ||
      primaryPhoneIdentity.summary.fieldMetadataId === null
    ) {
      return throwAuthorityException(
        'Messaging auto-create invariants are not currently eligible',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const primaryIdentityRows = phoneIdentityFields.filter(
      ({ role }) => role === 'PRIMARY',
    );
    const primaryPhoneField = fields.find(
      ({ id }) => id === primaryPhoneIdentity.summary.fieldMetadataId,
    );
    const ownerFields = findInconnectMessagingAutoCreateOwnerFields({
      fields,
      workspaceMemberObjectMetadataId: workspaceMemberObject.id,
    });

    if (
      primaryIdentityRows.length !== 1 ||
      primaryPhoneField === undefined ||
      primaryIdentityRows[0].fieldMetadataId !== primaryPhoneField.id ||
      ownerFields.length !== 1
    ) {
      return throwAuthorityException(
        'Messaging auto-create field authority is ambiguous or unavailable',
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }

    const ownerField = ownerFields[0];
    const principalValidation = await this.automationPrincipalService.validate({
      lock: true,
      manager,
      workspaceId,
    });

    if (principalValidation.status !== 'VALID') {
      return throwAuthorityException(
        `Messaging automation principal is not ready: ${principalValidation.reason}`,
        InconnectMessagingAutoCreateAuthorityExceptionCode.AUTHORITY_DENIED,
      );
    }
    const principal = principalValidation.principal;

    return {
      workspaceId,
      objectMetadataId: anchorObject.id,
      objectMetadataNameSingular: anchorObject.nameSingular,
      configurationRevision: configuration.revision,
      configurationUpdatedAt: configuration.updatedAt.toISOString(),
      primaryPhoneIdentityFieldId: primaryIdentityRows[0].id,
      primaryPhoneFieldMetadataId: primaryPhoneField.id,
      primaryPhoneFieldName: primaryPhoneField.name,
      ownerStrategy: 'UNIQUE_ACTIVE_MEMBER_OF_ROLE',
      ownerRoleId: ownerRole.id,
      ownerWorkspaceMemberId,
      ownerFieldMetadataId: ownerField.id,
      ownerFieldName: ownerField.name,
      ownerJoinColumnName: computeMorphOrRelationFieldJoinColumnName({
        name: ownerField.name,
      }),
      allowedFieldMetadataIds: [primaryPhoneField.id, ownerField.id],
      automationUserId: principal.userId,
      automationUserWorkspaceId: principal.userWorkspaceId,
      automationWorkspaceMemberId: principal.workspaceMemberId,
      automationRoleId: principal.roleId,
      automationPrincipalName: principal.name,
    };
  }

  private assertTransactionActive(queryRunner: WorkspaceQueryRunner): void {
    if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
      throwAuthorityException(
        'Messaging auto-create authority requires an active caller-owned transaction',
        InconnectMessagingAutoCreateAuthorityExceptionCode.INVALID_TRANSACTION,
      );
    }
  }

  private async getTransactionId(
    queryRunner: WorkspaceQueryRunner,
  ): Promise<string> {
    const rows = (await queryRunner.query(
      'SELECT txid_current()::text AS "transactionId"',
    )) as TransactionIdRow[];
    const transactionId = rows[0]?.transactionId;

    if (typeof transactionId !== 'string') {
      return throwAuthorityException(
        'Messaging auto-create transaction identity is unavailable',
        InconnectMessagingAutoCreateAuthorityExceptionCode.INVALID_TRANSACTION,
      );
    }

    return transactionId;
  }
}
