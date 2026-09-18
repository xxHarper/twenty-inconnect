import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InconnectMessagingMessageEntity } from 'src/modules/inconnect-messaging/entities/message.entity';
import { type InconnectMessagingAttachmentType } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type InconnectMessagingOutboundUploadState =
  | 'CREATING'
  | 'PENDING'
  | 'AVAILABLE'
  | 'CONSUMED';

@Entity({ name: 'inconnectMessagingOutboundUpload', schema: 'core' })
@Check(
  'CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_TYPE',
  `"type" IN ('IMAGE', 'STICKER', 'AUDIO', 'VIDEO', 'DOCUMENT', 'CONTACT')`,
)
@Check(
  'CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_STATE',
  `"state" IN ('CREATING', 'PENDING', 'AVAILABLE', 'CONSUMED')`,
)
@Check(
  'CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE',
  `("state" = 'CREATING' AND "fileId" IS NULL) OR ("state" <> 'CREATING' AND "fileId" IS NOT NULL)`,
)
@Check(
  'CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_AVAILABLE',
  `("state" IN ('AVAILABLE', 'CONSUMED') AND "mimeType" IS NOT NULL AND "contentFingerprint" IS NOT NULL AND "completedAt" IS NOT NULL) OR ("state" IN ('CREATING', 'PENDING') AND "mimeType" IS NULL AND "contentFingerprint" IS NULL AND "completedAt" IS NULL)`,
)
@Check(
  'CHK_INCONNECT_MSG_OUTBOUND_UPLOAD_CONSUMED',
  `("state" = 'CONSUMED' AND "consumedByMessageId" IS NOT NULL AND "consumedAt" IS NOT NULL) OR ("state" <> 'CONSUMED' AND "consumedByMessageId" IS NULL AND "consumedAt" IS NULL)`,
)
@Index(
  'IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_CLIENT_UNIQUE',
  ['workspaceId', 'workspaceMemberId', 'clientUploadId'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE_UNIQUE', ['fileId'], {
  unique: true,
  where: '"fileId" IS NOT NULL',
})
@Index('IDX_INCONNECT_MSG_OUTBOUND_UPLOAD_EXPIRY', ['state', 'expiresAt'])
export class InconnectMessagingOutboundUploadEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_OUTBOUND_UPLOAD_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  workspaceMemberId: string;

  @Column({ nullable: false, type: 'uuid' })
  clientUploadId: string;

  @Column({ nullable: false, type: 'varchar' })
  state: InconnectMessagingOutboundUploadState;

  @Column({ nullable: false, type: 'varchar' })
  type: InconnectMessagingAttachmentType;

  @Column({ nullable: false, type: 'text' })
  safeFilename: string;

  @Column({ nullable: false, type: 'bigint' })
  size: number;

  @Column({ nullable: true, type: 'uuid' })
  fileId: string | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_OUTBOUND_UPLOAD_FILE',
      name: 'fileId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  file: Relation<FileEntity> | null;

  @Column({ nullable: true, type: 'varchar' })
  mimeType: string | null;

  @Column({ nullable: true, type: 'text' })
  contentFingerprint: string | null;

  @Column({ nullable: false, type: 'text' })
  requestFingerprint: string;

  @Column({ nullable: false, type: 'timestamptz' })
  expiresAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  completedAt: Date | null;

  @Column({ nullable: true, type: 'uuid' })
  consumedByMessageId: string | null;

  @ManyToOne(() => InconnectMessagingMessageEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName:
        'FK_INCONNECT_MSG_OUTBOUND_UPLOAD_CONSUMED_MESSAGE',
      name: 'consumedByMessageId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  consumedByMessage: Relation<InconnectMessagingMessageEntity> | null;

  @Column({ nullable: true, type: 'timestamptz' })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
