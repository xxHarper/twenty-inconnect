import { Injectable } from '@nestjs/common';

import { type ObjectRecord } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { CommonBaseQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-base-query-runner.service';
import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { STANDARD_ERROR_MESSAGE } from 'src/engine/api/common/common-query-runners/errors/standard-error-message.constant';
import { extractSingleRecordIdFromInsertResult } from 'src/engine/api/common/common-query-runners/utils/extract-single-record-id-from-insert-result.util';
import { CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  CommonExtendedInput,
  CommonInput,
  CommonQueryNames,
  CreateManyQueryArgs,
  CreateOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type InternalCreateWriteReceipt } from 'src/engine/api/common/types/internal-create-write-receipt.type';
import { assertIsValidUuid } from 'src/engine/api/graphql/workspace-query-runner/utils/assert-is-valid-uuid.util';
import { WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { assertMutationNotOnRemoteObject } from 'src/engine/metadata-modules/object-metadata/utils/assert-mutation-not-on-remote-object.util';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';

@Injectable()
export class CommonCreateOneQueryRunnerService extends CommonBaseQueryRunnerService<
  CreateOneQueryArgs,
  ObjectRecord
> {
  constructor(
    private readonly commonCreateManyQueryRunnerService: CommonCreateManyQueryRunnerService,
  ) {
    super();
  }

  protected readonly operationName = CommonQueryNames.CREATE_ONE;

  public async executeCreateOnlyForWriteReceiptWithQueryRunner(
    args: Omit<CommonInput<CreateOneQueryArgs>, 'selectedFields'>,
    queryRunnerContext: CommonBaseQueryRunnerContext,
    queryRunner: WorkspaceQueryRunner,
  ): Promise<InternalCreateWriteReceipt> {
    this.assertCreateOnlyWriteReceiptInput(args);

    let insertedRecordId: string | undefined;

    await this.executeWithQueryRunnerUsingRun(
      {
        data: args.data,
        selectedFields: { id: true },
      },
      queryRunnerContext,
      queryRunner,
      async (processedArgs, extendedQueryRunnerContext) => {
        this.assertCreateOnlyWriteReceiptInput(processedArgs);

        const insertResult =
          await this.commonCreateManyQueryRunnerService.executeInsertStage({
            repository: extendedQueryRunnerContext.repository,
            flatObjectMetadata: extendedQueryRunnerContext.flatObjectMetadata,
            flatObjectMetadataMaps:
              extendedQueryRunnerContext.flatObjectMetadataMaps,
            flatFieldMetadataMaps:
              extendedQueryRunnerContext.flatFieldMetadataMaps,
            flatIndexMaps: extendedQueryRunnerContext.flatIndexMaps,
            args: {
              ...processedArgs,
              data: [processedArgs.data],
            },
          });

        insertedRecordId = extractSingleRecordIdFromInsertResult(insertResult);

        return { id: insertedRecordId };
      },
    );

    if (!isDefined(insertedRecordId)) {
      throw new CommonQueryRunnerException(
        'The internal create write-receipt path did not produce a record identifier',
        CommonQueryRunnerExceptionCode.INTERNAL_SERVER_ERROR,
        { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
      );
    }

    return Object.freeze({
      objectMetadataId: queryRunnerContext.flatObjectMetadata.id,
      recordId: insertedRecordId,
    });
  }

  private assertCreateOnlyWriteReceiptInput(args: {
    data: unknown;
    upsert?: boolean;
  }): void {
    if (args.upsert) {
      throw new CommonQueryRunnerException(
        'The internal create write-receipt path does not support upsert',
        CommonQueryRunnerExceptionCode.INVALID_QUERY_INPUT,
        { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
      );
    }

    if (Array.isArray(args.data)) {
      throw new CommonQueryRunnerException(
        'The internal create write-receipt path supports exactly one record',
        CommonQueryRunnerExceptionCode.INVALID_QUERY_INPUT,
        { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
      );
    }
  }

  async run(
    args: CommonExtendedInput<CreateManyQueryArgs>,
    queryRunnerContext: CommonExtendedQueryRunnerContext,
  ): Promise<ObjectRecord> {
    const result = await this.commonCreateManyQueryRunnerService.run(
      {
        ...args,
        data: [args.data],
      },
      queryRunnerContext,
    );

    return result[0];
  }

  async computeArgs(
    args: CommonInput<CreateOneQueryArgs>,
    queryRunnerContext: CommonBaseQueryRunnerContext,
  ): Promise<CommonInput<CreateOneQueryArgs>> {
    const {
      authContext,
      flatObjectMetadata,
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
    } = queryRunnerContext;

    const coercedData = await this.dataArgProcessor.process({
      partialRecordInputs: [args.data],
      authContext,
      flatObjectMetadata,
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
      shouldBackfillPositionIfUndefined: !args.upsert,
    });

    return {
      ...args,
      data: coercedData[0],
    };
  }

  async processQueryResult(
    queryResult: ObjectRecord,
    flatObjectMetadata: FlatObjectMetadata,
    flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>,
    flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>,
    authContext: WorkspaceAuthContext,
  ): Promise<ObjectRecord> {
    return this.commonResultGettersService.processRecord(
      queryResult,
      flatObjectMetadata,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      authContext.workspace.id,
    );
  }

  async validate(
    args: CommonInput<CreateOneQueryArgs>,
    queryRunnerContext: CommonBaseQueryRunnerContext,
  ): Promise<void> {
    const { flatObjectMetadata } = queryRunnerContext;

    assertMutationNotOnRemoteObject(flatObjectMetadata);

    if (args.data?.id) {
      assertIsValidUuid(args.data.id);
    }
  }
}
