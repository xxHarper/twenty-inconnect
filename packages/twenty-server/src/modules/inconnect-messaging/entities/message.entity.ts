import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import {
  type InconnectMessagingDirection,
  type InconnectMessagingInboundTimestampSource,
  type InconnectMessagingJson,
  type InconnectMessagingMessageType,
  type InconnectMessagingOutboundState,
  type InconnectMessagingSendMode,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingMessage', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_DIRECTION',
  `"direction" IN ('INBOUND', 'OUTBOUND')`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_TYPE',
  `"type" IN ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION')`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_SEND_MODE',
  `"sendMode" IS NULL OR "sendMode" = 'FREEFORM'`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_OUTBOUND_STATE',
  `"outboundState" IS NULL OR "outboundState" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN')`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_DIRECTION_STATE',
  `("direction" = 'INBOUND' AND "outboundState" IS NULL AND "sendMode" IS NULL) OR ("direction" = 'OUTBOUND' AND "outboundState" IS NOT NULL AND "sendMode" IS NOT NULL)`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_RETRY',
  `"retryOfMessageId" IS NULL OR ("direction" = 'OUTBOUND' AND "retryOfMessageId" <> "id")`,
)
@Check(
  'CHK_INCONNECT_MSG_MESSAGE_INBOUND_TIMESTAMPS',
  `("direction" = 'INBOUND' AND "serverReceivedAt" IS NOT NULL AND "effectiveInboundAt" IS NOT NULL AND "timestampSource" IN ('PROVIDER', 'SERVER')) OR ("direction" = 'OUTBOUND' AND "serverReceivedAt" IS NULL AND "providerOccurredAt" IS NULL AND "effectiveInboundAt" IS NULL AND "timestampSource" IS NULL)`,
)
@Index('IDX_INCONNECT_MSG_MESSAGE_ID_WORKSPACE_UNIQUE', ['id', 'workspaceId'], {
  unique: true,
})
@Index(
  'IDX_INCONNECT_MSG_MESSAGE_ID_CONNECTION_WORKSPACE_UNIQUE',
  ['id', 'providerConnectionId', 'workspaceId'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_MSG_MESSAGE_PROVIDER_ID_UNIQUE',
  ['providerConnectionId', 'providerMessageId'],
  { unique: true, where: '"providerMessageId" IS NOT NULL' },
)
@Index(
  'IDX_INCONNECT_MSG_MESSAGE_CLIENT_REQUEST_UNIQUE',
  ['workspaceId', 'clientRequestId'],
  {
    unique: true,
    where: `"direction" = 'OUTBOUND' AND "clientRequestId" IS NOT NULL`,
  },
)
@Index('IDX_INCONNECT_MSG_MESSAGE_CONVERSATION_CREATED', [
  'conversationId',
  'createdAt',
])
export class InconnectMessagingMessageEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_MESSAGE',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_MESSAGE_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  conversationId: string;

  @Column({ nullable: false, type: 'uuid' })
  providerConnectionId: string;

  @ManyToOne(() => InconnectMessagingConversationEntity, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_MESSAGE_CONVERSATION',
      name: 'conversationId',
      referencedColumnName: 'id',
    },
    {
      name: 'providerConnectionId',
      referencedColumnName: 'providerConnectionId',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  conversation: Relation<InconnectMessagingConversationEntity>;

  @Column({ nullable: false, type: 'varchar' })
  direction: InconnectMessagingDirection;

  @Column({ nullable: false, type: 'varchar' })
  type: InconnectMessagingMessageType;

  @Column({ nullable: true, type: 'varchar' })
  sendMode: InconnectMessagingSendMode | null;

  @Column({ nullable: false, type: 'text' })
  body: string;

  @Column({ nullable: true, type: 'varchar' })
  outboundState: InconnectMessagingOutboundState | null;

  @Column({ nullable: true, type: 'text' })
  providerMessageId: string | null;

  @Column({ nullable: true, type: 'text' })
  providerStatus: string | null;

  @Column({ nullable: true, type: 'uuid' })
  clientRequestId: string | null;

  @Column({ nullable: true, type: 'text' })
  requestFingerprint: string | null;

  @Column({ nullable: true, type: 'uuid' })
  retryOfMessageId: string | null;

  @ManyToOne(() => InconnectMessagingMessageEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_MESSAGE_RETRY_OF',
      name: 'retryOfMessageId',
      referencedColumnName: 'id',
    },
    {
      name: 'providerConnectionId',
      referencedColumnName: 'providerConnectionId',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  retryOfMessage: Relation<InconnectMessagingMessageEntity> | null;

  @Column({ nullable: true, type: 'timestamptz' })
  sentAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  deliveredAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  readAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  failedAt: Date | null;

  @Column({ nullable: true, type: 'jsonb' })
  error: InconnectMessagingJson | null;

  @Column({ nullable: true, type: 'jsonb' })
  providerMetadata: InconnectMessagingJson | null;

  @Column({ nullable: true, type: 'timestamptz' })
  serverReceivedAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  providerOccurredAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  effectiveInboundAt: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  timestampSource: InconnectMessagingInboundTimestampSource | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
