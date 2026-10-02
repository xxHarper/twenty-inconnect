import { type InsertResult, type ObjectLiteral } from 'typeorm';

import { CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import {
  type CommonExtendedInput,
  type CreateManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';

const emptyFlatEntityMaps = () => ({
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
});

describe('CommonCreateManyQueryRunnerService internal write provenance', () => {
  it('passes hook-injected fields to the repository insert path', async () => {
    const repository = {
      insert: jest.fn().mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      } satisfies InsertResult),
    } as unknown as WorkspaceRepository<ObjectLiteral>;
    const flatObjectMetadata = {
      id: 'lead-id',
      nameSingular: 'lead',
      fieldIds: [],
    } as unknown as FlatObjectMetadata;
    const args = {
      data: [
        {
          name: 'Nuevo Lead',
          createdBy: { source: 'MANUAL', name: 'Scott Forstall' },
          updatedBy: { source: 'MANUAL', name: 'Scott Forstall' },
        },
      ],
      upsert: false,
      selectedFieldsResult: {
        select: {},
        relations: undefined,
        relationFieldsCount: 0,
      },
      internallyInjectedFieldNames: ['createdBy', 'updatedBy'],
    } as unknown as CommonExtendedInput<CreateManyQueryArgs>;
    const runner = new CommonCreateManyQueryRunnerService(
      {} as RecordPositionService,
    );

    await runner.executeInsertStage({
      repository,
      flatObjectMetadata,
      flatObjectMetadataMaps: emptyFlatEntityMaps(),
      flatFieldMetadataMaps: emptyFlatEntityMaps(),
      flatIndexMaps: emptyFlatEntityMaps(),
      args,
    });

    expect(repository.insert).toHaveBeenCalledWith(
      args.data,
      undefined,
      ['id'],
      ['createdBy', 'updatedBy'],
    );
  });
});
