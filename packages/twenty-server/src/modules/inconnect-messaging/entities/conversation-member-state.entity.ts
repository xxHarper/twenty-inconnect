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

@Entity({ name: 'inconnectMessagingConversationMemberState', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_MEMBER_STATE_READ_CURSOR',
  `("lastReadMessageCreatedAt" IS NULL AND "lastReadMessageId" IS NULL) OR ("lastReadMessageCreatedAt" IS NOT NULL AND "lastReadMessageId" IS NOT NULL)`,
)
@Index(
  'IDX_INCONNECT_MSG_MEMBER_STATE_IDENTITY_UNIQUE',
  ['workspaceId', 'conversationId', 'workspaceMemberId'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_MEMBER_STATE_MEMBER_FAVORITE', [
  'workspaceId',
  'workspaceMemberId',
  'favorite',
  'conversationId',
])
export class InconnectMessagingConversationMemberStateEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_MEMBER_STATE',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_MEMBER_STATE_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => InconnectMessagingConversationEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_MEMBER_STATE_CONVERSATION',
      name: 'conversationId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  conversation: Relation<InconnectMessagingConversationEntity>;

  // Workspace Members live in workspace schemas, so current-member validity is
  // enforced by the centralized Messaging authorization boundary at runtime.
  @Column({ nullable: false, type: 'uuid' })
  workspaceMemberId: string;

  @Column({ default: false, nullable: false, type: 'boolean' })
  favorite: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  lastReadMessageCreatedAt: Date | null;

  @Column({ nullable: true, type: 'uuid' })
  lastReadMessageId: string | null;

  @Column({ default: false, nullable: false, type: 'boolean' })
  manualUnread: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
