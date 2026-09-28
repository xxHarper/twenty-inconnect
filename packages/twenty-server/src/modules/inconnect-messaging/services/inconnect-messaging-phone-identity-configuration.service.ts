import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, type EntityManager, In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  ForbiddenError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import {
  type InconnectMessagingPhoneIdentityCandidateFieldDTO,
  type InconnectMessagingPhoneIdentityConfigurationDTO,
  type InconnectMessagingPhoneIdentityConfiguredFieldDTO,
  type InconnectMessagingPhoneIdentityFieldInput,
  InconnectMessagingPhoneIdentityFieldRoleDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-phone-identity.dto';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingPhoneIdentityFieldEntity } from 'src/modules/inconnect-messaging/entities/phone-identity-field.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';

@Injectable()
export class InconnectMessagingPhoneIdentityConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
  ) {}

  async getConfiguration({
    authContext,
  }: {
    authContext: WorkspaceAuthContext;
  }): Promise<InconnectMessagingPhoneIdentityConfigurationDTO> {
    await this.assertCanManage(authContext);

    return this.loadConfiguration({
      manager: this.dataSource.manager,
      workspaceId: authContext.workspace.id,
    });
  }

  async replaceConfiguration({
    authContext,
    fields,
  }: {
    authContext: WorkspaceAuthContext;
    fields: InconnectMessagingPhoneIdentityFieldInput[];
  }): Promise<InconnectMessagingPhoneIdentityConfigurationDTO> {
    await this.assertCanManage(authContext);
    this.validateInputShape(fields);

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

      const fieldMetadataIds = fields.map(
        ({ fieldMetadataId }) => fieldMetadataId,
      );
      const fieldMetadata = await this.loadFieldsByIds({
        manager,
        fieldMetadataIds,
      });

      if (fieldMetadata.length !== fieldMetadataIds.length) {
        throw new UserInputError(
          'One or more phone identity fields are invalid',
        );
      }

      const fieldMetadataById = new Map(
        fieldMetadata.map((field) => [field.id, field]),
      );

      for (const { fieldMetadataId } of fields) {
        const field = fieldMetadataById.get(fieldMetadataId);

        if (
          field === undefined ||
          field.workspaceId !== authContext.workspace.id ||
          field.objectMetadataId !== configuration.anchorObjectMetadataId ||
          field.isActive !== true ||
          field.type !== FieldMetadataType.PHONES
        ) {
          throw new UserInputError(
            'Phone identity fields must be active PHONES fields of the configured anchor',
          );
        }
      }

      const repository = manager.getRepository(
        InconnectMessagingPhoneIdentityFieldEntity,
      );

      await repository.delete({ workspaceId: configuration.workspaceId });

      if (fields.length > 0) {
        await repository.insert(
          fields.map(({ fieldMetadataId, role }, ordinal) => ({
            id: randomUUID(),
            workspaceId: configuration.workspaceId,
            objectMetadataId: configuration.anchorObjectMetadataId,
            fieldMetadataId,
            role,
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

  private validateInputShape(
    fields: InconnectMessagingPhoneIdentityFieldInput[],
  ): void {
    if (fields.length > INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS) {
      throw new UserInputError(
        `At most ${INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS} phone identity fields may be configured`,
      );
    }

    const fieldMetadataIds = fields.map(
      ({ fieldMetadataId }) => fieldMetadataId,
    );

    if (new Set(fieldMetadataIds).size !== fieldMetadataIds.length) {
      throw new UserInputError('Phone identity fields must be unique');
    }

    const primaryCount = fields.filter(
      ({ role }) =>
        role === InconnectMessagingPhoneIdentityFieldRoleDTO.PRIMARY,
    ).length;

    if (fields.length > 0 && primaryCount !== 1) {
      throw new UserInputError(
        'A non-empty phone identity configuration requires exactly one PRIMARY field',
      );
    }

    if (
      fields.some(
        ({ role }) =>
          role !== InconnectMessagingPhoneIdentityFieldRoleDTO.PRIMARY &&
          role !== InconnectMessagingPhoneIdentityFieldRoleDTO.MATCH_ONLY,
      )
    ) {
      throw new UserInputError('Phone identity field role is invalid');
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
  }): Promise<InconnectMessagingPhoneIdentityConfigurationDTO> {
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (configuration === null) {
      throw new NotFoundError('Messaging configuration not found');
    }

    const [anchorObject, configuredRows, candidateFields] = await Promise.all([
      manager.getRepository(ObjectMetadataEntity).findOne({
        where: {
          id: configuration.anchorObjectMetadataId,
          workspaceId,
        },
      }),
      manager.getRepository(InconnectMessagingPhoneIdentityFieldEntity).find({
        where: { workspaceId },
        order: { ordinal: 'ASC' },
      }),
      manager.getRepository(FieldMetadataEntity).find({
        where: {
          workspaceId,
          objectMetadataId: configuration.anchorObjectMetadataId,
          isActive: true,
          type: FieldMetadataType.PHONES,
        },
      }),
    ]);

    if (anchorObject === null) {
      throw new NotFoundError('Messaging anchor metadata not found');
    }

    const availableFields = candidateFields
      .map(
        (field): InconnectMessagingPhoneIdentityCandidateFieldDTO => ({
          fieldMetadataId: field.id,
          label: field.label,
          type: field.type,
          isActive: field.isActive,
          eligibleRoles: [
            InconnectMessagingPhoneIdentityFieldRoleDTO.PRIMARY,
            InconnectMessagingPhoneIdentityFieldRoleDTO.MATCH_ONLY,
          ],
        }),
      )
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.fieldMetadataId.localeCompare(right.fieldMetadataId),
      );
    const candidateById = new Map(
      availableFields.map((field) => [field.fieldMetadataId, field]),
    );
    const fields = configuredRows.flatMap(
      (row): InconnectMessagingPhoneIdentityConfiguredFieldDTO[] => {
        const field = candidateById.get(row.fieldMetadataId);

        return field === undefined
          ? []
          : [
              {
                fieldMetadataId: field.fieldMetadataId,
                label: field.label,
                type: field.type,
                isActive: field.isActive,
                role: row.role as InconnectMessagingPhoneIdentityFieldRoleDTO,
                ordinal: row.ordinal,
              },
            ];
      },
    );

    return {
      anchorObject: {
        objectMetadataId: anchorObject.id,
        label: anchorObject.labelSingular,
      },
      fields,
      availableFields,
      maximumFieldCount: INCONNECT_MESSAGING_MAX_PHONE_IDENTITY_FIELDS,
    };
  }
}
