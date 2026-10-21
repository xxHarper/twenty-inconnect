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
import { WasIntroducedInUpgrade } from 'src/engine/core-modules/upgrade/decorators/was-introduced-in-upgrade.decorator';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';
import {
  type InconnectMessagingAutoCreateLabelPolicy,
  type InconnectMessagingAutoCreateOwnerStrategy,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

@Entity({ name: 'inconnectMessagingConfiguration', schema: 'core' })
@Check(
  'CHK_IM_AT_CONFIG_GATE',
  `"attentionTrackingMode" IN ('DISABLED','PREPARING','ENABLED','SUSPENDED') AND ("attentionWriterProtocolVersion" IS NULL OR "attentionWriterProtocolVersion" > 0) AND ("attentionTrackingMode" <> 'ENABLED' OR ("attentionWriterProtocolVersion" IS NOT NULL AND "attentionWriterProtocolVersion" = 1))`,
)
@Check('CHK_INCONNECT_MSG_CONFIG_REVISION', '"revision" >= 0')
@Check(
  'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_OWNER_STRATEGY',
  `"autoCreateOwnerStrategy" IS NULL OR "autoCreateOwnerStrategy" = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE'`,
)
@Check(
  'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_LABEL_POLICY',
  `"autoCreateLabelPolicy" IS NULL OR "autoCreateLabelPolicy" = 'OMIT'`,
)
@Check(
  'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_TUPLE',
  `(
    "autoCreateEnabled" = false
    AND "autoCreateAnchorObjectMetadataId" IS NULL
    AND "autoCreateOwnerStrategy" IS NULL
    AND "autoCreateOwnerRoleId" IS NULL
    AND "autoCreateLabelPolicy" IS NULL
  ) OR (
    "autoCreateAnchorObjectMetadataId" IS NOT NULL
    AND "autoCreateOwnerStrategy" IS NOT NULL
    AND "autoCreateOwnerRoleId" IS NOT NULL
    AND "autoCreateLabelPolicy" IS NOT NULL
  )`,
)
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

  @Column({ default: false, nullable: false, type: 'boolean' })
  autoCreateEnabled: boolean;

  @Column({ nullable: true, type: 'uuid' })
  autoCreateAnchorObjectMetadataId: string | null;

  @ManyToOne(() => ObjectMetadataEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ANCHOR',
      name: 'autoCreateAnchorObjectMetadataId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  autoCreateAnchorObjectMetadata: Relation<ObjectMetadataEntity> | null;

  @Column({ nullable: true, type: 'varchar' })
  autoCreateOwnerStrategy: InconnectMessagingAutoCreateOwnerStrategy | null;

  @Column({ nullable: true, type: 'uuid' })
  autoCreateOwnerRoleId: string | null;

  @ManyToOne(() => RoleEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ROLE',
      name: 'autoCreateOwnerRoleId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  autoCreateOwnerRole: Relation<RoleEntity> | null;

  @Column({ nullable: true, type: 'varchar' })
  autoCreateLabelPolicy: InconnectMessagingAutoCreateLabelPolicy | null;

  @Column({ nullable: true, type: 'uuid' })
  automationUserWorkspaceId: string | null;

  @ManyToOne(() => UserWorkspaceEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    foreignKeyConstraintName:
      'FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE',
    name: 'automationUserWorkspaceId',
  })
  automationUserWorkspace: Relation<UserWorkspaceEntity> | null;

  @Column({
    default: () => 'CURRENT_TIMESTAMP',
    nullable: false,
    type: 'timestamptz',
  })
  workStateTrackingBaselineAt: Date;

  // DISABLED is a DDL default only: TypeORM returns mapped defaults on INSERT,
  // even for insert:false columns. Keep legacy INSERT free of the new column.
  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'varchar',
    nullable: false,
    select: false,
    insert: false,
    update: false,
  })
  attentionTrackingMode: 'DISABLED' | 'PREPARING' | 'ENABLED' | 'SUSPENDED';

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'integer',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  attentionWriterProtocolVersion: number | null;

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      '2.32.0_CreateInconnectMessagingAttentionLedgerFastInstanceCommand_1792540800000',
  })
  @Column({
    type: 'timestamptz',
    precision: 6,
    transformer: ATTENTION_EXACT_TIMESTAMP,
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  attentionGateUpdatedAt: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
