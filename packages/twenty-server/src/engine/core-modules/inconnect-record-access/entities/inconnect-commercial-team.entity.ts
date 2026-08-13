import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { InconnectCommercialTeamMembershipEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-commercial-team-membership.entity';
import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity';

@Entity({ name: 'inconnectCommercialTeam', schema: 'core' })
@Check('CHK_INCONNECT_COMMERCIAL_TEAM_NORMALIZED_NAME', `btrim("name") <> ''`)
@Index('IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_ID', ['workspaceId'])
@Index(
  'IDX_INCONNECT_COMMERCIAL_TEAM_ID_WORKSPACE_ID_UNIQUE',
  ['id', 'workspaceId'],
  { unique: true },
)
@Index(
  'IDX_INCONNECT_COMMERCIAL_TEAM_WORKSPACE_NORMALIZED_NAME_UNIQUE',
  ['workspaceId', 'normalizedName'],
  { unique: true, where: '"deletedAt" IS NULL' },
)
export class InconnectCommercialTeamEntity extends WorkspaceRelatedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'text' })
  name: string;

  @Column({
    type: 'text',
    asExpression: 'lower(btrim("name"))',
    generatedType: 'STORED',
  })
  normalizedName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true, type: 'timestamptz' })
  deletedAt: Date | null;

  @OneToMany(
    () => InconnectCommercialTeamMembershipEntity,
    (membership) => membership.team,
  )
  memberships: Relation<InconnectCommercialTeamMembershipEntity[]>;
}
