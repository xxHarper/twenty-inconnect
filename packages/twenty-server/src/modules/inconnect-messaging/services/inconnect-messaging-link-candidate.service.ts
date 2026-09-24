import { Injectable } from '@nestjs/common';

import { FieldMetadataType } from 'twenty-shared/types';
import { escapeForIlike, isDefined } from 'twenty-shared/utils';
import { Brackets, DataSource, In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  InternalServerError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-context.constant';
import { type InconnectMessagingContextFieldDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-context.dto';
import { type InconnectMessagingConversationLinkCandidateConnectionDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-link.dto';
import { InconnectMessagingContextFieldEntity } from 'src/modules/inconnect-messaging/entities/context-field.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import {
  getInconnectMessagingContextFieldColumnNames,
  getInconnectMessagingContextValueKind,
  normalizeInconnectMessagingContextDisplayValue,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-context-field.util';
import {
  decodeInconnectMessagingLinkCandidateCursor,
  encodeInconnectMessagingLinkCandidateCursor,
} from 'src/modules/inconnect-messaging/utils/inconnect-messaging-link-cursor.util';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type CandidateFieldSelection = {
  field: FieldMetadataEntity;
  aliases: string[];
};

@Injectable()
export class InconnectMessagingLinkCandidateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly recordAccessAuthorizationService: InconnectRecordAccessAuthorizationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async getCandidates({
    authContext,
    conversationId,
    search,
    first,
    after,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
    search: string;
    first?: number;
    after?: string;
  }): Promise<InconnectMessagingConversationLinkCandidateConnectionDTO> {
    const conversation =
      await this.authorizationService.findConversationAuthorizedForTriage({
        authContext,
        conversationId,
      });

    if (conversation === null) {
      throw new NotFoundError('Conversation not found');
    }

    const pageSize = this.resolvePageSize(first);
    const normalizedSearch = search.trim().replace(/\s+/g, ' ');
    const workspaceId = authContext.workspace.id;
    const manager = this.dataSource.manager;
    const configuration = await manager
      .getRepository(InconnectMessagingConfigurationEntity)
      .findOne({ where: { workspaceId } });

    if (configuration === null) {
      throw new NotFoundError('Conversation not found');
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

    if (
      objectMetadata === null ||
      contextFields.length > INCONNECT_MESSAGING_MAX_CONTEXT_FIELDS
    ) {
      throw new NotFoundError('Conversation not found');
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
      throw new NotFoundError('Conversation not found');
    }

    const fieldsById = new Map(fieldMetadata.map((field) => [field.id, field]));
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
    const searchableLabelField =
      readableLabelField?.type === FieldMetadataType.TEXT
        ? readableLabelField
        : null;

    if (normalizedSearch === '' || searchableLabelField === null) {
      if (isDefined(after)) {
        decodeInconnectMessagingLinkCandidateCursor(after);
      }

      return this.emptyConnection(isDefined(after));
    }

    const configuredReadableFields = contextFields.flatMap((contextField) => {
      const field = fieldsById.get(contextField.fieldMetadataId);

      return field !== undefined &&
        readableFieldIds.has(field.id) &&
        getInconnectMessagingContextValueKind(field.type) !== null
        ? [{ contextField, field }]
        : [];
    });
    const uniqueFields = new Map<string, FieldMetadataEntity>();

    for (const { field } of configuredReadableFields) {
      uniqueFields.set(field.id, field);
    }
    uniqueFields.set(searchableLabelField.id, searchableLabelField);

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
      throw new NotFoundError('Conversation not found');
    }

    const recordAlias = 'inconnect_messaging_link_candidate';
    const escapedRecordAlias = escapeIdentifier(recordAlias);
    const qualifiedTableName = `${authContext.workspace.databaseSchema}.${computeObjectTargetTable(
      flatObjectMetadata,
    )}`;
    const labelColumnExpression = `${escapedRecordAlias}.${escapeIdentifier(
      searchableLabelField.name,
    )}`;
    const queryBuilder = this.dataSource
      .createQueryBuilder()
      .select(`${escapedRecordAlias}."id"`, 'recordId')
      .addSelect(labelColumnExpression, 'recordLabel')
      .from(qualifiedTableName, recordAlias)
      .where(`${escapedRecordAlias}."deletedAt" IS NULL`)
      .andWhere(`${labelColumnExpression} ILIKE :candidateSearch ESCAPE '\\'`, {
        candidateSearch: `%${escapeForIlike(normalizedSearch)}%`,
      });
    const selectionsByFieldId = new Map<string, CandidateFieldSelection>();

    [...uniqueFields.values()].forEach((field, fieldIndex) => {
      const aliases = getInconnectMessagingContextFieldColumnNames(field).map(
        (columnName, columnIndex) => {
          const alias = `candidateField${fieldIndex}Value${columnIndex}`;

          queryBuilder.addSelect(
            `${escapedRecordAlias}.${escapeIdentifier(columnName)}`,
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
      return this.emptyConnection(isDefined(after));
    }

    const rawCount = await queryBuilder
      .clone()
      .select('COUNT(1)', 'count')
      .getRawOne<{ count: unknown }>();
    const totalCount = this.parseTotalCount(rawCount?.count);

    if (isDefined(after)) {
      const cursor = decodeInconnectMessagingLinkCandidateCursor(after);

      queryBuilder.andWhere(
        new Brackets((cursorQueryBuilder) => {
          cursorQueryBuilder
            .where(`${labelColumnExpression} > :candidateCursorLabel`, {
              candidateCursorLabel: cursor.label,
            })
            .orWhere(
              `${labelColumnExpression} = :candidateCursorLabel AND ${escapedRecordAlias}."id" > :candidateCursorId`,
              {
                candidateCursorLabel: cursor.label,
                candidateCursorId: cursor.id,
              },
            );
        }),
      );
    }

    const records = (await queryBuilder
      .orderBy(labelColumnExpression, 'ASC')
      .addOrderBy(`${escapedRecordAlias}."id"`, 'ASC')
      .take(pageSize + 1)
      .getRawMany()) as Array<Record<string, unknown>>;
    const hasNextPage = records.length > pageSize;
    const pageRecords = hasNextPage ? records.slice(0, pageSize) : records;
    const edges = pageRecords.map((record) => {
      const recordId = String(record.recordId);
      const labelSelection = selectionsByFieldId.get(searchableLabelField.id)!;
      const recordLabel = normalizeInconnectMessagingContextDisplayValue({
        fieldMetadata: labelSelection.field,
        values: labelSelection.aliases.map((alias) => record[alias]),
      });

      if (recordLabel === null) {
        throw new InternalServerError(
          'INCONNECT Messaging candidate label invariant failed',
        );
      }

      const fields: InconnectMessagingContextFieldDTO[] =
        configuredReadableFields.map(({ contextField, field }) => {
          const selection = selectionsByFieldId.get(field.id)!;

          return {
            fieldMetadataId: field.id,
            label: field.label,
            valueKind: getInconnectMessagingContextValueKind(field.type)!,
            displayValue: normalizeInconnectMessagingContextDisplayValue({
              fieldMetadata: selection.field,
              values: selection.aliases.map((alias) => record[alias]),
            }),
            ordinal: contextField.ordinal,
          };
        });

      return {
        cursor: encodeInconnectMessagingLinkCandidateCursor({
          id: recordId,
          label: recordLabel,
        }),
        node: { recordId, recordLabel, fields },
      };
    });

    return {
      edges,
      totalCount,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: isDefined(after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
    };
  }

  private resolvePageSize(first: number | undefined): number {
    const pageSize = first ?? DEFAULT_PAGE_SIZE;

    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new UserInputError(
        `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}`,
      );
    }

    return pageSize;
  }

  private parseTotalCount(value: unknown): number {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value))
    ) {
      throw new InternalServerError(
        'INCONNECT Messaging candidate count invariant failed',
      );
    }

    const totalCount = Number(value);

    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new InternalServerError(
        'INCONNECT Messaging candidate count invariant failed',
      );
    }

    return totalCount;
  }

  private emptyConnection(
    hasPreviousPage: boolean,
  ): InconnectMessagingConversationLinkCandidateConnectionDTO {
    return {
      edges: [],
      totalCount: 0,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage,
        startCursor: null,
        endCursor: null,
      },
    };
  }
}
