import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType('CreateInconnectCommercialTeamInput')
export class CreateInconnectCommercialTeamInputDTO {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  name: string;
}

@InputType('RenameInconnectCommercialTeamInput')
export class RenameInconnectCommercialTeamInputDTO extends CreateInconnectCommercialTeamInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  teamId: string;
}

@InputType('InconnectCommercialTeamMembershipInput')
export class InconnectCommercialTeamMembershipInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  teamId: string;

  @Field(() => UUIDScalarType)
  @IsUUID()
  workspaceMemberId: string;
}

@InputType('MoveInconnectCommercialTeamMemberInput')
export class MoveInconnectCommercialTeamMemberInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  workspaceMemberId: string;

  @Field(() => UUIDScalarType)
  @IsUUID()
  targetTeamId: string;
}

@InputType('DeleteInconnectCommercialTeamInput')
export class DeleteInconnectCommercialTeamInputDTO {
  @Field(() => UUIDScalarType)
  @IsUUID()
  teamId: string;
}
