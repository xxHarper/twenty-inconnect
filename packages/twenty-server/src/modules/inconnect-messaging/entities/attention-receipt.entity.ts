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
  type AttentionReceiptRow,
  type AttentionTimestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';

@WasIntroducedInUpgrade({
  upgradeCommandName:
    '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
})
@Entity({ name: 'inconnectMessagingAttentionReceipt', schema: 'core' })
@ForeignKey(
  'inconnectMessagingAttentionEpoch',
  ['trackingEpochId', 'workspaceId', 'conversationId', 'providerConnectionId'],
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  {
    name: 'FK_IM_AT_RECEIPT_EPOCH',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Index('IDX_IM_AT_RECEIPT_EPOCH', [
  'trackingEpochId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
])
@Index(
  'IDX_IM_AT_RECEIPT_KEY',
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'eventKey',
  ],
  { unique: true },
)
@Index(
  'IDX_IM_AT_RECEIPT_SCOPE',
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ],
  { unique: true },
)
@Index(
  'IDX_IM_AT_RECEIPT_EFFECT_SCOPE',
  [
    'id',
    'effectId',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ],
  { unique: true },
)
@Index('IDX_IM_AT_RECEIPT_EFFECT', [
  'effectId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
])
@Index('IDX_IM_AT_RECEIPT_ORIGINAL', [
  'originalAuditId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'eventKey',
])
@ForeignKey(
  'inconnectMessagingAttentionEffect',
  [
    'effectId',
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
    'trackingEpochId',
  ],
  {
    name: 'FK_IM_AT_RECEIPT_EFFECT',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@ForeignKey(
  'inconnectMessagingAttentionTransitionAudit',
  [
    'originalAuditId',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'eventKey',
  ],
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'eventKey',
  ],
  {
    name: 'FK_IM_AT_RECEIPT_ORIGINAL',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Check(
  'CHK_IM_AT_RECEIPT_EVENTKEY',
  `octet_length("eventKey") BETWEEN 1 AND 1024 AND btrim("eventKey") = "eventKey"`,
)
@Check(
  'CHK_IM_AT_RECEIPT_ADMISSION',
  `(core.im_at_text("eventKey",1024) AND (isfinite("createdAt") AND "createdAt" >= timestamptz '0001-01-01 00:00:00+00' AND "createdAt" < timestamptz '10000-01-01 00:00:00+00')) IS TRUE`,
)
export class InconnectMessagingAttentionReceiptEntity implements AttentionReceiptRow {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_IM_AT_RECEIPT',
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

  @Column({ type: 'uuid', nullable: false })
  effectId: string;

  @Column({ type: 'uuid', nullable: false })
  originalAuditId: string;

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
