import { registerEnumType } from '@nestjs/graphql';

import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';

export const InconnectCommercialTeamMembershipTypeGraphql =
  InconnectCommercialTeamMembershipType;

export const InconnectCommercialTeamCacheStatusGraphql = {
  recomputed: 'recomputed',
  recomputationFailed: 'recomputation-failed',
} as const;

registerEnumType(InconnectCommercialTeamMembershipTypeGraphql, {
  name: 'InconnectCommercialTeamMembershipType',
});

registerEnumType(InconnectCommercialTeamCacheStatusGraphql, {
  name: 'InconnectCommercialTeamCacheStatus',
});
