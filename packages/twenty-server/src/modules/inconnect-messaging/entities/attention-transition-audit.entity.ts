import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WasIntroducedInUpgrade } from 'src/engine/core-modules/upgrade/decorators/was-introduced-in-upgrade.decorator';
import {
  type AttentionTransitionAuditRow,
  type AttentionTimestamp,
  type AttentionStoredResult,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';

@WasIntroducedInUpgrade({
  upgradeCommandName:
    '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
})
@Entity({ name: 'inconnectMessagingAttentionTransitionAudit', schema: 'core' })
@ForeignKey(
  'inconnectMessagingAttentionEpoch',
  ['trackingEpochId', 'workspaceId', 'conversationId', 'providerConnectionId'],
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  {
    name: 'FK_IM_AT_AUDIT_EPOCH',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Index('IDX_IM_AT_TRANSITIONAUDIT_EPOCH', [
  'trackingEpochId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
])
@Index(
  'IDX_IM_AT_AUDIT_ORIGINAL',
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'eventKey',
  ],
  { unique: true },
)
@Index('IDX_IM_AT_AUDIT_DIAGNOSTIC', [
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'recordedAt',
  'id',
])
@Index('IDX_IM_AT_AUDIT_EVENT', [
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'eventKey',
  'recordedAt',
  'id',
])
@Check('CHK_IM_AT_AUDIT_VERSION', `"resultVersion" = 1`)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_EVENTKEY',
  `octet_length("eventKey") BETWEEN 1 AND 1024 AND btrim("eventKey") = "eventKey"`,
)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_EFFECTKEY',
  `octet_length("effectKey") BETWEEN 1 AND 1024 AND btrim("effectKey") = "effectKey"`,
)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_FINGERPRINT',
  `octet_length("fingerprint") BETWEEN 1 AND 16384 AND btrim("fingerprint") = "fingerprint"`,
)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_AUTHENTICATIONREFERENCE',
  `octet_length("authenticationReference") BETWEEN 1 AND 16384 AND btrim("authenticationReference") = "authenticationReference"`,
)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_CORRELATIONREFERENCE',
  `"correlationReference" IS NULL OR (octet_length("correlationReference") BETWEEN 1 AND 16384 AND btrim("correlationReference") = "correlationReference")`,
)
@Check(
  'CHK_IM_AT_TRANSITIONAUDIT_ADMISSION',
  `(core.im_at_text("eventKey",1024) AND core.im_at_text("effectKey",1024) AND core.im_at_text("fingerprint",16384) AND core.im_at_text("authenticationReference",16384) AND ("correlationReference" IS NULL OR core.im_at_text("correlationReference",16384)) AND (isfinite("recordedAt") AND "recordedAt" >= timestamptz '0001-01-01 00:00:00+00' AND "recordedAt" < timestamptz '10000-01-01 00:00:00+00') AND core.im_at_result_valid("result","eventKey","effectKey","fingerprint","workspaceId","conversationId","providerConnectionId") AND ("authorityKind" IN ('HUMAN','BACKEND','PROVIDER') AND
    (("result" #>> '{audit,eventKind}' <> 'PROVIDER_EVIDENCE') OR ("authorityKind" = 'PROVIDER' AND "correlationReference" IS NOT NULL)) AND
    (("result" #>> '{audit,eventKind}' NOT IN ('MANUAL_ACTION','MESSAGES_READ')) OR "authorityKind" = 'HUMAN') AND
    (("result" #>> '{audit,eventKind}' <> 'INBOUND_RECEIVED') OR "authorityKind" <> 'HUMAN') AND
    (("result" #>> '{audit,eventKind}' <> 'RESPONSE_INTENDED') OR "authorityKind" = CASE WHEN "result" #>> '{audit,provenance,kind}' = 'HUMAN' THEN 'HUMAN' ELSE 'BACKEND' END))) IS TRUE`,
)
export class InconnectMessagingAttentionTransitionAuditEntity implements AttentionTransitionAuditRow {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_IM_AT_TRANSITIONAUDIT',
  })
  id: string;

  // Generic core export enumerates workspaceId-bearing metadata, including raw SQL.
  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  @Column({ type: 'uuid', nullable: false })
  conversationId: string;

  @Column({ type: 'uuid', nullable: false })
  providerConnectionId: string;

  @Column({ type: 'uuid', nullable: false })
  trackingEpochId: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  eventKey: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  effectKey: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  fingerprint: string;

  @Column({ type: 'jsonb', nullable: false })
  result: AttentionStoredResult;

  @Column({ type: 'integer', nullable: false })
  resultVersion: 1;

  @Column({ type: 'varchar', nullable: false })
  authorityKind: AttentionTransitionAuditRow['authorityKind'];

  @Column({ type: 'text', nullable: false, collation: 'C' })
  authenticationReference: string;

  @Column({ type: 'text', nullable: true, collation: 'C' })
  correlationReference: string | null;

  @Column({
    type: 'timestamptz',
    nullable: false,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
    default: () => 'now()',
  })
  recordedAt: AttentionTimestamp;

  // PostgreSQL owns this full transaction marker; it is outside the domain row.
  @Column({
    type: 'text',
    nullable: false,
    collation: 'C',
    select: false,
    insert: false,
    update: false,
  })
  attentionCreatedTransactionId: string;
}
