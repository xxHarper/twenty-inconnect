import { type ObjectsPermissions } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  type EntityTarget,
  InsertQueryBuilder,
  type InsertResult,
  type ObjectLiteral,
} from 'typeorm';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  InconnectRecordAccessException,
  InconnectRecordAccessExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.exception';
import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { assertInconnectRecordAccessOperationSupported } from 'src/engine/core-modules/inconnect-record-access/utils/assert-inconnect-record-access-operation-supported.util';
import {
  applyInconnectRecordAccessToCreateValues,
  doesInconnectCreateRequireDefaultOwnerResolution,
} from 'src/engine/core-modules/inconnect-record-access/utils/apply-inconnect-record-access-to-write-values.util';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
import { resolveInconnectSingleActiveMemberOfRole } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-single-active-member-of-role.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type QueryDeepPartialEntityWithNestedRelationFields } from 'src/engine/twenty-orm/entity-manager/types/query-deep-partial-entity-with-nested-relation-fields.type';
import { type RelationConnectQueryConfig } from 'src/engine/twenty-orm/entity-manager/types/relation-connect-query-config.type';
import { type RelationDisconnectQueryFieldsByEntityIndex } from 'src/engine/twenty-orm/entity-manager/types/relation-nested-query-fields-by-entity-index.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { computeTwentyORMException } from 'src/engine/twenty-orm/error-handling/compute-twenty-orm-exception';
import {
  TwentyORMException,
  TwentyORMExceptionCode,
} from 'src/engine/twenty-orm/exceptions/twenty-orm.exception';
import { FilesFieldSync } from 'src/engine/twenty-orm/field-operations/files-field-sync/files-field-sync';
import { RelationNestedQueries } from 'src/engine/twenty-orm/field-operations/relation-nested-queries/relation-nested-queries';
import { validateQueryIsPermittedOrThrow } from 'src/engine/twenty-orm/repository/permissions.utils';
import { type WorkspaceDeleteQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-delete-query-builder';
import { WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';
import { type WorkspaceSoftDeleteQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-soft-delete-query-builder';
import { type WorkspaceUpdateQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-update-query-builder';
import { formatData } from 'src/engine/twenty-orm/utils/format-data.util';
import { formatResult } from 'src/engine/twenty-orm/utils/format-result.util';
import { formatTwentyOrmEventToDatabaseBatchEvent } from 'src/engine/twenty-orm/utils/format-twenty-orm-event-to-database-batch-event.util';
import { getObjectMetadataFromEntityTarget } from 'src/engine/twenty-orm/utils/get-object-metadata-from-entity-target.util';
import { validateRLSPredicatesForRecords } from 'src/engine/twenty-orm/utils/validate-rls-predicates-for-records.util';

export class WorkspaceInsertQueryBuilder<
  T extends ObjectLiteral,
> extends InsertQueryBuilder<T> {
  private objectRecordsPermissions: ObjectsPermissions;
  private shouldBypassPermissionChecks: boolean;
  private internalContext: WorkspaceInternalContext;
  private authContext: WorkspaceAuthContext;
  private featureFlagMap: FeatureFlagMap;
  private relationNestedConfig:
    | [RelationConnectQueryConfig[], RelationDisconnectQueryFieldsByEntityIndex]
    | null;
  private internallyInjectedFieldNames: string[] = [];

  private _relationNestedQueries?: RelationNestedQueries;
  private _filesFieldSync?: FilesFieldSync;

  private get relationNestedQueries(): RelationNestedQueries {
    return (this._relationNestedQueries ??= new RelationNestedQueries(
      this.internalContext,
    ));
  }

  private get filesFieldSync(): FilesFieldSync {
    return (this._filesFieldSync ??= new FilesFieldSync(this.internalContext));
  }

  constructor(
    queryBuilder: InsertQueryBuilder<T>,
    objectRecordsPermissions: ObjectsPermissions,
    internalContext: WorkspaceInternalContext,
    shouldBypassPermissionChecks: boolean,
    authContext: WorkspaceAuthContext,
    featureFlagMap: FeatureFlagMap,
  ) {
    super(queryBuilder);
    this.objectRecordsPermissions = objectRecordsPermissions;
    this.internalContext = internalContext;
    this.shouldBypassPermissionChecks = shouldBypassPermissionChecks;
    this.authContext = authContext;
    this.featureFlagMap = featureFlagMap;
  }

  override clone(): this {
    const clonedQueryBuilder = super.clone();

    const workspaceInsertQueryBuilder = new WorkspaceInsertQueryBuilder(
      clonedQueryBuilder,
      this.objectRecordsPermissions,
      this.internalContext,
      this.shouldBypassPermissionChecks,
      this.authContext,
      this.featureFlagMap,
    ) as this;

    workspaceInsertQueryBuilder.internallyInjectedFieldNames = [
      ...this.internallyInjectedFieldNames,
    ];

    return workspaceInsertQueryBuilder;
  }

  override values(
    values:
      | QueryDeepPartialEntityWithNestedRelationFields<T>
      | QueryDeepPartialEntityWithNestedRelationFields<T>[],
  ): this {
    const mainAliasTarget = this.getMainAliasTarget();

    this.relationNestedConfig =
      this.relationNestedQueries.prepareNestedRelationQueries(
        values,
        mainAliasTarget,
      );

    const objectMetadata = getObjectMetadataFromEntityTarget(
      mainAliasTarget,
      this.internalContext,
    );

    const formattedValues = formatData(
      values,
      objectMetadata,
      this.internalContext.flatFieldMetadataMaps,
    );

    return super.values(formattedValues);
  }

  override async execute(): Promise<InsertResult> {
    try {
      validateQueryIsPermittedOrThrow({
        expressionMap: this.expressionMap,
        objectsPermissions: this.objectRecordsPermissions,
        flatObjectMetadataMaps: this.internalContext.flatObjectMetadataMaps,
        flatFieldMetadataMaps: this.internalContext.flatFieldMetadataMaps,
        objectIdByNameSingular: this.internalContext.objectIdByNameSingular,
        shouldBypassPermissionChecks: this.shouldBypassPermissionChecks,
        internallyInjectedFieldNames: this.internallyInjectedFieldNames,
      });

      // Fix overwrites for composite fields - valuesSet contains formatted/flattened column names
      // but overwrites was computed before formatData, missing composite field columns
      if (
        isDefined(this.expressionMap.onUpdate?.overwrite) &&
        isDefined(this.expressionMap.valuesSet)
      ) {
        const valuesArray = Array.isArray(this.expressionMap.valuesSet)
          ? this.expressionMap.valuesSet
          : [this.expressionMap.valuesSet];

        const allValueKeys = new Set(
          valuesArray.flatMap((value) => Object.keys(value)),
        );

        const mainAliasMetadata = this.expressionMap.mainAlias?.metadata;

        if (mainAliasMetadata) {
          const missingColumns = mainAliasMetadata.columns
            .filter(
              (col) =>
                allValueKeys.has(col.databaseName) &&
                !this.expressionMap.onUpdate.overwrite!.includes(
                  col.databaseName,
                ),
            )
            .map((col) => col.databaseName);

          this.expressionMap.onUpdate.overwrite = [
            ...this.expressionMap.onUpdate.overwrite,
            ...missingColumns,
          ];
        }
      }

      const mainAliasTarget = this.getMainAliasTarget();

      const objectMetadata = getObjectMetadataFromEntityTarget(
        mainAliasTarget,
        this.internalContext,
      );

      const inconnectDecision =
        this.resolveInconnectRecordAccessDecision(objectMetadata);

      if (isDefined(this.expressionMap.onUpdate)) {
        assertInconnectRecordAccessOperationSupported({
          decision: inconnectDecision,
          operation: 'upsert',
        });
      }

      let filesFieldFileIds = null;

      const entities = Array.isArray(this.expressionMap.valuesSet)
        ? this.expressionMap.valuesSet
        : [this.expressionMap.valuesSet];

      const filesFieldDiffByEntityIndex =
        this.filesFieldSync.computeFilesFieldDiffBeforeInsert(
          entities as QueryDeepPartialEntityWithNestedRelationFields<T>[],
          mainAliasTarget,
        );

      if (isDefined(filesFieldDiffByEntityIndex)) {
        const result = await this.filesFieldSync.enrichFilesFields({
          entities:
            entities as QueryDeepPartialEntityWithNestedRelationFields<T>[],
          filesFieldDiffByEntityIndex,
          workspaceId: this.internalContext.workspaceId,
          target: mainAliasTarget,
        });

        filesFieldFileIds = result.fileIds;

        this.expressionMap.valuesSet = Array.isArray(
          this.expressionMap.valuesSet,
        )
          ? result.entities
          : result.entities[0];
      }

      if (isDefined(this.relationNestedConfig)) {
        const nestedRelationQueryBuilder = new WorkspaceSelectQueryBuilder(
          this as unknown as WorkspaceSelectQueryBuilder<T>,
          this.objectRecordsPermissions,
          this.internalContext,
          this.shouldBypassPermissionChecks,
          this.authContext,
          this.featureFlagMap,
        );

        const updatedValues =
          await this.relationNestedQueries.processRelationNestedQueries({
            entities: this.expressionMap.valuesSet as
              | QueryDeepPartialEntityWithNestedRelationFields<T>
              | QueryDeepPartialEntityWithNestedRelationFields<T>[],
            relationNestedConfig: this.relationNestedConfig,
            queryBuilder: nestedRelationQueryBuilder,
          });

        this.expressionMap.valuesSet = updatedValues;
      }

      const result =
        await this.executeInsertWithInconnectOwnerIntegrity(inconnectDecision);

      if (isDefined(filesFieldFileIds)) {
        await this.filesFieldSync.updateFileEntityRecords(filesFieldFileIds);
      }
      const eventSelectQueryBuilder = (
        this.connection.manager as WorkspaceEntityManager
      ).createQueryBuilder(
        mainAliasTarget,
        this.expressionMap.mainAlias?.metadata.name ?? '',
        undefined,
        {
          shouldBypassPermissionChecks: true,
        },
      ) as WorkspaceSelectQueryBuilder<T>;

      eventSelectQueryBuilder.whereInIds(
        result.identifiers.map((identifier) => identifier.id),
      );

      const afterResult = await eventSelectQueryBuilder.getMany({
        noFormatting: true,
      });

      const formattedResultForEvent = formatResult<T[]>(
        afterResult,
        objectMetadata,
        this.internalContext.flatObjectMetadataMaps,
        this.internalContext.flatFieldMetadataMaps,
      );

      this.internalContext.eventEmitterService.emitDatabaseBatchEvent(
        formatTwentyOrmEventToDatabaseBatchEvent({
          action: DatabaseEventAction.CREATED,
          objectMetadataItem: objectMetadata,
          flatFieldMetadataMaps: this.internalContext.flatFieldMetadataMaps,
          workspaceId: this.internalContext.workspaceId,
          recordsAfter: formattedResultForEvent,
          authContext: this.authContext,
        }),
        this.queryRunner,
      );

      this.internalContext.eventEmitterService.emitDatabaseBatchEvent(
        formatTwentyOrmEventToDatabaseBatchEvent({
          action: DatabaseEventAction.UPSERTED,
          objectMetadataItem: objectMetadata,
          flatFieldMetadataMaps: this.internalContext.flatFieldMetadataMaps,
          workspaceId: this.internalContext.workspaceId,
          recordsAfter: formattedResultForEvent,
          authContext: this.authContext,
        }),
        this.queryRunner,
      );

      // TypeORM returns all entity columns for insertions
      const resultWithoutInsertionExtraColumns = !isDefined(result.raw)
        ? []
        : result.raw.map((rawResult: Record<string, string>) =>
            Object.keys(rawResult)
              .filter(
                (key) =>
                  this.expressionMap.returning.includes(key) ||
                  this.expressionMap.returning === '*',
              )
              .reduce((filtered: Record<string, string>, key) => {
                filtered[key] = rawResult[key];

                return filtered;
              }, {}),
          );

      const formattedResult = formatResult<T[]>(
        resultWithoutInsertionExtraColumns,
        objectMetadata,
        this.internalContext.flatObjectMetadataMaps,
        this.internalContext.flatFieldMetadataMaps,
      );

      return {
        raw: resultWithoutInsertionExtraColumns,
        generatedMaps: formattedResult,
        identifiers: result.identifiers,
      };
    } catch (error) {
      const objectMetadata = getObjectMetadataFromEntityTarget(
        this.getMainAliasTarget(),
        this.internalContext,
      );

      throw await computeTwentyORMException(
        error,
        objectMetadata,
        this.connection.manager as WorkspaceEntityManager,
        this.internalContext,
      );
    }
  }

  private async executeInsertWithInconnectOwnerIntegrity(
    decision: InconnectRecordAccessDecision,
  ): Promise<InsertResult> {
    const requiresDefaultOwnerResolution =
      doesInconnectCreateRequireDefaultOwnerResolution({
        decision,
        valuesSet: this.expressionMap.valuesSet,
      });

    if (!requiresDefaultOwnerResolution) {
      this.expressionMap.valuesSet = applyInconnectRecordAccessToCreateValues({
        decision,
        valuesSet: this.expressionMap.valuesSet,
      });
      this.validateRLSPredicatesForInsert();

      return super.execute();
    }

    if (
      decision.kind === 'not-managed' ||
      decision.kind === 'system-bypass' ||
      decision.kind === 'denied' ||
      !isDefined(decision.defaultOwnerRoleId)
    ) {
      throw new InconnectRecordAccessException(
        'The INCONNECT default owner Role could not be resolved',
        InconnectRecordAccessExceptionCode.ACCESS_DENIED,
      );
    }

    const existingQueryRunner = this.queryRunner;
    const queryRunner = this.obtainQueryRunner();
    const shouldReleaseQueryRunner = !isDefined(existingQueryRunner);
    const shouldManageTransaction = !queryRunner.isTransactionActive;

    this.queryRunner = queryRunner;

    try {
      if (shouldManageTransaction) {
        await queryRunner.startTransaction();
      }

      const workspaceSchema = this.expressionMap.mainAlias?.metadata.schema;

      if (!isDefined(workspaceSchema)) {
        throw new InconnectRecordAccessException(
          'The workspace schema is unavailable for default owner resolution',
          InconnectRecordAccessExceptionCode.ACCESS_DENIED,
        );
      }

      const resolvedDefaultOwnerWorkspaceMemberId =
        await resolveInconnectSingleActiveMemberOfRole({
          queryRunner,
          workspaceId: this.internalContext.workspaceId,
          workspaceSchema,
          roleId: decision.defaultOwnerRoleId,
        });

      this.expressionMap.valuesSet = applyInconnectRecordAccessToCreateValues({
        decision,
        valuesSet: this.expressionMap.valuesSet,
        resolvedDefaultOwnerWorkspaceMemberId,
      });
      this.validateRLSPredicatesForInsert();

      const result = await super.execute();

      if (shouldManageTransaction) {
        await queryRunner.commitTransaction();
      }

      return result;
    } catch (error) {
      if (shouldManageTransaction && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      if (shouldReleaseQueryRunner) {
        this.queryRunner = undefined;
        await queryRunner.release();
      }
    }
  }

  private resolveInconnectRecordAccessDecision(
    objectMetadata: FlatObjectMetadata,
  ): InconnectRecordAccessDecision {
    return resolveInconnectRecordAccessDecision({
      policy: this.internalContext.inconnectRecordAccessPolicy,
      authContext: this.authContext,
      objectMetadataId: objectMetadata.id,
      userWorkspaceRoleMap: this.internalContext.userWorkspaceRoleMap,
      apiKeyRoleMap: this.internalContext.apiKeyRoleMap,
      inconnectTeamAccessMaps: this.internalContext.inconnectTeamAccessMaps,
    });
  }

  private validateRLSPredicatesForInsert(): void {
    const mainAliasTarget = this.getMainAliasTarget();
    const objectMetadata = getObjectMetadataFromEntityTarget(
      mainAliasTarget,
      this.internalContext,
    );

    const valuesToInsert = Array.isArray(this.expressionMap.valuesSet)
      ? this.expressionMap.valuesSet
      : [this.expressionMap.valuesSet];

    const valuesToInsertFormatted = formatResult<T[]>(
      valuesToInsert,
      objectMetadata,
      this.internalContext.flatObjectMetadataMaps,
      this.internalContext.flatFieldMetadataMaps,
    );

    validateRLSPredicatesForRecords({
      records: valuesToInsertFormatted,
      objectMetadata,
      internalContext: this.internalContext,
      authContext: this.authContext,
      shouldBypassPermissionChecks: this.shouldBypassPermissionChecks,
    });
  }

  private getMainAliasTarget(): EntityTarget<T> {
    const mainAliasTarget = this.expressionMap.mainAlias?.target;

    if (!mainAliasTarget) {
      throw new TwentyORMException(
        'Main alias target is missing',
        TwentyORMExceptionCode.MISSING_MAIN_ALIAS_TARGET,
      );
    }

    return mainAliasTarget;
  }

  override select(): WorkspaceSelectQueryBuilder<T> {
    throw new TwentyORMException(
      'This builder cannot morph into a select builder',
      TwentyORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override update(): WorkspaceUpdateQueryBuilder<T> {
    throw new TwentyORMException(
      'This builder cannot morph into an update builder',
      TwentyORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override delete(): WorkspaceDeleteQueryBuilder<T> {
    throw new TwentyORMException(
      'This builder cannot morph into a delete builder',
      TwentyORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override softDelete(): WorkspaceSoftDeleteQueryBuilder<T> {
    throw new TwentyORMException(
      'This builder cannot morph into a soft delete builder',
      TwentyORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override restore(): WorkspaceSoftDeleteQueryBuilder<T> {
    throw new TwentyORMException(
      'This builder cannot morph into a soft delete builder',
      TwentyORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  setWorkspaceAuthContext(
    authContext: WorkspaceAuthContext,
  ): WorkspaceInsertQueryBuilder<T> {
    this.authContext = authContext;

    return this;
  }

  setInternallyInjectedFieldNames(fieldNames: string[]): this {
    this.internallyInjectedFieldNames = [...fieldNames];

    return this;
  }
}
