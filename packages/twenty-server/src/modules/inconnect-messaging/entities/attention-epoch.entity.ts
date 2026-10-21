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
  type AttentionEpochRow,
  type AttentionTimestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/attention-persistence.types';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';

@WasIntroducedInUpgrade({
  upgradeCommandName:
    '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
})
@Entity({ name: 'inconnectMessagingAttentionEpoch', schema: 'core' })
@Index(
  'IDX_IM_AT_EPOCH_SCOPE',
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  { unique: true },
)
@Index(
  'IDX_IM_AT_EPOCH_ACTIVE',
  ['workspaceId', 'conversationId', 'providerConnectionId'],
  { unique: true, where: `"lifecycle" <> 'CLOSED'` },
)
@Index('IDX_IM_AT_EPOCH_LIFECYCLE', ['workspaceId', 'lifecycle', 'id'])
@Index('IDX_IM_AT_EPOCH_CONVERSATION', [
  'conversationId',
  'providerConnectionId',
  'workspaceId',
])
@ForeignKey(
  'inconnectMessagingConversation',
  ['conversationId', 'providerConnectionId', 'workspaceId'],
  ['id', 'providerConnectionId', 'workspaceId'],
  {
    name: 'FK_IM_AT_EPOCH_CONVERSATION',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
)
@Check(
  'CHK_IM_AT_EPOCH_VERSION',
  `"identityVersion" = 'attention-domain-v1' AND "reducerVersion" = 'attention-reducer-v1' AND "successPolicy" = 'PROPOSED_DELIVERED_OR_READ'`,
)
@Check(
  'CHK_IM_AT_EPOCH_BASELINE',
  `"bootstrapRevision" = '0' AND "bootstrapStatus" IN ('PENDING','ATTENDED') AND (("bootstrapStatus" = 'PENDING') = ("bootstrapPendingAt" IS NOT NULL))`,
)
@Check(
  'CHK_IM_AT_EPOCH_LIFECYCLE',
  `"lifecycle" IN ('PREPARING','READY','SUSPENDED','CLOSED') AND (("lifecycle" = 'CLOSED') = ("closedAt" IS NOT NULL)) AND ("lifecycle" <> 'PREPARING' OR "activatedAt" IS NULL) AND ("lifecycle" <> 'READY' OR "activatedAt" IS NOT NULL) AND ("activatedAt" IS NULL OR "activatedAt" >= "createdAt") AND ("closedAt" IS NULL OR ("closedAt" >= "createdAt" AND ("activatedAt" IS NULL OR "closedAt" >= "activatedAt")))`,
)
@Check(
  'CHK_IM_AT_EPOCH_BOOTSTRAPREFERENCE',
  `octet_length("bootstrapReference") BETWEEN 1 AND 16384 AND btrim("bootstrapReference") = "bootstrapReference"`,
)
@Check(
  'CHK_IM_AT_EPOCH_ADMISSION',
  `(("bootstrapPendingAt" IS NULL OR (isfinite("bootstrapPendingAt") AND "bootstrapPendingAt" >= timestamptz '0001-01-01 00:00:00+00' AND "bootstrapPendingAt" < timestamptz '10000-01-01 00:00:00+00')) AND core.im_at_text("bootstrapReference",16384) AND (isfinite("createdAt") AND "createdAt" >= timestamptz '0001-01-01 00:00:00+00' AND "createdAt" < timestamptz '10000-01-01 00:00:00+00') AND ("activatedAt" IS NULL OR (isfinite("activatedAt") AND "activatedAt" >= timestamptz '0001-01-01 00:00:00+00' AND "activatedAt" < timestamptz '10000-01-01 00:00:00+00')) AND ("closedAt" IS NULL OR (isfinite("closedAt") AND "closedAt" >= timestamptz '0001-01-01 00:00:00+00' AND "closedAt" < timestamptz '10000-01-01 00:00:00+00'))) IS TRUE`,
)
export class InconnectMessagingAttentionEpochEntity implements AttentionEpochRow {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_IM_AT_EPOCH',
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

  @Column({ type: 'varchar', nullable: false })
  identityVersion: AttentionEpochRow['identityVersion'];

  @Column({ type: 'varchar', nullable: false })
  reducerVersion: AttentionEpochRow['reducerVersion'];

  @Column({ type: 'varchar', nullable: false })
  successPolicy: AttentionEpochRow['successPolicy'];

  @Column({ type: 'varchar', nullable: false })
  lifecycle: AttentionEpochRow['lifecycle'];

  @Column({ type: 'varchar', nullable: false })
  bootstrapStatus: AttentionEpochRow['bootstrapStatus'];

  @Column({ type: 'text', nullable: false, collation: 'C' })
  bootstrapRevision: string;

  @Column({
    type: 'timestamptz',
    nullable: true,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
  })
  bootstrapPendingAt: AttentionTimestamp | null;

  @Column({ type: 'text', nullable: false, collation: 'C' })
  bootstrapReference: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
    default: () => 'now()',
  })
  createdAt: AttentionTimestamp;

  @Column({
    type: 'timestamptz',
    nullable: true,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
  })
  activatedAt: AttentionTimestamp | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
  })
  closedAt: AttentionTimestamp | null;

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
