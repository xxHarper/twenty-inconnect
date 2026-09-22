import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { DataSource, In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import {
  type InconnectMessagingConversationContextDTO,
  type InconnectMessagingContextFieldDTO,
  InconnectMessagingContextState,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { InconnectMessagingContextFieldEntity } from 'src/modules/inconnect-messaging/entities/context-field.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  getInconnectMessagingContextFieldColumnNames,
  getInconnectMessagingContextValueKind,
  normalizeInconnectMessagingContextDisplayValue,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-context-field.util';

type FieldSelection = {
  field: FieldMetadataEntity;
  aliases: string[];
};

@Injectable()
export class InconnectMessagingContextService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async getConversationContext({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingConversationContextDTO | null> {
    const conversation =
      await this.authorizationService.findAuthorizedConversation({
        authContext,
        conversationId,
      });

    if (conversation === null) {
      return null;
    }

    if (
      conversation.linkedRecordObjectMetadataId === null &&
      conversation.linkedRecordId === null
    ) {
      return {
        state: InconnectMessagingContextState.UNASSIGNED,
        object: null,
        record: null,
        fields: [],
      };
    }

    if (
      conversation.linkedRecordObjectMetadataId === null ||
      conversation.linkedRecordId === null ||
      !isNonEmptyString(authContext.workspace.databaseSchema)
    ) {
      return null;
    }

    const workspaceId = authContext.workspace.id;
    const manager = this.dataSource.manager;
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (
      configuration === null ||
      configuration.anchorObjectMetadataId !==
        conversation.linkedRecordObjectMetadataId
    ) {
      return null;
    }

    const [objectMetadata, contextFields] = await Promise.all([
      manager.getRepository(ObjectMetadataEntity).findOne({
        where: {
          id: configuration.anchorObjectMetadataId,
          workspaceId,
        },
      }),
      manager.getRepository(InconnectMessagingContextFieldEntity).find({
        where: { workspaceId },
        order: { ordinal: 'ASC' },
      }),
    ]);

    if (objectMetadata === null) {
      return null;
    }

    if (contextFields.length > INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS) {
      return null;
    }

    const requestedFieldIds = [
      ...contextFields.map((field) => field.fieldMetadataId),
      ...(objectMetadata.labelIdentifierFieldMetadataId === null
        ? []
        : [objectMetadata.labelIdentifierFieldMetadataId]),
    ];
    const fieldMetadata =
      requestedFieldIds.length === 0
        ? []
        : await manager.getRepository(FieldMetadataEntity).find({
            where: {
              id: In(requestedFieldIds),
              workspaceId,
              objectMetadataId: objectMetadata.id,
              isActive: true,
            },
          });
    const readableFieldIds =
      await this.authorizationService.filterReadableFieldMetadataIds({
        authContext,
        objectMetadataId: objectMetadata.id,
        fieldMetadataIds: fieldMetadata.map((field) => field.id),
      });

    if (readableFieldIds === null) {
      return null;
    }

    const fieldsById = new Map(fieldMetadata.map((field) => [field.id, field]));
    const configuredReadableFields = contextFields.flatMap((contextField) => {
      const field = fieldsById.get(contextField.fieldMetadataId);

      return field !== undefined &&
        readableFieldIds.has(field.id) &&
        getInconnectMessagingContextValueKind(field.type) !== null
        ? [{ contextField, field }]
        : [];
    });
    const labelField =
      objectMetadata.labelIdentifierFieldMetadataId === null
        ? null
        : (fieldsById.get(objectMetadata.labelIdentifierFieldMetadataId) ??
          null);
    const readableLabelField =
      labelField !== null &&
      readableFieldIds.has(labelField.id) &&
      getInconnectMessagingContextValueKind(labelField.type) !== null
        ? labelField
        : null;
    const uniqueFields = new Map<string, FieldMetadataEntity>();

    for (const { field } of configuredReadableFields) {
      uniqueFields.set(field.id, field);
    }
    if (readableLabelField !== null) {
      uniqueFields.set(readableLabelField.id, readableLabelField);
    }

    const { flatObjectMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
      ]);
    const objectUniversalIdentifier =
      flatObjectMetadataMaps.universalIdentifierById[objectMetadata.id];
    const flatObjectMetadata = objectUniversalIdentifier
      ? flatObjectMetadataMaps.byUniversalIdentifier[objectUniversalIdentifier]
      : undefined;

    if (
      flatObjectMetadata === undefined ||
      flatObjectMetadata.id !== objectMetadata.id ||
      flatObjectMetadata.workspaceId !== workspaceId
    ) {
      return null;
    }

    const recordAlias = 'inconnect_messaging_context_record';
    const qualifiedTableName = `${authContext.workspace.databaseSchema}.${computeObjectTargetTable(
      flatObjectMetadata,
    )}`;
    const queryBuilder = this.dataSource
      .createQueryBuilder()
      .select(`${escapeIdentifier(recordAlias)}."id"`, 'recordId')
      .from(qualifiedTableName, recordAlias)
      .where(`${escapeIdentifier(recordAlias)}."id" = :recordId`, {
        recordId: conversation.linkedRecordId,
      })
      .andWhere(`${escapeIdentifier(recordAlias)}."deletedAt" IS NULL`);
    const selectionsByFieldId = new Map<string, FieldSelection>();

    [...uniqueFields.values()].forEach((field, fieldIndex) => {
      const aliases = getInconnectMessagingContextFieldColumnNames(field).map(
        (columnName, columnIndex) => {
          const alias = `contextField${fieldIndex}Value${columnIndex}`;

          queryBuilder.addSelect(
            `${escapeIdentifier(recordAlias)}.${escapeIdentifier(columnName)}`,
            alias,
          );

          return alias;
        },
      );

      selectionsByFieldId.set(field.id, { field, aliases });
    });

    const recordAccessScope =
      await this.recordAccessAuthorizationService.applyReadScopeToQueryBuilder({
        queryBuilder,
        tableAlias: recordAlias,
        workspaceId,
        objectMetadataId: objectMetadata.id,
        authContext,
      });

    if (recordAccessScope.kind === 'denied') {
      return null;
    }

    const record = (await queryBuilder.getRawOne()) as
      | Record<string, unknown>
      | null
      | undefined;

    if (record === undefined || record === null) {
      return null;
    }

    const normalizeSelection = (selection: FieldSelection): string | null =>
      normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: selection.field,
        values: selection.aliases.map((alias) => record[alias]),
      });
    const fields: InconnectMessagingContextFieldDTO[] =
      configuredReadableFields.map(({ contextField, field }) => ({
        fieldMetadataId: field.id,
        label: field.label,
        valueKind: getInconnectMessagingContextValueKind(field.type)!,
        displayValue: normalizeSelection(selectionsByFieldId.get(field.id)!),
        ordinal: contextField.ordinal,
      }));
    const labelSelection =
      readableLabelField === null
        ? undefined
        : selectionsByFieldId.get(readableLabelField.id);

    return {
      state: InconnectMessagingContextState.LINKED,
      object: {
        objectMetadataId: objectMetadata.id,
        label: objectMetadata.labelSingular,
      },
      record: {
        recordId: conversation.linkedRecordId,
        recordLabel:
          labelSelection === undefined
            ? null
            : normalizeSelection(labelSelection),
      },
      fields,
    };
  }
}
