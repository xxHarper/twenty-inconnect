import { Injectable } from '@nestjs/common';

import { DataSource, type EntityManager } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ForbiddenError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  type InconnectMessagingAutoCreateConfigurationDTO,
  type InconnectMessagingAutoCreateConfigurationInput,
  InconnectMessagingAutoCreateLabelPolicyDTO,
  InconnectMessagingAutoCreateOwnerStrategyDTO,
  InconnectMessagingAutoCreatePrimaryStatusDTO,
  InconnectMessagingAutoCreateReadinessDTO,
  InconnectMessagingAutoCreateValidationIssueDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON,
  type InconnectMessagingAutoCreateEligibilityReason,
  InconnectMessagingAutoCreateEligibilityService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-eligibility.service';
import { InconnectMessagingAutoCreatePrimaryValidatorService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-primary-validator.service';

@Injectable()
export class InconnectMessagingAutoCreateConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly eligibilityService: InconnectMessagingAutoCreateEligibilityService,
    private readonly primaryValidatorService: InconnectMessagingAutoCreatePrimaryValidatorService,
  ) {}

  async getConfiguration({
    authContext,
  }: {
    authContext: WorkspaceAuthContext;
  }): Promise<InconnectMessagingAutoCreateConfigurationDTO> {
    await this.assertCanManage(authContext);

    return this.loadConfiguration({
      manager: this.dataSource.manager,
      workspaceId: authContext.workspace.id,
    });
  }

  async replaceConfiguration({
    authContext,
    input,
  }: {
    authContext: WorkspaceAuthContext;
    input: InconnectMessagingAutoCreateConfigurationInput;
  }): Promise<InconnectMessagingAutoCreateConfigurationDTO> {
    await this.assertCanManage(authContext);
    this.validateLogicalInput(input);

    return this.dataSource.transaction(async (manager) => {
      const configurationRepository = manager.getRepository(
        InconnectMessagingConfigurationEntity,
      );
      const configuration = await configurationRepository.findOne({
        where: { workspaceId: authContext.workspace.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (configuration === null) {
        throw new NotFoundError('Messaging configuration not found');
      }

      const anchorObject = await manager
        .getRepository(ObjectMetadataEntity)
        .findOne({
          where: {
            id: configuration.anchorObjectMetadataId,
            workspaceId: configuration.workspaceId,
          },
        });

      if (anchorObject === null || anchorObject.isActive !== true) {
        throw new UserInputError('The current Messaging anchor is invalid');
      }

      const ownerRole = await manager.getRepository(RoleEntity).findOne({
        where: { id: input.ownerRoleId },
      });

      if (ownerRole === null) {
        throw new UserInputError('The configured owner Role does not exist');
      }

      if (
        ownerRole.workspaceId !== configuration.workspaceId ||
        ownerRole.canBeAssignedToUsers !== true
      ) {
        throw new UserInputError(
          'The configured owner Role must be assignable to users in the current workspace',
        );
      }

      if (input.enabled) {
        const primaryPhoneIdentity =
          await this.primaryValidatorService.evaluate({
            manager,
            configuration,
          });

        if (
          primaryPhoneIdentity.summary.status !==
          InconnectMessagingAutoCreatePrimaryStatusDTO.VALID
        ) {
          throw new UserInputError(
            'Auto-create requires exactly one active PRIMARY PHONES field on the current Messaging anchor',
          );
        }
      }

      const updateResult = await configurationRepository.update(
        { workspaceId: configuration.workspaceId },
        {
          autoCreateEnabled: input.enabled,
          autoCreateAnchorObjectMetadataId:
            configuration.anchorObjectMetadataId,
          autoCreateOwnerStrategy: input.ownerStrategy,
          autoCreateOwnerRoleId: input.ownerRoleId,
          autoCreateLabelPolicy: input.labelPolicy,
        },
      );

      if (updateResult.affected !== 1) {
        throw new NotFoundError('Messaging configuration not found');
      }

      return this.loadConfiguration({
        manager,
        workspaceId: configuration.workspaceId,
      });
    });
  }

  private async assertCanManage(
    authContext: WorkspaceAuthContext,
  ): Promise<void> {
    if (!(await this.authorizationService.canManageMessaging(authContext))) {
      throw new ForbiddenError('Messaging management permission is required');
    }
  }

  private validateLogicalInput(
    input: InconnectMessagingAutoCreateConfigurationInput,
  ): void {
    if (
      input.ownerStrategy !==
      InconnectMessagingAutoCreateOwnerStrategyDTO.UNIQUE_ACTIVE_MEMBER_OF_ROLE
    ) {
      throw new UserInputError('Auto-create owner strategy is invalid');
    }

    if (input.labelPolicy !== InconnectMessagingAutoCreateLabelPolicyDTO.OMIT) {
      throw new UserInputError('Auto-create label policy is invalid');
    }
  }

  private async loadConfiguration({
    manager,
    workspaceId,
  }: {
    manager: EntityManager;
    workspaceId: string;
  }): Promise<InconnectMessagingAutoCreateConfigurationDTO> {
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (configuration === null) {
      throw new NotFoundError('Messaging configuration not found');
    }

    const [anchorObject, eligibleOwnerRoles, primaryPhoneIdentity] =
      await Promise.all([
        manager.getRepository(ObjectMetadataEntity).findOne({
          where: {
            id: configuration.anchorObjectMetadataId,
            workspaceId,
          },
        }),
        manager.getRepository(RoleEntity).find({
          where: { workspaceId },
          order: { label: 'ASC', id: 'ASC' },
        }),
        this.primaryValidatorService.evaluate({
          manager,
          configuration,
        }),
      ]);

    const storedOwnerStrategy = configuration.autoCreateOwnerStrategy as
      | string
      | null;
    const storedLabelPolicy = configuration.autoCreateLabelPolicy as
      | string
      | null;
    const hasNoStoredConfiguration =
      configuration.autoCreateEnabled === false &&
      configuration.autoCreateAnchorObjectMetadataId === null &&
      storedOwnerStrategy === null &&
      configuration.autoCreateOwnerRoleId === null &&
      storedLabelPolicy === null;
    const hasCompleteStoredConfiguration =
      configuration.autoCreateAnchorObjectMetadataId !== null &&
      storedOwnerStrategy !== null &&
      configuration.autoCreateOwnerRoleId !== null &&
      storedLabelPolicy !== null;
    const validationIssues: InconnectMessagingAutoCreateValidationIssueDTO[] =
      [];

    if (anchorObject === null || anchorObject.isActive !== true) {
      validationIssues.push(
        InconnectMessagingAutoCreateValidationIssueDTO.CURRENT_ANCHOR_INVALID,
      );
    }

    if (!hasNoStoredConfiguration && !hasCompleteStoredConfiguration) {
      validationIssues.push(
        InconnectMessagingAutoCreateValidationIssueDTO.CONFIGURATION_INCOMPLETE,
      );
    }

    if (hasCompleteStoredConfiguration) {
      if (
        configuration.autoCreateAnchorObjectMetadataId !==
        configuration.anchorObjectMetadataId
      ) {
        validationIssues.push(
          InconnectMessagingAutoCreateValidationIssueDTO.CONFIGURED_ANCHOR_MISMATCH,
        );
      }

      if (!this.isSupportedOwnerStrategy(storedOwnerStrategy)) {
        validationIssues.push(
          InconnectMessagingAutoCreateValidationIssueDTO.OWNER_STRATEGY_INVALID,
        );
      }

      if (
        !eligibleOwnerRoles.some(
          ({ id, canBeAssignedToUsers }) =>
            id === configuration.autoCreateOwnerRoleId &&
            canBeAssignedToUsers === true,
        )
      ) {
        validationIssues.push(
          InconnectMessagingAutoCreateValidationIssueDTO.OWNER_ROLE_INVALID,
        );
      }

      if (!this.isSupportedLabelPolicy(storedLabelPolicy)) {
        validationIssues.push(
          InconnectMessagingAutoCreateValidationIssueDTO.LABEL_POLICY_INVALID,
        );
      }
    }

    if (
      configuration.autoCreateEnabled &&
      primaryPhoneIdentity.issue !== null
    ) {
      validationIssues.push(primaryPhoneIdentity.issue);
    }

    let readiness = InconnectMessagingAutoCreateReadinessDTO.DISABLED;

    if (!configuration.autoCreateEnabled) {
      readiness = InconnectMessagingAutoCreateReadinessDTO.DISABLED;
    } else if (validationIssues.length > 0) {
      readiness = InconnectMessagingAutoCreateReadinessDTO.INVALID;
    } else {
      const ownerRoleIsValid = eligibleOwnerRoles.some(
        ({ id, canBeAssignedToUsers }) =>
          id === configuration.autoCreateOwnerRoleId &&
          canBeAssignedToUsers === true,
      );
      const eligibility = await this.eligibilityService.evaluate({
        manager,
        configuration,
        anchorObject,
        ownerRoleIsValid,
        primaryPhoneIdentity,
      });

      if (eligibility.status === 'ELIGIBLE') {
        readiness = InconnectMessagingAutoCreateReadinessDTO.READY_FOR_RUNTIME;
      } else {
        readiness = InconnectMessagingAutoCreateReadinessDTO.NOT_READY;
        validationIssues.push(
          this.mapEligibilityReasonToValidationIssue(eligibility.reason),
        );
      }

      validationIssues.push(
        InconnectMessagingAutoCreateValidationIssueDTO.RUNTIME_NOT_IMPLEMENTED,
      );
    }

    return {
      anchorObject:
        anchorObject === null
          ? null
          : {
              objectMetadataId: anchorObject.id,
              label: anchorObject.labelSingular,
            },
      primaryPhoneIdentity: primaryPhoneIdentity.summary,
      configuration: hasNoStoredConfiguration
        ? null
        : {
            enabled: configuration.autoCreateEnabled,
            configuredAnchorObjectMetadataId:
              configuration.autoCreateAnchorObjectMetadataId,
            ownerStrategy: this.isSupportedOwnerStrategy(storedOwnerStrategy)
              ? storedOwnerStrategy
              : null,
            ownerRoleId: configuration.autoCreateOwnerRoleId,
            labelPolicy: this.isSupportedLabelPolicy(storedLabelPolicy)
              ? storedLabelPolicy
              : null,
          },
      eligibleOwnerRoles: eligibleOwnerRoles
        .filter(({ canBeAssignedToUsers }) => canBeAssignedToUsers === true)
        .map((role) => ({
          roleId: role.id,
          label: role.label,
        })),
      readiness,
      validationIssues,
      effectiveEnabled: false,
    };
  }

  private mapEligibilityReasonToValidationIssue(
    reason: InconnectMessagingAutoCreateEligibilityReason,
  ): InconnectMessagingAutoCreateValidationIssueDTO {
    switch (reason) {
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.REQUIRED_FIELD_UNSATISFIED:
        return InconnectMessagingAutoCreateValidationIssueDTO.REQUIRED_FIELD_UNSATISFIED;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.OWNER_CONFIGURATION_INVALID:
        return InconnectMessagingAutoCreateValidationIssueDTO.OWNER_CONFIGURATION_INVALID;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PHONE_UNIQUENESS_NOT_GUARANTEED:
        return InconnectMessagingAutoCreateValidationIssueDTO.PHONE_UNIQUENESS_NOT_GUARANTEED;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_REQUIRED_FIELD:
        return InconnectMessagingAutoCreateValidationIssueDTO.UNSUPPORTED_REQUIRED_FIELD;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.UNSUPPORTED_ANCHOR:
        return InconnectMessagingAutoCreateValidationIssueDTO.UNSUPPORTED_ANCHOR;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PRIMARY_MISSING:
        return InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_MISSING;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.PRIMARY_INVALID:
        return InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_METADATA_MISSING;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.ANCHOR_MISMATCH:
        return InconnectMessagingAutoCreateValidationIssueDTO.CONFIGURED_ANCHOR_MISMATCH;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.CONFIGURATION_INVALID:
        return InconnectMessagingAutoCreateValidationIssueDTO.CONFIGURATION_INCOMPLETE;
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.CONFIGURATION_DISABLED:
      case INCONNECT_MESSAGING_AUTO_CREATE_ELIGIBILITY_REASON.METADATA_INVALID:
        return InconnectMessagingAutoCreateValidationIssueDTO.METADATA_INVALID;
    }
  }

  private isSupportedOwnerStrategy(
    value: string | null,
  ): value is InconnectMessagingAutoCreateOwnerStrategyDTO {
    return (
      value ===
      InconnectMessagingAutoCreateOwnerStrategyDTO.UNIQUE_ACTIVE_MEMBER_OF_ROLE
    );
  }

  private isSupportedLabelPolicy(
    value: string | null,
  ): value is InconnectMessagingAutoCreateLabelPolicyDTO {
    return value === InconnectMessagingAutoCreateLabelPolicyDTO.OMIT;
  }
}
