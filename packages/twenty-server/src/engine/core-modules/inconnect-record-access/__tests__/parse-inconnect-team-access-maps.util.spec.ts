import { InconnectCommercialTeamMembershipType } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-commercial-team-membership-type.type';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import {
  parseInconnectTeamAccessMaps,
  resolveInconnectTeamAccessMapsForAuthorization,
} from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';

const TEAM_ID = '00000000-0000-4000-8000-000000000101';
const MEMBER_ID = '00000000-0000-4000-8000-000000000201';

const validPayload: Extract<InconnectTeamAccessMaps, { status: 'valid' }> = {
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {
    [MEMBER_ID]: {
      teamId: TEAM_ID,
      membershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
      isWorkspaceMemberAssignable: true,
    },
  },
  memberWorkspaceMemberIdsByTeamId: { [TEAM_ID]: [MEMBER_ID] },
  assignableMemberWorkspaceMemberIdsByTeamId: { [TEAM_ID]: [MEMBER_ID] },
};

describe('parseInconnectTeamAccessMaps', () => {
  it('accepts a complete, versioned cache payload', () => {
    expect(parseInconnectTeamAccessMaps(validPayload)).toEqual(validPayload);
  });

  it.each([
    ['unknown status', { ...validPayload, status: 'unknown' }],
    [
      'missing field',
      {
        version: 1,
        status: 'valid',
        membershipByWorkspaceMemberId:
          validPayload.membershipByWorkspaceMemberId,
        memberWorkspaceMemberIdsByTeamId:
          validPayload.memberWorkspaceMemberIdsByTeamId,
      },
    ],
    [
      'invalid membership type',
      {
        ...validPayload,
        membershipByWorkspaceMemberId: {
          [MEMBER_ID]: {
            ...validPayload.membershipByWorkspaceMemberId[MEMBER_ID],
            membershipType: 'MANAGER',
          },
        },
      },
    ],
    [
      'malformed map',
      {
        ...validPayload,
        membershipByWorkspaceMemberId: [],
      },
    ],
    [
      'invalid array',
      {
        ...validPayload,
        memberWorkspaceMemberIdsByTeamId: { [TEAM_ID]: MEMBER_ID },
      },
    ],
    ['corrupt payload', 'not-an-object'],
    ['unknown version', { ...validPayload, version: 2 }],
  ])('fails closed for %s', (_name, payload) => {
    expect(parseInconnectTeamAccessMaps(payload)).toMatchObject({
      version: 1,
      status: 'invalid',
    });
  });

  it('fails closed when maps disagree about assignability', () => {
    expect(
      parseInconnectTeamAccessMaps({
        ...validPayload,
        assignableMemberWorkspaceMemberIdsByTeamId: { [TEAM_ID]: [] },
      }),
    ).toMatchObject({ status: 'invalid' });
  });

  it('exposes an exhaustive authorization contract for absent and invalid cache', () => {
    expect(resolveInconnectTeamAccessMapsForAuthorization(undefined)).toEqual({
      kind: 'denied',
      reason: 'absent',
    });
    expect(
      resolveInconnectTeamAccessMapsForAuthorization({
        version: 1,
        status: 'invalid',
        reason: 'recomputation failed',
        failureKind: 'recomputation-failed',
      }),
    ).toEqual({ kind: 'denied', reason: 'recomputation-failed' });
    expect(resolveInconnectTeamAccessMapsForAuthorization('corrupt')).toEqual({
      kind: 'denied',
      reason: 'corrupt',
    });
    expect(
      resolveInconnectTeamAccessMapsForAuthorization(validPayload),
    ).toMatchObject({ kind: 'available' });
  });
});
