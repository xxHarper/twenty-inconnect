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
} from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { InconnectMessagingWebhookReceiptEntity } from 'src/modules/inconnect-messaging/entities/webhook-receipt.entity';
import {
  type InconnectMessagingJson,
  type InconnectMessagingOutboundState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingProviderStatusEvent', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_STATUS_NORMALIZED',
  `"normalizedStatus" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN')`,
)
@Index('IDX_INCONNECT_MSG_STATUS_MESSAGE_RECEIVED', [
  'messageId',
  'serverReceivedAt',
])
@Index('IDX_INCONNECT_MSG_STATUS_RECEIPT_UNIQUE', ['webhookReceiptId'], {
  unique: true,
  where: '"webhookReceiptId" IS NOT NULL',
})
export class InconnectMessagingProviderStatusEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_STATUS',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_STATUS_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  messageId: string;

  @ManyToOne(() => InconnectMessagingMessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_STATUS_MESSAGE',
      name: 'messageId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  message: Relation<InconnectMessagingMessageEntity>;

  @Column({ nullable: true, type: 'uuid' })
  webhookReceiptId: string | null;

  @ManyToOne(() => InconnectMessagingWebhookReceiptEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_STATUS_RECEIPT',
      name: 'webhookReceiptId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  webhookReceipt: Relation<InconnectMessagingWebhookReceiptEntity> | null;

  @Column({ nullable: true, type: 'text' })
  providerEventKey: string | null;

  @Column({ nullable: false, type: 'text' })
  originalStatus: string;

  @Column({ nullable: false, type: 'varchar' })
  normalizedStatus: InconnectMessagingOutboundState;

  @Column({ nullable: true, type: 'timestamptz' })
  providerOccurredAt: Date | null;

  @Column({ nullable: false, type: 'timestamptz' })
  serverReceivedAt: Date;

  @Column({ nullable: true, type: 'jsonb' })
  error: InconnectMessagingJson | null;

  @Column({ default: false, nullable: false, type: 'boolean' })
  appliedToProjection: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
