import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { InconnectCommercialTeamEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team.entity';
import { type InconnectCommercialTeamMembershipType as InconnectCommercialTeamMembershipTypeValue } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity';

@Entity({ name: 'inconnectCommercialTeamMembership', schema: 'core' })
@Check(
  'CHK_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_TYPE',
  `"membershipType" IN ('COORDINATOR', 'EXECUTIVE')`,
)
@Index('IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_WORKSPACE_ID', ['workspaceId'])
@Index('IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_TEAM_ID', ['teamId'])
@Index('IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_MEMBER_ID', [
  'workspaceMemberId',
])
@Index(
  'IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_MEMBER_UNIQUE',
  ['workspaceId', 'workspaceMemberId'],
  { unique: true, where: '"deletedAt" IS NULL' },
)
@Index(
  'IDX_INCONNECT_COMMERCIAL_TEAM_MEMBERSHIP_ACTIVE_COORDINATOR_UNIQUE',
  ['teamId'],
  {
    unique: true,
    where: `"deletedAt" IS NULL AND "membershipType" = 'COORDINATOR'`,
  },
)
export class InconnectCommercialTeamMembershipEntity extends WorkspaceRelatedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  teamId: string;

  @ManyToOne(() => InconnectCommercialTeamEntity, (team) => team.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    { name: 'teamId', referencedColumnName: 'id' },
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
  ])
  team: Relation<InconnectCommercialTeamEntity>;

  @Column({ nullable: false, type: 'uuid' })
  workspaceMemberId: string;

  @Column({ nullable: false, type: 'varchar' })
  membershipType: InconnectCommercialTeamMembershipTypeValue;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true, type: 'timestamptz' })
  deletedAt: Date | null;
}
