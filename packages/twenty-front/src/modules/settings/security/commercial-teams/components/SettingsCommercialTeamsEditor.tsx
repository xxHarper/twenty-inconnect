import { styled } from '@linaria/react';
import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { SettingsCommercialTeamCard } from '@/settings/security/commercial-teams/components/SettingsCommercialTeamCard';
import { SettingsCommercialTeamNameModal } from '@/settings/security/commercial-teams/components/SettingsCommercialTeamNameModal';
import { SettingsCommercialTeamSelectionModal } from '@/settings/security/commercial-teams/components/SettingsCommercialTeamSelectionModal';
import { useInconnectCommercialTeamMutations } from '@/settings/security/commercial-teams/hooks/useInconnectCommercialTeamMutations';
import type {
  InconnectCommercialTeamSettingsAvailableMember,
  InconnectCommercialTeamSettingsMember,
  InconnectCommercialTeamSettingsTeam,
} from '@/settings/security/commercial-teams/types/InconnectCommercialTeamSettings';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { Callout } from 'twenty-ui/feedback';
import { IconHierarchy2, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const CREATE_TEAM_MODAL_ID = 'inconnect-commercial-team-create';
const RENAME_TEAM_MODAL_ID = 'inconnect-commercial-team-rename';
const MEMBER_MODAL_ID = 'inconnect-commercial-team-member';
const REMOVE_EXECUTIVE_MODAL_ID = 'inconnect-commercial-team-remove-executive';
const DELETE_TEAM_MODAL_ID = 'inconnect-commercial-team-delete';

const StyledTeams = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledCreateAction = styled.div`
  margin-top: ${themeCssVariables.spacing[4]};
`;

type TeamNameAction =
  | { kind: 'create' }
  | { kind: 'rename'; team: InconnectCommercialTeamSettingsTeam };

type MemberAction =
  | { kind: 'assign-coordinator'; team: InconnectCommercialTeamSettingsTeam }
  | { kind: 'add-executive'; team: InconnectCommercialTeamSettingsTeam }
  | {
      kind: 'move-executive';
      team: InconnectCommercialTeamSettingsTeam;
      member: InconnectCommercialTeamSettingsMember;
    };

type SettingsCommercialTeamsEditorProps = {
  teams: InconnectCommercialTeamSettingsTeam[];
  availableMembers: InconnectCommercialTeamSettingsAvailableMember[];
  refetchReadModels: () => Promise<void>;
};

const getMemberLabel = (
  member: InconnectCommercialTeamSettingsAvailableMember,
) =>
  member.email ? `${member.displayName} (${member.email})` : member.displayName;

export const SettingsCommercialTeamsEditor = ({
  teams,
  availableMembers,
  refetchReadModels,
}: SettingsCommercialTeamsEditorProps) => {
  const { t } = useLingui();
  const { openModal } = useModal();
  const mutations = useInconnectCommercialTeamMutations({
    refetchReadModels,
  });
  const [teamNameAction, setTeamNameAction] = useState<TeamNameAction | null>(
    null,
  );
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null);
  const [executiveToRemove, setExecutiveToRemove] = useState<{
    team: InconnectCommercialTeamSettingsTeam;
    member: InconnectCommercialTeamSettingsMember;
  } | null>(null);
  const [teamToDelete, setTeamToDelete] =
    useState<InconnectCommercialTeamSettingsTeam | null>(null);

  const openTeamNameModal = (action: TeamNameAction) => {
    setTeamNameAction(action);
    openModal(
      action.kind === 'create' ? CREATE_TEAM_MODAL_ID : RENAME_TEAM_MODAL_ID,
    );
  };

  const openMemberModal = (action: MemberAction) => {
    setMemberAction(action);
    openModal(MEMBER_MODAL_ID);
  };

  const memberOptions =
    memberAction?.kind === 'move-executive'
      ? teams
          .filter((team) => team.id !== memberAction.team.id)
          .map((team) => ({ label: team.name, value: team.id }))
      : memberAction?.kind === 'assign-coordinator'
        ? availableMembers
            .filter(
              (member) =>
                member.workspaceMemberId !==
                  memberAction.team.coordinator?.workspaceMemberId &&
                (member.currentTeamId === null ||
                  member.currentTeamId === memberAction.team.id),
            )
            .map((member) => ({
              label: getMemberLabel(member),
              value: member.workspaceMemberId,
            }))
        : memberAction?.kind === 'add-executive'
          ? availableMembers
              .filter((member) => member.currentTeamId === null)
              .map((member) => ({
                label: getMemberLabel(member),
                value: member.workspaceMemberId,
              }))
          : [];

  const memberModalCopy =
    memberAction?.kind === 'assign-coordinator'
      ? {
          title: memberAction.team.coordinator
            ? t`Change coordinator`
            : t`Assign coordinator`,
          description: memberAction.team.coordinator
            ? t`The current coordinator will become an executive in this team. Members assigned to another team must be moved or removed first.`
            : t`Members assigned to another team must be moved or removed first.`,
          selectLabel: t`Workspace member`,
          confirmLabel: t`Assign coordinator`,
          emptyLabel: t`Select a member`,
        }
      : memberAction?.kind === 'add-executive'
        ? {
            title: t`Add executive`,
            description: t`Only unassigned workspace members can be added directly to this team.`,
            selectLabel: t`Workspace member`,
            confirmLabel: t`Add executive`,
            emptyLabel: t`Select a member`,
          }
        : {
            title: t`Move executive`,
            description: memberAction
              ? t`Move ${memberAction.member.displayName} to another commercial team. This move is atomic.`
              : '',
            selectLabel: t`Destination team`,
            confirmLabel: t`Move executive`,
            emptyLabel: t`Select a team`,
          };

  const submitMemberAction = (value: string) => {
    if (!memberAction) {
      return Promise.resolve(false);
    }

    if (memberAction.kind === 'assign-coordinator') {
      return mutations.assignCoordinator(memberAction.team.id, value);
    }

    if (memberAction.kind === 'add-executive') {
      return mutations.addExecutive(memberAction.team.id, value);
    }

    return mutations.moveExecutive(
      memberAction.member.workspaceMemberId,
      value,
    );
  };

  return (
    <>
      {teams.length === 0 ? (
        <Callout
          variant="neutral"
          Icon={IconHierarchy2}
          title={t`No commercial teams yet`}
          description={t`Create a commercial team to organize workspace members for team-based record access.`}
          action={{
            label: t`Create team`,
            onClick: () => openTeamNameModal({ kind: 'create' }),
          }}
        />
      ) : (
        <StyledTeams>
          {teams.map((team) => (
            <SettingsCommercialTeamCard
              key={team.id}
              team={team}
              onRename={() => openTeamNameModal({ kind: 'rename', team })}
              onDelete={() => {
                setTeamToDelete(team);
                openModal(DELETE_TEAM_MODAL_ID);
              }}
              onAssignCoordinator={() =>
                openMemberModal({ kind: 'assign-coordinator', team })
              }
              onAddExecutive={() =>
                openMemberModal({ kind: 'add-executive', team })
              }
              onMoveExecutive={(member) =>
                openMemberModal({ kind: 'move-executive', team, member })
              }
              onRemoveExecutive={(member) => {
                setExecutiveToRemove({ team, member });
                openModal(REMOVE_EXECUTIVE_MODAL_ID);
              }}
            />
          ))}
        </StyledTeams>
      )}

      {teams.length > 0 && (
        <StyledCreateAction>
          <Button
            title={t`Create team`}
            Icon={IconPlus}
            variant="secondary"
            onClick={() => openTeamNameModal({ kind: 'create' })}
          />
        </StyledCreateAction>
      )}

      <SettingsCommercialTeamNameModal
        modalInstanceId={CREATE_TEAM_MODAL_ID}
        title={t`Create commercial team`}
        confirmLabel={t`Create team`}
        isLoading={mutations.isLoading}
        onSubmit={mutations.createTeam}
        onClose={() => setTeamNameAction(null)}
      />

      <SettingsCommercialTeamNameModal
        modalInstanceId={RENAME_TEAM_MODAL_ID}
        title={t`Rename commercial team`}
        confirmLabel={t`Rename team`}
        initialName={
          teamNameAction?.kind === 'rename' ? teamNameAction.team.name : ''
        }
        isLoading={mutations.isLoading}
        onSubmit={(name) =>
          teamNameAction?.kind === 'rename'
            ? mutations.renameTeam(teamNameAction.team.id, name)
            : Promise.resolve(false)
        }
        onClose={() => setTeamNameAction(null)}
      />

      <SettingsCommercialTeamSelectionModal
        modalInstanceId={MEMBER_MODAL_ID}
        title={memberModalCopy.title}
        description={memberModalCopy.description}
        selectLabel={memberModalCopy.selectLabel}
        confirmLabel={memberModalCopy.confirmLabel}
        emptyLabel={memberModalCopy.emptyLabel}
        options={memberOptions}
        isLoading={mutations.isLoading}
        onSubmit={submitMemberAction}
        onClose={() => setMemberAction(null)}
      />

      <ConfirmationModal
        modalInstanceId={REMOVE_EXECUTIVE_MODAL_ID}
        title={t`Remove executive from team?`}
        subtitle={t`Remove ${executiveToRemove?.member.displayName ?? 'this member'} from the commercial team? This does not remove the workspace member or change their role.`}
        confirmButtonText={t`Remove executive`}
        loading={mutations.isLoading}
        onConfirmClick={() => {
          if (executiveToRemove) {
            void mutations.removeExecutive(
              executiveToRemove.team.id,
              executiveToRemove.member.workspaceMemberId,
            );
          }
        }}
        onClose={() => setExecutiveToRemove(null)}
      />

      <ConfirmationModal
        modalInstanceId={DELETE_TEAM_MODAL_ID}
        title={t`Delete commercial team?`}
        subtitle={t`Deleting ${teamToDelete?.name ?? 'this team'} removes its active commercial team memberships. Workspace members and roles are not deleted.`}
        confirmButtonText={t`Delete team`}
        confirmationValue={teamToDelete?.name}
        confirmationPlaceholder={teamToDelete?.name}
        loading={mutations.isLoading}
        onConfirmClick={() => {
          if (teamToDelete) {
            void mutations.deleteTeam(teamToDelete.id);
          }
        }}
        onClose={() => setTeamToDelete(null)}
      />
    </>
  );
};
