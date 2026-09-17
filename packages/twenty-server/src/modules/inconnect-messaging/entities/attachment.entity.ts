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

import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import {
  type InconnectMessagingAttachmentIngestionState,
  type InconnectMessagingAttachmentType,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingAttachment', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_ATTACHMENT_TYPE',
  `"type" IN ('IMAGE', 'STICKER', 'AUDIO', 'VIDEO', 'DOCUMENT', 'CONTACT')`,
)
@Check(
  'CHK_INCONNECT_MSG_ATTACHMENT_STATE',
  `"ingestionState" IN ('PENDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'EXPIRED')`,
)
@Check(
  'CHK_INCONNECT_MSG_ATTACHMENT_AVAILABLE',
  `("ingestionState" = 'AVAILABLE' AND "fileId" IS NOT NULL AND "mimeType" IS NOT NULL AND "size" IS NOT NULL AND "availableAt" IS NOT NULL) OR ("ingestionState" <> 'AVAILABLE' AND "fileId" IS NULL AND "mimeType" IS NULL AND "size" IS NULL AND "availableAt" IS NULL)`,
)
@Check(
  'CHK_INCONNECT_MSG_ATTACHMENT_LEASE',
  `("ingestionState" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("ingestionState" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)`,
)
@Index(
  'IDX_INCONNECT_MSG_ATTACHMENT_MESSAGE_ORDINAL_UNIQUE',
  ['messageId', 'ordinal'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_ATTACHMENT_FILE_UNIQUE', ['fileId'], {
  unique: true,
  where: '"fileId" IS NOT NULL',
})
@Index('IDX_INCONNECT_MSG_ATTACHMENT_RECOVERY', [
  'ingestionState',
  'leaseExpiresAt',
])
export class InconnectMessagingAttachmentEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_ATTACHMENT',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_ATTACHMENT_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  messageId: string;

  @Column({ nullable: false, type: 'uuid' })
  providerConnectionId: string;

  @ManyToOne(() => InconnectMessagingMessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_ATTACHMENT_MESSAGE',
      name: 'messageId',
      referencedColumnName: 'id',
    },
    {
      name: 'providerConnectionId',
      referencedColumnName: 'providerConnectionId',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  message: Relation<InconnectMessagingMessageEntity>;

  @Column({ nullable: false, type: 'smallint' })
  ordinal: number;

  @Column({ nullable: false, type: 'varchar' })
  type: InconnectMessagingAttachmentType;

  @Column({ nullable: false, type: 'varchar' })
  ingestionState: InconnectMessagingAttachmentIngestionState;

  // The provider port owns this opaque locator. It is never returned by a DTO.
  @Column({ nullable: true, type: 'text' })
  providerMediaLocator: string | null;

  @Column({ nullable: true, type: 'varchar' })
  declaredMimeType: string | null;

  @Column({ nullable: false, type: 'text' })
  safeFilename: string;

  @Column({ nullable: true, type: 'uuid' })
  fileId: string | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_ATTACHMENT_FILE',
      name: 'fileId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  file: Relation<FileEntity> | null;

  @Column({ nullable: true, type: 'varchar' })
  mimeType: string | null;

  @Column({ nullable: true, type: 'bigint' })
  size: number | null;

  @Column({ nullable: true, type: 'uuid' })
  leaseToken: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  leaseExpiresAt: Date | null;

  @Column({ nullable: false, type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ nullable: true, type: 'varchar' })
  lastErrorCode: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  availableAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
