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

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';

@Entity({ name: 'inconnectMessagingConfiguration', schema: 'core' })
@Check('CHK_INCONNECT_MSG_CONFIG_REVISION', '"revision" >= 0')
@Index(
  'IDX_INCONNECT_MSG_CONFIG_WORKSPACE_ANCHOR_UNIQUE',
  ['workspaceId', 'anchorObjectMetadataId'],
  { unique: true },
)
export class InconnectMessagingConfigurationEntity {
  @PrimaryColumn({
    primaryKeyConstraintName: 'PK_INCONNECT_MSG_CONFIG',
    type: 'uuid',
  })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONFIG_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'uuid' })
  anchorObjectMetadataId: string;

  @ManyToOne(() => ObjectMetadataEntity, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONFIG_ANCHOR',
      name: 'anchorObjectMetadataId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  anchorObjectMetadata: Relation<ObjectMetadataEntity>;

  @Column({ default: 0, nullable: false, type: 'bigint' })
  revision: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
