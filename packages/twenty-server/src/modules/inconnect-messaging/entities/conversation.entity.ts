import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WasIntroducedInUpgrade } from 'src/engine/core-modules/upgrade/decorators/was-introduced-in-upgrade.decorator';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';

@Entity({ name: 'inconnectMessagingConversation', schema: 'core' })
@ForeignKey(
  'inconnectMessagingAttentionEpoch',
  ['attentionTrackingEpochId', 'workspaceId', 'id', 'providerConnectionId'],
  ['id', 'workspaceId', 'conversationId', 'providerConnectionId'],
  {
    name: 'FK_IM_AT_CONVERSATION_EPOCH',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    deferrable: 'INITIALLY DEFERRED',
  },
)
@Index('IDX_IM_AT_CONVERSATION_EPOCH', [
  'attentionTrackingEpochId',
  'workspaceId',
  'id',
  'providerConnectionId',
])
@Check(
  'CHK_IM_AT_CONVERSATION_STATE',
  `("attentionTrackingEpochId" IS NULL AND "attentionStatus" IS NULL AND "attentionRevision" IS NULL) OR ("attentionTrackingEpochId" IS NOT NULL AND "attentionStatus" IS NOT NULL AND "attentionRevision" IS NOT NULL AND "attentionStatus" IN ('PENDING','ATTENDED') AND "attentionRevision" ~ '^(0|[1-9][0-9]*)$' AND "attentionRevision" !~ '[^0-9]' AND (("attentionStatus" = 'PENDING') = ("pendingAt" IS NOT NULL)))`,
)
@Check(
  'CHK_INCONNECT_MSG_CONVERSATION_LINKED_TUPLE',
  `("linkedRecordObjectMetadataId" IS NULL AND "linkedRecordId" IS NULL) OR ("linkedRecordObjectMetadataId" IS NOT NULL AND "linkedRecordId" IS NOT NULL)`,
)
@Check(
  'CHK_INCONNECT_MSG_CONVERSATION_ADDRESS',
  `btrim("externalAddressNormalized") <> ''`,
)
@Index(
  'IDX_INCONNECT_MSG_CONVERSATION_ID_CONNECTION_WORKSPACE_UNIQUE',
  ['id', 'providerConnectionId', 'workspaceId'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_MSG_CONVERSATION_ID_WORKSPACE_UNIQUE',
  ['id', 'workspaceId'],
  {
    unique: true,
  },
)
@Index('IDX_INCONNECT_MSG_CONVERSATION_WORKSPACE', ['workspaceId'])
@Index('IDX_INCONNECT_MSG_CONVERSATION_CONNECTION', ['providerConnectionId'])
@Index(
  'IDX_INCONNECT_MSG_CONVERSATION_CONNECTION_ADDRESS_UNIQUE',
  ['providerConnectionId', 'externalAddressNormalized'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_MSG_CONVERSATION_LINKED_RECORD',
  ['workspaceId', 'linkedRecordObjectMetadataId', 'linkedRecordId'],
  { where: '"linkedRecordId" IS NOT NULL' },
)
export class InconnectMessagingConversationEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_CONVERSATION',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONVERSATION_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  providerConnectionId: string;

  @ManyToOne(() => InconnectMessagingProviderConnectionEntity, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONVERSATION_CONNECTION',
      name: 'providerConnectionId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  providerConnection: Relation<InconnectMessagingProviderConnectionEntity>;

  @Column({ nullable: false, type: 'text' })
  externalAddressNormalized: string;

  @Column({ nullable: true, type: 'text' })
  waId: string | null;

  @Column({ nullable: true, type: 'uuid' })
  linkedRecordObjectMetadataId: string | null;

  @Column({ nullable: true, type: 'uuid' })
  linkedRecordId: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  lastInboundAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  pendingAt: Date | null;

  // Dormant mappings also keep unadapted/direct repositories safe before DDL.
  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'uuid',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  attentionTrackingEpochId: string | null;

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'varchar',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  attentionStatus: 'PENDING' | 'ATTENDED' | null;

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'text',
    collation: 'C',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  attentionRevision: string | null;

  @ManyToOne(() => InconnectMessagingConfigurationEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONVERSATION_ANCHOR',
      name: 'workspaceId',
      referencedColumnName: 'workspaceId',
    },
    {
      name: 'linkedRecordObjectMetadataId',
      referencedColumnName: 'anchorObjectMetadataId',
    },
  ])
  configuration: Relation<InconnectMessagingConfigurationEntity> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
