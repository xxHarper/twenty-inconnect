import { Injectable } from '@nestjs/common';

import { FieldMetadataType } from 'twenty-shared/types';
import { type EntityManager } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import {
  type InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO,
  InconnectMessagingAutoCreatePrimaryStatusDTO,
  InconnectMessagingAutoCreateValidationIssueDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';

export type PrimaryPhoneIdentityEvaluation = {
  summary: InconnectMessagingAutoCreatePrimaryPhoneIdentityDTO;
  issue: InconnectMessagingAutoCreateValidationIssueDTO | null;
};

@Injectable()
export class InconnectMessagingAutoCreatePrimaryValidatorService {
  async evaluate({
    manager,
    queryRunner,
    coreQueryBuilderService,
    configuration,
  }: {
    manager?: EntityManager;
    queryRunner?: WorkspaceQueryRunner;
    coreQueryBuilderService?: WorkspaceQueryRunnerCoreQueryBuilderService;
    configuration: InconnectMessagingConfigurationEntity;
  }): Promise<PrimaryPhoneIdentityEvaluation> {
    const primaryRows =
      manager !== undefined
        ? await manager
            .getRepository(InconnectMessagingPhoneIdentityFieldEntity)
            .find({
              where: {
                workspaceId: configuration.workspaceId,
                role: 'PRIMARY',
              },
              order: { ordinal: 'ASC', id: 'ASC' },
            })
        : await (() => {
            if (
              queryRunner === undefined ||
              coreQueryBuilderService === undefined
            ) {
              throw new Error('Core query context is required');
            }

            return coreQueryBuilderService
              .createCoreQueryBuilder({
                queryRunner,
                target: InconnectMessagingPhoneIdentityFieldEntity,
                alias: 'phoneIdentityField',
              })
              .where('phoneIdentityField.workspaceId = :workspaceId', {
                workspaceId: configuration.workspaceId,
              })
              .andWhere('phoneIdentityField.role = :role', { role: 'PRIMARY' })
              .orderBy('phoneIdentityField.ordinal', 'ASC')
              .addOrderBy('phoneIdentityField.id', 'ASC')
              .getMany();
          })();

    if (primaryRows.length === 0) {
      return this.emptyEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.MISSING,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_MISSING,
      );
    }

    if (primaryRows.length !== 1) {
      return this.emptyEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.MULTIPLE,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_MULTIPLE,
      );
    }

    const primaryRow = primaryRows[0];
    const fieldMetadata =
      manager !== undefined
        ? await manager
            .getRepository(FieldMetadataEntity)
            .findOne({ where: { id: primaryRow.fieldMetadataId } })
        : await (() => {
            if (
              queryRunner === undefined ||
              coreQueryBuilderService === undefined
            ) {
              throw new Error('Core query context is required');
            }

            return coreQueryBuilderService
              .createCoreQueryBuilder({
                queryRunner,
                target: FieldMetadataEntity,
                alias: 'fieldMetadata',
              })
              .where('fieldMetadata.id = :fieldMetadataId', {
                fieldMetadataId: primaryRow.fieldMetadataId,
              })
              .getOne();
          })();

    if (fieldMetadata === null) {
      return this.emptyEvaluation(
        InconnectMessagingAutoCreatePrimaryStatusDTO.METADATA_MISSING,
        InconnectMessagingAutoCreateValidationIssueDTO.PRIMARY_METADATA_MISSING,
      );
    }

    const belongsToWorkspace =
      fieldMetadata.workspaceId === configuration.workspaceId;
    const safeSummary = {
      fieldMetadataId: belongsToWorkspace ? fieldMetadata.id : null,
      label: belongsToWorkspace ? fieldMetadata.label : null,
      type: belongsToWorkspace ? fieldMetadata.type : null,
      isActive: belongsToWorkspace ? fieldMetadata.isActive : null,
    };

    if (
      primaryRow.workspaceId !== configuration.workspaceId ||
      !belongsToWorkspace
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

  private emptyEvaluation(
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
}
