import { Brackets } from 'typeorm';
import { type WhereClause } from 'typeorm/query-builder/WhereClause';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { hasNoInconnectRecordAccessScope } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { renderInconnectRecordAccessCondition } from 'src/engine/core-modules/inconnect-record-access/utils/render-inconnect-record-access-condition.util';
import { resolveInconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/utils/resolve-inconnect-record-access-decision.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';

type MutationQueryBuilder = {
  expressionMap: {
    wheres: WhereClause[];
  };
  andWhere: (condition: Brackets) => unknown;
  setParameters: (parameters: Record<string, unknown>) => unknown;
};

export const applyInconnectRecordAccessToMutationQueryBuilder = ({
  queryBuilder,
  objectMetadata,
  internalContext,
  authContext,
  tableAlias,
}: {
  queryBuilder: MutationQueryBuilder;
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
  authContext: WorkspaceAuthContext;
  tableAlias?: string;
}): void => {
  const decision = resolveInconnectRecordAccessDecision({
    policy: internalContext.inconnectRecordAccessPolicy,
    authContext,
    objectMetadataId: objectMetadata.id,
    userWorkspaceRoleMap: internalContext.userWorkspaceRoleMap,
    apiKeyRoleMap: internalContext.apiKeyRoleMap,
    inconnectTeamAccessMaps: internalContext.inconnectTeamAccessMaps,
  });

  if (hasNoInconnectRecordAccessScope(decision)) {
    return;
  }

  const mutationDecision =
    decision.kind === 'owner-workspace-member-ids' &&
    decision.sourceEffect === 'ownAndTeamRecords'
      ? ({ kind: 'denied' } as const)
      : decision;

  const renderedCondition = renderInconnectRecordAccessCondition({
    decision: mutationDecision,
    tableAlias: tableAlias ?? objectMetadata.nameSingular,
  });
  const isAlreadyApplied = queryBuilder.expressionMap.wheres.some(
    (whereClause) =>
      (
        whereClause as typeof whereClause & {
          inconnectRecordAccessMarker?: string;
        }
      ).inconnectRecordAccessMarker === renderedCondition.marker,
  );

  if (isAlreadyApplied) {
    queryBuilder.setParameters(renderedCondition.parameters);

    return;
  }

  const existingWhereClauses = [...queryBuilder.expressionMap.wheres];
  const mandatoryWhereClause = Object.assign(
    {
      type: 'and' as const,
      condition: renderedCondition.sql,
    },
    { inconnectRecordAccessMarker: renderedCondition.marker },
  );

  queryBuilder.expressionMap.wheres = [mandatoryWhereClause];

  if (existingWhereClauses.length > 0) {
    queryBuilder.andWhere(
      new Brackets((whereExpressionBuilder) => {
        (
          whereExpressionBuilder as unknown as {
            expressionMap: { wheres: WhereClause[] };
          }
        ).expressionMap.wheres = existingWhereClauses;
      }),
    );
  }

  queryBuilder.setParameters(renderedCondition.parameters);
};
