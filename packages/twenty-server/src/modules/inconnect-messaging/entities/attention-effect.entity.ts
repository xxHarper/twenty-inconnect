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
  type AttentionEffectRow,
  type AttentionTimestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';

@WasIntroducedInUpgrade({
  upgradeCommandName:
    '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
})
@Entity({ name: 'inconnectMessagingAttentionEffect', schema: 'core' })
@ForeignKey(
  'inconnectMessagingAttentionEpoch',
  ['trackingEpochId', 'workspaceId', 'conversationId', 'providerConnectionId'],
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  {
    name: 'FK_IM_AT_EFFECT_EPOCH',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Index('IDX_IM_AT_EFFECT_EPOCH', [
  'trackingEpochId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
])
@Index(
  'IDX_IM_AT_EFFECT_KEY',
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'effectKey',
  ],
  { unique: true },
)
@Index(
  'IDX_IM_AT_EFFECT_SCOPE',
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
  'IDX_IM_AT_EFFECT_INTENT',
  [
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'responseIntentId',
  ],
  { unique: true },
)
@Index('IDX_IM_AT_EFFECT_DIAGNOSTIC', [
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'createdAt',
  'id',
])
@Index('IDX_IM_AT_EFFECT_MESSAGE', [
  'messageId',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
])
@Index('IDX_IM_AT_EFFECT_RESPONSE', [
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
  'responseIntentId',
])
@Index('IDX_IM_AT_EFFECT_STATUS', [
  'providerStatusEventId',
  'messageId',
  'workspaceId',
])
@Index('IDX_IM_AT_EFFECT_CANONICAL', [
  'canonicalReceiptId',
  'id',
  'workspaceId',
  'conversationId',
  'providerConnectionId',
  'trackingEpochId',
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
    name: 'FK_IM_AT_EFFECT_MESSAGE',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@ForeignKey(
  'inconnectMessagingAttentionResponseIntent',
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'responseIntentId',
  ],
  [
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
    'intentId',
  ],
  {
    name: 'FK_IM_AT_EFFECT_RESPONSE',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    deferrable: 'INITIALLY DEFERRED',
  },
)
@ForeignKey(
  'inconnectMessagingProviderStatusEvent',
  ['providerStatusEventId', 'messageId', 'workspaceId'],
  ['id', 'messageId', 'workspaceId'],
  {
    name: 'FK_IM_AT_EFFECT_STATUS',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@ForeignKey(
  'inconnectMessagingAttentionReceipt',
  [
    'canonicalReceiptId',
    'id',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ],
  [
    'id',
    'effectId',
    'workspaceId',
    'conversationId',
    'providerConnectionId',
    'trackingEpochId',
  ],
  {
    name: 'FK_IM_AT_EFFECT_CANONICAL',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    deferrable: 'INITIALLY DEFERRED',
  },
)
@Check(
  'CHK_IM_AT_EFFECT_KIND',
  `"eventKind" IN ('INBOUND_RECEIVED','MESSAGES_READ','MANUAL_ACTION','RESPONSE_INTENDED','PROVIDER_EVIDENCE')`,
)
@Check(
  'CHK_IM_AT_EFFECT_CAUSE',
  `(("eventKind" IN ('INBOUND_RECEIVED','RESPONSE_INTENDED','PROVIDER_EVIDENCE')) = ("messageId" IS NOT NULL)) AND (("eventKind" IN ('RESPONSE_INTENDED','PROVIDER_EVIDENCE')) = ("responseIntentId" IS NOT NULL)) AND (("eventKind" = 'PROVIDER_EVIDENCE') = ("providerStatusEventId" IS NOT NULL))`,
)
@Check(
  'CHK_IM_AT_EFFECT_EFFECTKEY',
  `octet_length("effectKey") BETWEEN 1 AND 1024 AND btrim("effectKey") = "effectKey"`,
)
@Check(
  'CHK_IM_AT_EFFECT_FINGERPRINT',
  `octet_length("fingerprint") BETWEEN 1 AND 16384 AND btrim("fingerprint") = "fingerprint"`,
)
@Check(
  'CHK_IM_AT_EFFECT_RESPONSEINTENTID',
  `"responseIntentId" IS NULL OR (octet_length("responseIntentId") BETWEEN 1 AND 128 AND btrim("responseIntentId") = "responseIntentId")`,
)
@Check(
  'CHK_IM_AT_EFFECT_ADMISSION',
  `(core.im_at_text("effectKey",1024) AND core.im_at_text("fingerprint",16384) AND ("responseIntentId" IS NULL OR core.im_at_text("responseIntentId",128)) AND (isfinite("createdAt") AND "createdAt" >= timestamptz '0001-01-01 00:00:00+00' AND "createdAt" < timestamptz '10000-01-01 00:00:00+00')) IS TRUE`,
)
export class InconnectMessagingAttentionEffectEntity implements AttentionEffectRow {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_IM_AT_EFFECT',
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
  effectKey: string;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  fingerprint: string;

  @Column({ type: 'uuid', nullable: false })
  canonicalReceiptId: string;

  @Column({ type: 'varchar', nullable: false })
  eventKind: AttentionEffectRow['eventKind'];

  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'text', nullable: true, collation: 'C' })
  responseIntentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  providerStatusEventId: string | null;

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
