import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { type InconnectRecordAccessOwnerRequirement } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';

@Entity({ name: 'inconnectRecordAccessManagedObject', schema: 'core' })
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OWNER_REQUIREMENT',
  "\"ownerRequirement\" IN ('required', 'optional')",
)
@Index(
  'IDX_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_ID_WORKSPACE_UNIQUE',
  ['id', 'workspaceId'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_RA_MANAGED_OBJECT_WORKSPACE_OBJECT_UNIQUE',
  ['workspaceId', 'objectMetadataId'],
  { unique: true },
)
export class InconnectRecordAccessManagedObjectEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @ManyToOne(
    () => InconnectRecordAccessConfigurationEntity,
    (configuration) => configuration.managedObjects,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({
    foreignKeyConstraintName:
      'FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_CONFIGURATION',
    name: 'workspaceId',
    referencedColumnName: 'workspaceId',
  })
  configuration: Relation<InconnectRecordAccessConfigurationEntity>;

  @Column({ nullable: false, type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne(() => ObjectMetadataEntity, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName:
        'FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OBJECT_METADATA',
      name: 'objectMetadataId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  objectMetadata: Relation<ObjectMetadataEntity>;

  @Column({ nullable: false, type: 'uuid' })
  ownerFieldMetadataId: string;

  @ManyToOne(() => FieldMetadataEntity, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName:
        'FK_INCONNECT_RECORD_ACCESS_MANAGED_OBJECT_OWNER_FIELD',
      name: 'ownerFieldMetadataId',
      referencedColumnName: 'id',
    },
    { name: 'objectMetadataId', referencedColumnName: 'objectMetadataId' },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  ownerFieldMetadata: Relation<FieldMetadataEntity>;

  @Column({ nullable: false, type: 'varchar' })
  ownerRequirement: InconnectRecordAccessOwnerRequirement;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(
    () => InconnectRecordAccessPolicyEntity,
    (policy) => policy.managedObject,
  )
  policies: Relation<InconnectRecordAccessPolicyEntity[]>;
}
