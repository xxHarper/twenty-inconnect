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
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { InconnectMessagingConfigurationEntity } from 'src/modules/inconnect-messaging/entities/messaging-configuration.entity';

@Entity({ name: 'inconnectMessagingContextField', schema: 'core' })
@Check('CHK_INCONNECT_MSG_CONTEXT_FIELD_ORDINAL', '"ordinal" >= 0')
@Index(
  'IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_FIELD_UNIQUE',
  ['workspaceId', 'fieldMetadataId'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE_ORDINAL_UNIQUE',
  ['workspaceId', 'ordinal'],
  { unique: true },
)
@Index('IDX_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE', ['workspaceId'])
export class InconnectMessagingContextFieldEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_CONTEXT_FIELD',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONTEXT_FIELD_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne(() => InconnectMessagingConfigurationEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONTEXT_FIELD_CONFIG_ANCHOR',
      name: 'workspaceId',
      referencedColumnName: 'workspaceId',
    },
    {
      name: 'objectMetadataId',
      referencedColumnName: 'anchorObjectMetadataId',
    },
  ])
  messagingConfiguration: Relation<InconnectMessagingConfigurationEntity>;

  @Column({ nullable: false, type: 'uuid' })
  fieldMetadataId: string;

  @ManyToOne(() => FieldMetadataEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONTEXT_FIELD_METADATA',
      name: 'fieldMetadataId',
      referencedColumnName: 'id',
    },
    { name: 'objectMetadataId', referencedColumnName: 'objectMetadataId' },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  fieldMetadata: Relation<FieldMetadataEntity>;

  @Column({ nullable: false, type: 'integer' })
  ordinal: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
