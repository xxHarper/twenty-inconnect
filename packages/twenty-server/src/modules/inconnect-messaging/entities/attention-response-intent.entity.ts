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
  type AttentionResponseIntentRow,
  type AttentionTimestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';

@WasIntroducedInUpgrade({
  upgradeCommandName:
    '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
})
@Entity({ name: 'inconnectMessagingAttentionResponseIntent', schema: 'core' })
@ForeignKey(
  'inconnectMessagingAttentionEpoch',
  ['trackingEpochId', 'workspaceId', 'conversationId', 'providerConnectionId'],
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  {
    name: 'FK_IM_AT_INTENT_EPOCH',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Index('IDX_IM_AT_RESPONSEINTENT_EPOCH', [
  'trackingEpochId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
])
@Index(
  'IDX_IM_AT_INTENT_KEY',
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'intentId',
  ],
  { unique: true },
)
@Index(
  'IDX_IM_AT_INTENT_MESSAGE',
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'messageId',
  ],
  { unique: true },
)
@Index('IDX_IM_AT_INTENT_MESSAGE_FK', [
  'messageId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
])
@Index('IDX_IM_AT_INTENT_REGISTRATION', [
  'registeredEffectId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'intentId',
])
@ForeignKey(
  'inconnectMessagingMessage',
  [
    'messageId',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ],
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'attentionTrackingEpochId',
  ],
  {
    name: 'FK_IM_AT_INTENT_MESSAGE',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@ForeignKey(
  'inconnectMessagingAttentionEffect',
  [
    'registeredEffectId',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'intentId',
  ],
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'responseIntentId',
  ],
  {
    name: 'FK_IM_AT_INTENT_REGISTRATION',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    deferrable: 'INITIALLY DEFERRED',
  },
)
@Check(
  'CHK_IM_AT_INTENT_REVISION',
  `"coveredRevision" ~ '^(0|[1-9][0-9]*)$' AND "coveredRevision" !~ '[^0-9]'`,
)
@Check(
  'CHK_IM_AT_INTENT_PROVENANCE',
  `"provenanceKind" IN ('HUMAN','AUTOMATION','LEGACY_UNKNOWN') AND (("provenanceKind" = 'HUMAN') = ("actorWorkspaceMemberId" IS NOT NULL)) AND "format" IN ('FREEFORM','TEMPLATE')`,
)
@Check(
  'CHK_IM_AT_RESPONSEINTENT_INTENTID',
  `octet_length("intentId") BETWEEN 1 AND 128 AND btrim("intentId") = "intentId"`,
)
@Check(
  'CHK_IM_AT_RESPONSEINTENT_CONTENTFINGERPRINT',
  `octet_length("contentFingerprint") BETWEEN 1 AND 16384 AND btrim("contentFingerprint") = "contentFingerprint"`,
)
@Check(
  'CHK_IM_AT_RESPONSEINTENT_AUTHORITYREFERENCE',
  `octet_length("authorityReference") BETWEEN 1 AND 16384 AND btrim("authorityReference") = "authorityReference"`,
)
@Check(
  'CHK_IM_AT_RESPONSEINTENT_ADMISSION',
  `(core.im_at_text("intentId",128) AND core.im_at_text("contentFingerprint",16384) AND core.im_at_text("authorityReference",16384) AND (isfinite("createdAt") AND "createdAt" >= timestamptz '0001-01-01 00:00:00+00' AND "createdAt" < timestamptz '10000-01-01 00:00:00+00')) IS TRUE`,
)
export class InconnectMessagingAttentionResponseIntentEntity implements AttentionResponseIntentRow {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_IM_AT_RESPONSEINTENT',
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
  intentId: string;

  @Column({ type: 'uuid', nullable: false })
  messageId: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  contentFingerprint: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  coveredRevision: string;

  @Column({ type: 'varchar', nullable: false })
  provenanceKind: AttentionResponseIntentRow['provenanceKind'];

  @Column({ type: 'uuid', nullable: true })
  actorWorkspaceMemberId: string | null;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  authorityReference: string;

  @Column({ type: 'varchar', nullable: false })
  format: AttentionResponseIntentRow['format'];

  @Column({ type: 'uuid', nullable: false })
  registeredEffectId: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
    default: () => 'now()',
  })
  createdAt: AttentionTimestamp;

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
