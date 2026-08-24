import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  InconnectCommercialTeamCacheStatusGraphql,
  InconnectCommercialTeamMembershipTypeGraphql,
} from 'src/engine/core-modules/inconnect-record-access/dtos/inconnect-commercial-team-settings-graphql-enums';
import {
  type InconnectCommercialTeamCacheStatus,
  type InconnectCommercialTeamSettingsAvailableMember,
  type InconnectCommercialTeamSettingsMember,
  type InconnectCommercialTeamSettingsMutationResult,
  type InconnectCommercialTeamSettingsTeam,
} from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-settings.type';
import { type InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

@ObjectType('InconnectCommercialTeamSettingsMember')
export class InconnectCommercialTeamSettingsMemberDTO implements InconnectCommercialTeamSettingsMember {
  @Field(() => UUIDScalarType)
  membershipId: string;

  @Field(() => UUIDScalarType)
  workspaceMemberId: string;

  @Field(() => String)
  displayName: string;

  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => Boolean)
  isAssignable: boolean;
}

@ObjectType('InconnectCommercialTeamSettingsTeam')
export class InconnectCommercialTeamSettingsTeamDTO implements InconnectCommercialTeamSettingsTeam {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => InconnectCommercialTeamSettingsMemberDTO, { nullable: true })
  coordinator: InconnectCommercialTeamSettingsMemberDTO | null;

  @Field(() => [InconnectCommercialTeamSettingsMemberDTO])
  executives: InconnectCommercialTeamSettingsMemberDTO[];
}

@ObjectType('InconnectCommercialTeamSettingsAvailableMember')
export class InconnectCommercialTeamSettingsAvailableMemberDTO implements InconnectCommercialTeamSettingsAvailableMember {
  @Field(() => UUIDScalarType)
  workspaceMemberId: string;

  @Field(() => String)
  displayName: string;

  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  currentTeamId: string | null;

  @Field(() => InconnectCommercialTeamMembershipTypeGraphql, {
    nullable: true,
  })
  currentMembershipType: InconnectCommercialTeamMembershipType | null;
}

@ObjectType('InconnectCommercialTeamSettingsMutationResult')
export class InconnectCommercialTeamSettingsMutationResultDTO implements InconnectCommercialTeamSettingsMutationResult {
  @Field(() => UUIDScalarType)
  teamId: string;

  @Field(() => UUIDScalarType, { nullable: true })
  membershipId: string | null;

  @Field(() => InconnectCommercialTeamCacheStatusGraphql)
  cacheStatus: InconnectCommercialTeamCacheStatus;
}
