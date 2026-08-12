import { type InconnectRecordAccessDecision } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-workspace-policy.type';
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
  decision: Exclude<InconnectRecordAccessDecision, { kind: 'unrestricted' }>;
  tableAlias: string;
}): RenderedInconnectRecordAccessCondition => {
  if (decision.kind === 'denied') {
    return {
      marker: 'inconnect_record_access_denied',
      sql: '1 = 0',
      parameters: {},
    };
  }

  const parameterName = `inconnectRecordAccess_${decision.ownerFieldMetadataId.replace(/-/g, '_')}`;

  return {
    marker: parameterName,
    sql: `${escapeIdentifier(tableAlias)}.${escapeIdentifier(decision.ownerJoinColumnName)} = :${parameterName}`,
    parameters: { [parameterName]: decision.workspaceMemberId },
  };
};
