import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { of } from 'rxjs';

import {
  InconnectCommercialTeamCacheStatus,
  InconnectCommercialTeamMembershipType,
  type GetInconnectCommercialTeamAvailableMembersQuery,
  type GetInconnectCommercialTeamsQuery,
} from '~/generated-metadata/graphql';

const northTeamId = '11111111-1111-4111-8111-111111111111';
const southTeamId = '22222222-2222-4222-8222-222222222222';

const { COORDINATOR, EXECUTIVE } = InconnectCommercialTeamMembershipType;

type Membership = {
  id: string;
  teamId: string;
  type: InconnectCommercialTeamMembershipType;
};

const createMember = (
  displayName: string,
  email: string,
  type?: InconnectCommercialTeamMembershipType,
) => ({
  workspaceMemberId: crypto.randomUUID(),
  displayName,
  email,
  membership: type
    ? { id: crypto.randomUUID(), teamId: northTeamId, type }
    : (null as Membership | null),
});

const rejectOperation = (message: string) =>
  of({
    errors: [
      new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } }),
    ],
  });

export const createCommercialTeamsStoryClient = () => {
  const teams = new Map([
    [northTeamId, 'Equipo Norte'],
    [southTeamId, 'Equipo Sur'],
  ]);
  const members = [
    createMember('Lucía Prado', 'lucia@example.invalid', COORDINATOR),
    createMember('Mateo Ríos', 'mateo@example.invalid', EXECUTIVE),
    createMember('Valeria Luna', 'valeria@example.invalid', EXECUTIVE),
    createMember('Inés Vidal', 'ines@example.invalid'),
    createMember('Diego Solís', 'diego@example.invalid'),
  ];

  // This terminating link has no HTTP transport, including for unknown operations.
  const link = new ApolloLink(({ operationName, variables }) => {
    if (operationName === 'GetInconnectCommercialTeams') {
      const data: GetInconnectCommercialTeamsQuery = {
        getInconnectCommercialTeams: Array.from(teams, ([id, name]) => {
          const assigned = members.flatMap(({ membership, ...member }) =>
            membership?.teamId === id
              ? [
                  {
                    type: membership.type,
                    node: {
                      ...member,
                      __typename:
                        'InconnectCommercialTeamSettingsMember' as const,
                      membershipId: membership.id,
                      isAssignable: true,
                    },
                  },
                ]
              : [],
          );

          return {
            __typename: 'InconnectCommercialTeamSettingsTeam',
            id,
            name,
            coordinator:
              assigned.find(({ type }) => type === COORDINATOR)?.node ?? null,
            executives: assigned
              .filter(({ type }) => type === EXECUTIVE)
              .map(({ node }) => node),
          };
        }),
      };

      return of({ data });
    }

    if (operationName === 'GetInconnectCommercialTeamAvailableMembers') {
      const data: GetInconnectCommercialTeamAvailableMembersQuery = {
        getInconnectCommercialTeamAvailableMembers: members.map(
          ({ membership, ...member }) => ({
            ...member,
            __typename: 'InconnectCommercialTeamSettingsAvailableMember',
            currentTeamId: membership?.teamId ?? null,
            currentMembershipType: membership?.type ?? null,
          }),
        ),
      };

      return of({ data });
    }

    const input = variables.input as
      | {
          teamId?: string;
          targetTeamId?: string;
          workspaceMemberId?: string;
          name?: string;
        }
      | undefined;
    const teamId =
      operationName === 'CreateInconnectCommercialTeam'
        ? crypto.randomUUID()
        : (input?.teamId ?? input?.targetTeamId);
    const member = members.find(
      ({ workspaceMemberId }) => workspaceMemberId === input?.workspaceMemberId,
    );
    const name = input?.name?.trim();

    if (
      !teamId ||
      (operationName !== 'CreateInconnectCommercialTeam' && !teams.has(teamId))
    ) {
      return rejectOperation('Unknown commercial team operation or team.');
    }

    switch (operationName) {
      case 'CreateInconnectCommercialTeam':
      case 'RenameInconnectCommercialTeam':
        if (!name) return rejectOperation('A team name is required.');
        teams.set(teamId, name);
        break;
      case 'AssignInconnectCommercialTeamCoordinator': {
        if (
          !member ||
          (member.membership && member.membership.teamId !== teamId)
        ) {
          return rejectOperation(
            'The coordinator must be available for this team.',
          );
        }
        const coordinator = members.find(
          ({ membership }) =>
            membership?.teamId === teamId && membership.type === COORDINATOR,
        );
        if (coordinator?.membership) coordinator.membership.type = EXECUTIVE;
        member.membership = {
          id: member.membership?.id ?? crypto.randomUUID(),
          teamId,
          type: COORDINATOR,
        };
        break;
      }
      case 'AddInconnectCommercialTeamExecutive':
        if (!member || member.membership) {
          return rejectOperation('The executive must be unassigned.');
        }
        member.membership = {
          id: crypto.randomUUID(),
          teamId,
          type: EXECUTIVE,
        };
        break;
      case 'RemoveInconnectCommercialTeamExecutive':
        if (
          member?.membership?.teamId !== teamId ||
          member.membership.type !== EXECUTIVE
        ) {
          return rejectOperation('The executive must belong to this team.');
        }
        member.membership = null;
        break;
      case 'MoveInconnectCommercialTeamMember':
        if (member?.membership?.type !== EXECUTIVE) {
          return rejectOperation('Select an assigned executive to move.');
        }
        member.membership.teamId = teamId;
        break;
      case 'DeleteInconnectCommercialTeam':
        teams.delete(teamId);
        for (const candidate of members) {
          if (candidate.membership?.teamId === teamId)
            candidate.membership = null;
        }
        break;
      default:
        return rejectOperation(
          'This operation is outside the Commercial Teams demo.',
        );
    }

    const resultField =
      operationName.charAt(0).toLowerCase() + operationName.slice(1);

    return of({
      data: {
        [resultField]: {
          __typename: 'InconnectCommercialTeamSettingsMutationResult',
          teamId,
          membershipId: member?.membership?.id ?? null,
          cacheStatus: InconnectCommercialTeamCacheStatus.recomputed,
        },
      },
    });
  });

  return new ApolloClient({ cache: new InMemoryCache(), link });
};
