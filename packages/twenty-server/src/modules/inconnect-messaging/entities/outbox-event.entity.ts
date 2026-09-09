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
import {
  type InconnectMessagingJson,
  type InconnectMessagingOutboxProcessingState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingOutboxEvent', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_OUTBOX_STATE',
  `"processingState" IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')`,
)
@Check('CHK_INCONNECT_MSG_OUTBOX_ATTEMPTS', '"attemptCount" >= 0')
@Check(
  'CHK_INCONNECT_MSG_OUTBOX_LEASE',
  `("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)`,
)
@Index('IDX_INCONNECT_MSG_OUTBOX_DEDUPLICATION_UNIQUE', ['deduplicationKey'], {
  unique: true,
})
@Index('IDX_INCONNECT_MSG_OUTBOX_AVAILABLE', ['processingState', 'availableAt'])
@Index('IDX_INCONNECT_MSG_OUTBOX_AGGREGATE', [
  'workspaceId',
  'aggregateType',
  'aggregateId',
])
export class InconnectMessagingOutboxEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_OUTBOX',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_OUTBOX_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'varchar' })
  aggregateType: string;

  @Column({ nullable: false, type: 'uuid' })
  aggregateId: string;

  @Column({ nullable: false, type: 'varchar' })
  eventType: string;

  @Column({ nullable: false, type: 'jsonb' })
  immutablePayload: InconnectMessagingJson;

  @Column({ nullable: false, type: 'text' })
  deduplicationKey: string;

  @Column({ nullable: false, type: 'timestamptz' })
  availableAt: Date;

  @Column({ default: 'PENDING', nullable: false, type: 'varchar' })
  processingState: InconnectMessagingOutboxProcessingState;

  @Column({ nullable: true, type: 'uuid' })
  leaseToken: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  leaseExpiresAt: Date | null;

  @Column({ default: 0, nullable: false, type: 'integer' })
  attemptCount: number;

  @Column({ nullable: true, type: 'jsonb' })
  error: InconnectMessagingJson | null;

  @Column({ nullable: true, type: 'timestamptz' })
  publishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
