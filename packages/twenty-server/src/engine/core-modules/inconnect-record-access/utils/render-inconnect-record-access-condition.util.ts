import {
  hasNoInconnectRecordAccessScope,
  type InconnectRecordAccessDecision,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

export type RenderedInconnectRecordAccessCondition = {
  marker: string;
  sql: string;
  parameters: Record<string, unknown>;
};

export const renderInconnectRecordAccessCondition = ({
  decision,
  tableAlias,
}: {
  decision: InconnectRecordAccessDecision;
  tableAlias: string;
}): RenderedInconnectRecordAccessCondition => {
  if (decision.kind === 'denied' || decision.kind === 'own-and-team-records') {
    return {
      marker:
        decision.kind === 'denied'
          ? 'inconnect_record_access_denied'
          : 'inconnect_record_access_team_scope_not_enabled',
      sql: '1 = 0',
      parameters: {},
    };
  }

  if (hasNoInconnectRecordAccessScope(decision)) {
    throw new Error('Cannot render an unrestricted INCONNECT decision');
  }

  const parameterName = `inconnectRecordAccess_${decision.ownerFieldMetadataId.replace(/-/g, '_')}`;

  return {
    marker: parameterName,
    sql: `${escapeIdentifier(tableAlias)}.${escapeIdentifier(decision.ownerJoinColumnName)} = :${parameterName}`,
    parameters: { [parameterName]: decision.workspaceMemberId },
  };
};
