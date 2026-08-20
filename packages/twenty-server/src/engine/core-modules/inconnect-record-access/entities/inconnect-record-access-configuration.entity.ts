import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { type InconnectRecordAccessEnforcementMode } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'inconnectRecordAccessConfiguration', schema: 'core' })
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_CONFIGURATION_ENFORCEMENT_MODE',
  `"enforcementMode" IN ('MANAGED', 'UNMANAGED')`,
)
@Check('CHK_INCONNECT_RECORD_ACCESS_CONFIGURATION_REVISION', `"revision" >= 0`)
export class InconnectRecordAccessConfigurationEntity {
  @PrimaryColumn({
    primaryKeyConstraintName: 'PK_INCONNECT_RECORD_ACCESS_CONFIGURATION',
    type: 'uuid',
  })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    foreignKeyConstraintName:
      'FK_INCONNECT_RECORD_ACCESS_CONFIGURATION_WORKSPACE',
    name: 'workspaceId',
  })
  workspace: Relation<WorkspaceEntity>;

  @Column({ nullable: false, type: 'varchar' })
  enforcementMode: InconnectRecordAccessEnforcementMode;

  // PostgreSQL bigint values are returned as strings by the driver. Keeping the
  // string avoids precision loss when this revision eventually exceeds 2^53.
  @Column({ default: 0, nullable: false, type: 'bigint' })
  revision: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(
    () => InconnectRecordAccessManagedObjectEntity,
    (managedObject) => managedObject.configuration,
  )
  managedObjects: Relation<InconnectRecordAccessManagedObjectEntity[]>;
}
