import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { DataSource, type EntityManager, In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ForbiddenError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import {
  type InconnectMessagingContextCandidateFieldDTO,
  type InconnectMessagingContextConfigurationDTO,
  type InconnectMessagingContextConfiguredFieldDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingContextFieldEntity } from 'src/modules/inconnect-messaging/entities/context-field.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { getInconnectMessagingContextValueKind } from 'src/modules/inconnect-messaging/utils/inconnect-messaging-context-field.util';

@Injectable()
export class InconnectMessagingContextConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  async getConfiguration({
    authContext,
  }: {
    authContext: WorkspaceAuthContext;
  }): Promise<InconnectMessagingContextConfigurationDTO> {
    await this.assertCanManage(authContext);

    return this.loadConfiguration({
      manager: this.dataSource.manager,
      workspaceId: authContext.workspace.id,
    });
  }

  async replaceConfiguration({
    authContext,
    fieldMetadataIds,
  }: {
    authContext: WorkspaceAuthContext;
    fieldMetadataIds: string[];
  }): Promise<InconnectMessagingContextConfigurationDTO> {
    await this.assertCanManage(authContext);
    this.validateInputShape(fieldMetadataIds);

    await this.dataSource.transaction(async (manager) => {
      const configuration = await manager
        .getRepository(InconnectMessagingConfigurationEntity)
        .findOne({
          where: { workspaceId: authContext.workspace.id },
          lock: { mode: 'pessimistic_write' },
        });

      if (configuration === null) {
        throw new NotFoundError('Messaging configuration not found');
      }

      const fields = await this.loadFieldsByIds({
        manager,
        fieldMetadataIds,
      });

      if (fields.length !== fieldMetadataIds.length) {
        throw new UserInputError('One or more context fields are invalid');
      }

      const fieldsById = new Map(fields.map((field) => [field.id, field]));

      for (const fieldMetadataId of fieldMetadataIds) {
        const field = fieldsById.get(fieldMetadataId);

        if (
          field === undefined ||
          field.workspaceId !== authContext.workspace.id ||
          field.objectMetadataId !== configuration.anchorObjectMetadataId ||
          field.isActive !== true ||
          getInconnectMessagingContextValueKind(field.type) === null
        ) {
          throw new UserInputError(
            'Context fields must be active supported fields of the configured anchor',
          );
        }
      }

      const contextFieldRepository = manager.getRepository(
        InconnectMessagingContextFieldEntity,
      );

      await contextFieldRepository.delete({
        workspaceId: configuration.workspaceId,
      });

      if (fieldMetadataIds.length > 0) {
        await contextFieldRepository.insert(
          fieldMetadataIds.map((fieldMetadataId, ordinal) => ({
            id: randomUUID(),
            workspaceId: configuration.workspaceId,
            objectMetadataId: configuration.anchorObjectMetadataId,
            fieldMetadataId,
            ordinal,
          })),
        );
      }
    });

    return this.loadConfiguration({
      manager: this.dataSource.manager,
      workspaceId: authContext.workspace.id,
    });
  }

  private async assertCanManage(
    authContext: WorkspaceAuthContext,
  ): Promise<void> {
    if (!(await this.authorizationService.canManageMessaging(authContext))) {
      throw new ForbiddenError('Messaging management permission is required');
    }
  }

  private validateInputShape(fieldMetadataIds: string[]): void {
    if (fieldMetadataIds.length > INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS) {
      throw new UserInputError(
        `At most ${INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS} context fields may be configured`,
      );
    }

    if (new Set(fieldMetadataIds).size !== fieldMetadataIds.length) {
      throw new UserInputError('Context fields must be unique');
    }
  }

  private async loadFieldsByIds({
    manager,
    fieldMetadataIds,
  }: {
    manager: EntityManager;
    fieldMetadataIds: string[];
  }): Promise<FieldMetadataEntity[]> {
    if (fieldMetadataIds.length === 0) {
      return [];
    }

    return manager.getRepository(FieldMetadataEntity).find({
      where: { id: In(fieldMetadataIds) },
    });
  }

  private async loadConfiguration({
    manager,
    workspaceId,
  }: {
    manager: EntityManager;
    workspaceId: string;
  }): Promise<InconnectMessagingContextConfigurationDTO> {
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (configuration === null) {
      throw new NotFoundError('Messaging configuration not found');
    }

    const [anchorObject, contextFields, candidateFields] = await Promise.all([
      manager.getRepository(ObjectMetadataEntity).findOne({
        where: {
          id: configuration.anchorObjectMetadataId,
          workspaceId,
        },
      }),
      manager.getRepository(InconnectMessagingContextFieldEntity).find({
        where: {
          workspaceId,
        },
        order: { ordinal: 'ASC' },
      }),
      manager.getRepository(FieldMetadataEntity).find({
        where: {
          workspaceId,
          objectMetadataId: configuration.anchorObjectMetadataId,
          isActive: true,
        },
      }),
    ]);

    if (anchorObject === null) {
      throw new NotFoundError('Messaging anchor metadata not found');
    }

    const candidateDTOs = candidateFields
      .flatMap((field): InconnectMessagingContextCandidateFieldDTO[] => {
        const valueKind = getInconnectMessagingContextValueKind(field.type);

        return valueKind === null
          ? []
          : [
              {
                fieldMetadataId: field.id,
                label: field.label,
                valueKind,
                isLabelIdentifier:
                  anchorObject.labelIdentifierFieldMetadataId === field.id,
              },
            ];
      })
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.fieldMetadataId.localeCompare(right.fieldMetadataId),
      );
    const candidatesById = new Map(
      candidateDTOs.map((candidate) => [candidate.fieldMetadataId, candidate]),
    );
    const configuredFields = contextFields.flatMap(
      (contextField): InconnectMessagingContextConfiguredFieldDTO[] => {
        const candidate = candidatesById.get(contextField.fieldMetadataId);

        return candidate === undefined
          ? []
          : [{ ...candidate, ordinal: contextField.ordinal }];
      },
    );

    return {
      anchorObject: {
        objectMetadataId: anchorObject.id,
        label: anchorObject.labelSingular,
      },
      fields: configuredFields,
      availableFields: candidateDTOs,
      maximumFieldCount: INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS,
    };
  }
}
