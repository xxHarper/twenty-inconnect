import { type ObjectLiteral } from 'typeorm';

import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  type CommonExtendedInput,
  type UpdateManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';

describe('CommonUpdateManyQueryRunnerService internal write provenance', () => {
  it('passes hook-injected fields to the update query builder', async () => {
    const mutationQueryBuilder = {
      setInternallyInjectedFieldNames: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ generatedMaps: [] }),
    };
    const selectQueryBuilder = {
      expressionMap: { joinAttributes: [] },
      update: jest.fn().mockReturnValue(mutationQueryBuilder),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(selectQueryBuilder),
    } as unknown as WorkspaceRepository<ObjectLiteral>;
    const commonQueryParser = {
      applyFilterToBuilder: jest.fn(),
    };
    const flatObjectMetadata = {
      id: 'lead-id',
      nameSingular: 'lead',
      fieldIds: [],
    } as unknown as FlatObjectMetadata;
    const args = {
      filter: { id: { eq: 'lead-id' } },
      data: {
        etapa: 'CONTACTADO',
        updatedBy: { source: 'MANUAL', name: 'Scott Forstall' },
      },
      selectedFieldsResult: {
        select: {},
        relations: undefined,
        relationFieldsCount: 0,
      },
      internallyInjectedFieldNames: ['updatedBy'],
    } as unknown as CommonExtendedInput<UpdateManyQueryArgs>;
    const context = {
      repository,
      flatObjectMetadata,
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatFieldMetadataMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      commonQueryParser,
    } as unknown as CommonExtendedQueryRunnerContext;

    await new CommonUpdateManyQueryRunnerService().run(args, context);

    expect(
      mutationQueryBuilder.setInternallyInjectedFieldNames,
    ).toHaveBeenCalledWith(['updatedBy']);
    expect(mutationQueryBuilder.set).toHaveBeenCalledWith(args.data);
  });
});
