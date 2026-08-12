import { FieldMetadataType } from 'twenty-shared/types';

import { UpdatedByUpdateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-one.pre-query-hook';
import { CreatedByCreateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-one.pre-query-hook';
import { ActorFromAuthContextService } from 'src/engine/core-modules/actor/services/actor-from-auth-context.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { computeInternallyInjectedFieldNames } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/compute-internally-injected-field-names.util';

const buildField = (name: string): FlatFieldMetadata =>
  ({
    id: `${name}-id`,
    universalIdentifier: `${name}-universal-id`,
    objectMetadataId: 'lead-id',
    name,
    type: FieldMetadataType.ACTOR,
  }) as FlatFieldMetadata;

const createdByField = buildField('createdBy');
const updatedByField = buildField('updatedBy');
const leadObject = {
  id: 'lead-id',
  universalIdentifier: 'lead-universal-id',
  nameSingular: 'lead',
  fieldIds: [createdByField.id, updatedByField.id],
} as FlatObjectMetadata;

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: {
    [leadObject.universalIdentifier]: leadObject,
  },
  universalIdentifierById: {
    [leadObject.id]: leadObject.universalIdentifier,
  },
  universalIdentifiersByApplicationId: {},
};
const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: {
    [createdByField.universalIdentifier]: createdByField,
    [updatedByField.universalIdentifier]: updatedByField,
  },
  universalIdentifierById: {
    [createdByField.id]: createdByField.universalIdentifier,
    [updatedByField.id]: updatedByField.universalIdentifier,
  },
  universalIdentifiersByApplicationId: {},
};

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  workspaceMemberId: 'scott-workspace-member-id',
  workspaceMember: {
    name: { firstName: 'Scott', lastName: 'Forstall' },
  },
} as WorkspaceAuthContext;

const cacheService = {
  getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
  }),
} as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService;

const actorService = new ActorFromAuthContextService(cacheService);

describe('computeInternallyInjectedFieldNames', () => {
  it('captures updatedBy added by the real update actor hook', async () => {
    const hook = new UpdatedByUpdateOnePreQueryHook(actorService);
    const dataBeforeHooks = { etapa: 'CONTACTADO' };

    const result = await hook.execute(authContext, 'lead', {
      id: 'lead-id',
      data: dataBeforeHooks,
    });

    expect(
      computeInternallyInjectedFieldNames({
        dataBeforeHooks,
        dataAfterHooks: result.data,
      }),
    ).toEqual(['updatedBy']);
  });

  it('captures createdBy and updatedBy added by the real create actor hook', async () => {
    const hook = new CreatedByCreateOnePreQueryHook(actorService);
    const dataBeforeHooks = { name: 'Nuevo Lead' };

    const result = await hook.execute(authContext, 'lead', {
      data: dataBeforeHooks,
    });

    expect(
      computeInternallyInjectedFieldNames({
        dataBeforeHooks,
        dataAfterHooks: result.data,
      }),
    ).toEqual(expect.arrayContaining(['createdBy', 'updatedBy']));
  });

  it('does not mark a client-provided actor field as internally injected', async () => {
    const hook = new UpdatedByUpdateOnePreQueryHook(actorService);
    const dataBeforeHooks = {
      etapa: 'CONTACTADO',
      updatedBy: { source: 'API', name: 'Forged actor' },
    };

    const result = await hook.execute(authContext, 'lead', {
      id: 'lead-id',
      data: dataBeforeHooks,
    });

    expect(
      computeInternallyInjectedFieldNames({
        dataBeforeHooks,
        dataAfterHooks: result.data,
      }),
    ).not.toContain('updatedBy');
  });
});
