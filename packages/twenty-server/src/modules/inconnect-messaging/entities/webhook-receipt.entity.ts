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
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import {
  type InconnectMessagingInboxProcessingState,
  type InconnectMessagingJson,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingWebhookReceipt', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_WEBHOOK_STATE',
  `"processingState" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')`,
)
@Check('CHK_INCONNECT_MSG_WEBHOOK_ATTEMPTS', '"attemptCount" >= 0')
@Check(
  'CHK_INCONNECT_MSG_WEBHOOK_LEASE',
  `("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)`,
)
@Index('IDX_INCONNECT_MSG_WEBHOOK_ID_WORKSPACE_UNIQUE', ['id', 'workspaceId'], {
  unique: true,
})
@Index(
  'IDX_INCONNECT_MSG_WEBHOOK_IDEMPOTENCY_UNIQUE',
  ['providerConnectionId', 'eventKind', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_WEBHOOK_PROCESSING', [
  'processingState',
  'firstReceivedAt',
])
export class InconnectMessagingWebhookReceiptEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_WEBHOOK',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_WEBHOOK_WORKSPACE',
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
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_WEBHOOK_CONNECTION',
      name: 'providerConnectionId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  providerConnection: Relation<InconnectMessagingProviderConnectionEntity>;

  @Column({ nullable: false, type: 'varchar' })
  eventKind: string;

  @Column({ nullable: false, type: 'text' })
  idempotencyKey: string;

  @Column({ nullable: false, type: 'varchar', length: 64 })
  payloadHash: string;

  @Column({ nullable: false, type: 'timestamptz' })
  firstReceivedAt: Date;

  @Column({ nullable: true, type: 'jsonb' })
  normalizedMetadata: InconnectMessagingJson | null;

  @Column({ default: 'RECEIVED', nullable: false, type: 'varchar' })
  processingState: InconnectMessagingInboxProcessingState;

  @Column({ nullable: true, type: 'uuid' })
  leaseToken: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  leaseExpiresAt: Date | null;

  @Column({ default: 0, nullable: false, type: 'integer' })
  attemptCount: number;

  @Column({ nullable: true, type: 'jsonb' })
  error: InconnectMessagingJson | null;

  @Column({ nullable: true, type: 'timestamptz' })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
