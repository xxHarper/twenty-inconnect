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

import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import {
  type InconnectRecordAccessCreatePolicy,
  type InconnectRecordAccessMissingOwnerPolicy,
  type InconnectRecordAccessOwnerTransferPolicy,
  type InconnectRecordAccessRecordEffect,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-config.type';
import { type InconnectRecordAccessPrincipalType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-persistence.type';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

@Entity({ name: 'inconnectRecordAccessPolicy', schema: 'core' })
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_PRINCIPAL_TYPE',
  `"principalType" = 'WORKSPACE_MEMBER'`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_RECORD_EFFECT',
  `"recordEffect" IN ('ownRecords', 'ownAndTeamRecords', 'allRecords')`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_CREATE_POLICY',
  `"createPolicy" IN ('denied', 'defaultOwner', 'assignableOwners', 'standardPermissionsOnly')`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_OWNER_TRANSFER_POLICY',
  `"ownerTransferPolicy" IN ('denied', 'assignableOwners', 'standardPermissionsOnly')`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_MISSING_OWNER_POLICY',
  `"missingOwnerPolicy" IN ('self', 'requireExplicit', 'singleActiveMemberOfRole', 'standard')`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE',
  `("missingOwnerPolicy" = 'singleActiveMemberOfRole') = ("defaultOwnerRoleId" IS NOT NULL)`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_DENIED_CREATE',
  `"createPolicy" <> 'denied' OR "missingOwnerPolicy" = 'requireExplicit'`,
)
@Check(
  'CHK_INCONNECT_RECORD_ACCESS_POLICY_SCOPED_CREATE',
  `"createPolicy" NOT IN ('defaultOwner', 'assignableOwners') OR "missingOwnerPolicy" = 'self'`,
)
@Index('IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_ROLE', [
  'workspaceId',
  'roleId',
])
@Index(
  'IDX_INCONNECT_RECORD_ACCESS_POLICY_WORKSPACE_DEFAULT_OWNER_ROLE',
  ['workspaceId', 'defaultOwnerRoleId'],
  { where: '"defaultOwnerRoleId" IS NOT NULL' },
)
@Index(
  'IDX_INCONNECT_RA_POLICY_WORKSPACE_MANAGED_OBJECT_ROLE_UNIQUE',
  ['workspaceId', 'managedObjectId', 'roleId'],
  { unique: true },
)
export class InconnectRecordAccessPolicyEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_INCONNECT_RECORD_ACCESS_POLICY',
  })
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @Column({ nullable: false, type: 'uuid' })
  managedObjectId: string;

  @ManyToOne(
    () => InconnectRecordAccessManagedObjectEntity,
    (managedObject) => managedObject.policies,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn([
    {
      foreignKeyConstraintName:
        'FK_INCONNECT_RECORD_ACCESS_POLICY_MANAGED_OBJECT',
      name: 'managedObjectId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  managedObject: Relation<InconnectRecordAccessManagedObjectEntity>;

  @Column({ nullable: false, type: 'uuid' })
  roleId: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName: 'FK_INCONNECT_RECORD_ACCESS_POLICY_ROLE',
      name: 'roleId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  role: Relation<RoleEntity>;

  @Column({ nullable: false, type: 'varchar' })
  principalType: InconnectRecordAccessPrincipalType;

  @Column({ nullable: false, type: 'varchar' })
  recordEffect: InconnectRecordAccessRecordEffect;

  @Column({ nullable: false, type: 'varchar' })
  createPolicy: InconnectRecordAccessCreatePolicy;

  @Column({ nullable: false, type: 'varchar' })
  ownerTransferPolicy: InconnectRecordAccessOwnerTransferPolicy;

  @Column({ nullable: false, type: 'varchar' })
  missingOwnerPolicy: InconnectRecordAccessMissingOwnerPolicy;

  @Column({ nullable: true, type: 'uuid' })
  defaultOwnerRoleId: string | null;

  @ManyToOne(() => RoleEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      foreignKeyConstraintName:
        'FK_INCONNECT_RECORD_ACCESS_POLICY_DEFAULT_OWNER_ROLE',
      name: 'defaultOwnerRoleId',
      referencedColumnName: 'id',
    },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  defaultOwnerRole: Relation<RoleEntity> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
