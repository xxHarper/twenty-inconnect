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
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';

@Entity({ name: 'inconnectMessagingConversation', schema: 'core' })
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
@Index('IDX_INCONNECT_MSG_CONVERSATION_WORKSPACE', ['workspaceId'])
@Index('IDX_INCONNECT_MSG_CONVERSATION_CONNECTION', ['providerConnectionId'])
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
