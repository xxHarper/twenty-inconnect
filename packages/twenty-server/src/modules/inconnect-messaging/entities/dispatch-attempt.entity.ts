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
import {
  type InconnectMessagingDispatchAttemptOutcome,
  type InconnectMessagingJson,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingDispatchAttempt', schema: 'core' })
@Check('CHK_INCONNECT_MSG_ATTEMPT_NUMBER', '"attemptNumber" > 0')
@Check(
  'CHK_INCONNECT_MSG_ATTEMPT_OUTCOME',
  `"outcome" IS NULL OR "outcome" IN ('ACCEPTED', 'REJECTED_DEFINITIVE', 'FAILED_BEFORE_SUBMIT', 'UNKNOWN')`,
)
@Check(
  'CHK_INCONNECT_MSG_ATTEMPT_LEASE',
  `("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)`,
)
@Index(
  'IDX_INCONNECT_MSG_ATTEMPT_MESSAGE_NUMBER_UNIQUE',
  ['messageId', 'attemptNumber'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_ATTEMPT_WORKSPACE', ['workspaceId'])
export class InconnectMessagingDispatchAttemptEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_ATTEMPT',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_ATTEMPT_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  messageId: string;

  @ManyToOne(() => InconnectMessagingMessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_ATTEMPT_MESSAGE',
      name: 'messageId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  message: Relation<InconnectMessagingMessageEntity>;

  @Column({ nullable: false, type: 'integer' })
  attemptNumber: number;

  @Column({ nullable: true, type: 'uuid' })
  leaseToken: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  leaseExpiresAt: Date | null;

  @Column({ nullable: false, type: 'timestamptz' })
  startedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  providerRequestStartedAt: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  completedAt: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  outcome: InconnectMessagingDispatchAttemptOutcome | null;

  @Column({ nullable: true, type: 'jsonb' })
  error: InconnectMessagingJson | null;

  @Column({ nullable: true, type: 'jsonb' })
  providerMetadata: InconnectMessagingJson | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
