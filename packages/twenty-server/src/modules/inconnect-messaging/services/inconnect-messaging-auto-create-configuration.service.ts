import { Injectable } from '@nestjs/common';

import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, type EntityManager } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ForbiddenError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  type InconnectMessagingAutoCreateConfigurationDTO,
  type InconnectMessagingAutoCreateConfigurationInput,
  InconnectMessagingAutoCreateLabelPolicyDTO,
  InconnectMessagingAutoCreateOwnerStrategyDTO,
  InconnectMessagingAutoCreatePrimaryStatusDTO,
  type InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO,
  InconnectMessagingAutoCreateReadinessDTO,
  InconnectMessagingAutoCreateValidationIssueDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

type PrimaryPhoneIdentityEvaluation = {
  summary: InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO;
  issue: InconnectMessagingAutoCreateValidationIssueDTO | null;
};

@Injectable()
export class InconnectMessagingAutoCreateConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
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

      if (ownerRole.workspaceId !== configuration.workspaceId) {
        throw new UserInputError(
          'The configured owner Role must belong to the current workspace',
        );
      }

      if (input.enabled) {
        const primaryPhoneIdentity = await this.evaluatePrimaryPhoneIdentity({
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
        this.evaluatePrimaryPhoneIdentity({ manager, configuration }),
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
          ({ id }) => id === configuration.autoCreateOwnerRoleId,
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

    const hasStructuralIssue = validationIssues.length > 0;
    let readiness = InconnectMessagingAutoCreateReadinessDTO.DISABLED;

    if (hasStructuralIssue) {
      readiness = InconnectMessagingAutoCreateReadinessDTO.INVALID;
    } else if (configuration.autoCreateEnabled) {
      readiness = InconnectMessagingAutoCreateReadinessDTO.NOT_READY;
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
      eligibleOwnerRoles: eligibleOwnerRoles.map((role) => ({
        roleId: role.id,
        label: role.label,
      })),
      readiness,
      validationIssues,
      effectiveEnabled: false,
    };
  }

  private async evaluatePrimaryPhoneIdentity({
    manager,
    configuration,
  }: {
    manager: EntityManager;
    configuration: InconnectMessagingConfigurationEntity;
  }): Promise<PrimaryPhoneIdentityEvaluation> {
    const primaryRows = await manager
      .getRepository(InconnectMessagingPhoneIdentityFieldEntity)
      .find({
        where: { workspaceId: configuration.workspaceId, role: 'PRIMARY' },
        order: { ordinal: 'ASC', id: 'ASC' },
      });

    if (primaryRows.length === 0) {
      return this.primaryEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.MISSING,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_MISSING,
      );
    }

    if (primaryRows.length !== 1) {
      return this.primaryEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.MULTIPLE,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_MULTIPLE,
      );
    }

    const primaryRow = primaryRows[0];
    const fieldMetadata = await manager
      .getRepository(FieldMetadataEntity)
      .findOne({ where: { id: primaryRow.fieldMetadataId } });

    if (fieldMetadata === null) {
      return this.primaryEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.METADATA_MISSING,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_METADATA_MISSING,
      );
    }

    const safeSummary = {
      fieldMetadataId:
        fieldMetadata.workspaceId === configuration.workspaceId
          ? fieldMetadata.id
          : null,
      label:
        fieldMetadata.workspaceId === configuration.workspaceId
          ? fieldMetadata.label
          : null,
      type:
        fieldMetadata.workspaceId === configuration.workspaceId
          ? fieldMetadata.type
          : null,
      isActive:
        fieldMetadata.workspaceId === configuration.workspaceId
          ? fieldMetadata.isActive
          : null,
    };

    if (
      primaryRow.workspaceId !== configuration.workspaceId ||
      fieldMetadata.workspaceId !== configuration.workspaceId
    ) {
      return {
        summary: {
          status: InconnectMessagingAutoCreatePrimaryStatusDTO.WRONG_WORKSPACE,
          ...safeSummary,
        },
        issue:
          InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_WRONG_WORKSPACE,
      };
    }

    if (
      primaryRow.objectMetadataId !== configuration.anchorObjectMetadataId ||
      fieldMetadata.objectMetadataId !== configuration.anchorObjectMetadataId
    ) {
      return {
        summary: {
          status: InconnectMessagingAutoCreatePrimaryStatusDTO.WRONG_ANCHOR,
          ...safeSummary,
        },
        issue:
          InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_WRONG_ANCHOR,
      };
    }

    if (fieldMetadata.isActive !== true) {
      return {
        summary: {
          status: InconnectMessagingAutoCreatePrimaryStatusDTO.INACTIVE,
          ...safeSummary,
        },
        issue: InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_INACTIVE,
      };
    }

    if (fieldMetadata.type !== FieldMetadataType.PHONES) {
      return {
        summary: {
          status: InconnectMessagingAutoCreatePrimaryStatusDTO.WRONG_TYPE,
          ...safeSummary,
        },
        issue:
          InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_WRONG_TYPE,
      };
    }

    return {
      summary: {
        status: InconnectMessagingAutoCreatePrimaryStatusDTO.VALID,
        ...safeSummary,
      },
      issue: null,
    };
  }

  private primaryEvaluation(
    status: InconnectMessagingAutoCreatePrimaryStatusDTO,
    issue: InconnectMessagingAutoCreateValidationIssueDTO,
  ): PrimaryPhoneIdentityEvaluation {
    return {
      summary: {
        status,
        fieldMetadataId: null,
        label: null,
        type: null,
        isActive: null,
      },
      issue,
    };
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
