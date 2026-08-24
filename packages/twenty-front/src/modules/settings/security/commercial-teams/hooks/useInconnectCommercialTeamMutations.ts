import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useMutation } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';

import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import {
  AddInconnectCommercialTeamExecutiveDocument,
  AssignInconnectCommercialTeamCoordinatorDocument,
  CreateInconnectCommercialTeamDocument,
  DeleteInconnectCommercialTeamDocument,
  InconnectCommercialTeamCacheStatus,
  MoveInconnectCommercialTeamMemberDocument,
  RemoveInconnectCommercialTeamExecutiveDocument,
  RenameInconnectCommercialTeamDocument,
  type InconnectCommercialTeamSettingsMutationResult,
} from '~/generated-metadata/graphql';

type UseInconnectCommercialTeamMutationsProps = {
  refetchReadModels: () => Promise<void>;
};

const getGraphQLErrorCode = (error: unknown) =>
  CombinedGraphQLErrors.is(error)
    ? error.errors[0]?.extensions?.code
    : undefined;

export const useInconnectCommercialTeamMutations = ({
  refetchReadModels,
}: UseInconnectCommercialTeamMutationsProps) => {
  const { t } = useLingui();
  const {
    enqueueErrorSnackBar,
    enqueueSuccessSnackBar,
    enqueueWarningSnackBar,
  } = useSnackBar();

  const [createTeam, createState] = useMutation(
    CreateInconnectCommercialTeamDocument,
  );
  const [renameTeam, renameState] = useMutation(
    RenameInconnectCommercialTeamDocument,
  );
  const [assignCoordinator, assignCoordinatorState] = useMutation(
    AssignInconnectCommercialTeamCoordinatorDocument,
  );
  const [addExecutive, addExecutiveState] = useMutation(
    AddInconnectCommercialTeamExecutiveDocument,
  );
  const [removeExecutive, removeExecutiveState] = useMutation(
    RemoveInconnectCommercialTeamExecutiveDocument,
  );
  const [moveMember, moveMemberState] = useMutation(
    MoveInconnectCommercialTeamMemberDocument,
  );
  const [deleteTeam, deleteState] = useMutation(
    DeleteInconnectCommercialTeamDocument,
  );

  const refetchReadModelsSafely = async () => {
    try {
      await refetchReadModels();
    } catch {
      enqueueWarningSnackBar({
        message: t`The change was saved, but the latest commercial team state could not be reloaded. Reload the page before editing again.`,
      });
    }
  };

  const handleSuccess = async (
    result: Pick<InconnectCommercialTeamSettingsMutationResult, 'cacheStatus'>,
    successMessage: string,
  ) => {
    if (
      result.cacheStatus ===
      InconnectCommercialTeamCacheStatus.recomputationFailed
    ) {
      enqueueWarningSnackBar({
        message: t`Team changes were saved, but the access cache could not be refreshed. Team-based access is temporarily fail-closed.`,
      });
    } else {
      enqueueSuccessSnackBar({ message: successMessage });
    }

    await refetchReadModelsSafely();
  };

  const handleError = async (error: unknown) => {
    const code = getGraphQLErrorCode(error);

    if (code === 'CONFLICT') {
      enqueueWarningSnackBar({
        message: t`The commercial team structure changed or this member is already assigned. The latest state has been reloaded.`,
      });
      await refetchReadModelsSafely();
      return;
    }

    if (code === 'NOT_FOUND') {
      enqueueWarningSnackBar({
        message: t`The team or member no longer exists. The latest state has been reloaded.`,
      });
      await refetchReadModelsSafely();
      return;
    }

    if (code === 'BAD_USER_INPUT') {
      enqueueWarningSnackBar({
        message: t`The requested commercial team change is invalid.`,
      });
      return;
    }

    enqueueErrorSnackBar({
      apolloError: CombinedGraphQLErrors.is(error) ? error : undefined,
    });
  };

  const runMutation = async (
    execute: () => Promise<
      | Pick<InconnectCommercialTeamSettingsMutationResult, 'cacheStatus'>
      | undefined
    >,
    successMessage: string,
  ) => {
    try {
      const result = await execute();

      if (!result) {
        throw new Error('Commercial Team mutation returned no result');
      }

      await handleSuccess(result, successMessage);
      return true;
    } catch (error) {
      await handleError(error);
      return false;
    }
  };

  return {
    createTeam: (name: string) =>
      runMutation(
        async () => {
          const result = await createTeam({ variables: { input: { name } } });
          return result.data?.createInconnectCommercialTeam;
        },
        t`Commercial team created.`,
      ),
    renameTeam: (teamId: string, name: string) =>
      runMutation(
        async () => {
          const result = await renameTeam({
            variables: { input: { teamId, name } },
          });
          return result.data?.renameInconnectCommercialTeam;
        },
        t`Commercial team renamed.`,
      ),
    assignCoordinator: (teamId: string, workspaceMemberId: string) =>
      runMutation(
        async () => {
          const result = await assignCoordinator({
            variables: { input: { teamId, workspaceMemberId } },
          });
          return result.data?.assignInconnectCommercialTeamCoordinator;
        },
        t`Coordinator assigned.`,
      ),
    addExecutive: (teamId: string, workspaceMemberId: string) =>
      runMutation(
        async () => {
          const result = await addExecutive({
            variables: { input: { teamId, workspaceMemberId } },
          });
          return result.data?.addInconnectCommercialTeamExecutive;
        },
        t`Executive added.`,
      ),
    removeExecutive: (teamId: string, workspaceMemberId: string) =>
      runMutation(
        async () => {
          const result = await removeExecutive({
            variables: { input: { teamId, workspaceMemberId } },
          });
          return result.data?.removeInconnectCommercialTeamExecutive;
        },
        t`Executive removed from the commercial team.`,
      ),
    moveExecutive: (workspaceMemberId: string, targetTeamId: string) =>
      runMutation(
        async () => {
          const result = await moveMember({
            variables: { input: { workspaceMemberId, targetTeamId } },
          });
          return result.data?.moveInconnectCommercialTeamMember;
        },
        t`Executive moved.`,
      ),
    deleteTeam: (teamId: string) =>
      runMutation(
        async () => {
          const result = await deleteTeam({ variables: { input: { teamId } } });
          return result.data?.deleteInconnectCommercialTeam;
        },
        t`Commercial team deleted.`,
      ),
    isLoading:
      createState.loading ||
      renameState.loading ||
      assignCoordinatorState.loading ||
      addExecutiveState.loading ||
      removeExecutiveState.loading ||
      moveMemberState.loading ||
      deleteState.loading,
  };
};
