import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { SettingsSecurityCommercialTeams } from '~/pages/settings/security/SettingsSecurityCommercialTeams';
import {
  AddInconnectCommercialTeamExecutiveDocument,
  AssignInconnectCommercialTeamCoordinatorDocument,
  CreateInconnectCommercialTeamDocument,
  DeleteInconnectCommercialTeamDocument,
  GetInconnectCommercialTeamAvailableMembersDocument,
  GetInconnectCommercialTeamsDocument,
  type GetInconnectCommercialTeamsQuery,
  InconnectCommercialTeamCacheStatus,
  InconnectCommercialTeamMembershipType,
  MoveInconnectCommercialTeamMemberDocument,
  RemoveInconnectCommercialTeamExecutiveDocument,
  RenameInconnectCommercialTeamDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();
const mockEnqueueSuccessSnackBar = jest.fn();
const mockEnqueueWarningSnackBar = jest.fn();

const mutationMocks = new Map<unknown, jest.Mock>();

jest.mock('@apollo/client/react', () => ({
  ...jest.requireActual('@apollo/client/react'),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

jest.mock('@/settings/components/SettingsPageContainer', () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

jest.mock('@/settings/components/SettingsSkeletonLoader', () => ({
  SettingsSkeletonLoader: () => <div>Loading</div>,
}));

jest.mock('@/settings/components/layout/SettingsPageLayout', () => ({
  SettingsPageLayout: ({
    title,
    children,
  }: {
    title: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

jest.mock('@/ui/input/components/SettingsTextInput', () => ({
  SettingsTextInput: ({
    instanceId,
    value,
    onChange,
  }: {
    instanceId: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={instanceId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    dropdownId,
    value,
    options,
    emptyOption,
    onChange,
    isDropdownInModal,
  }: {
    dropdownId: string;
    value?: string;
    options: Array<{ label: string; value: string }>;
    emptyOption?: { label: string; value: string };
    onChange?: (value: string) => void;
    isDropdownInModal?: boolean;
  }) => (
    <select
      aria-label={dropdownId}
      data-dropdown-in-modal={isDropdownInModal}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {emptyOption && (
        <option value={emptyOption.value}>{emptyOption.label}</option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
  }),
}));

jest.mock('@/ui/layout/modal/components/ModalStatefulWrapper', () => ({
  ModalStatefulWrapper: ({
    modalInstanceId,
    children,
  }: {
    modalInstanceId: string;
    children: ReactNode;
  }) => <div data-testid={modalInstanceId}>{children}</div>,
}));

jest.mock('@/ui/layout/modal/components/ConfirmationModal', () => ({
  ConfirmationModal: ({
    modalInstanceId,
    title,
    subtitle,
    confirmButtonText,
    onConfirmClick,
  }: {
    modalInstanceId: string;
    title: string;
    subtitle: ReactNode;
    confirmButtonText?: string;
    onConfirmClick: () => void;
  }) => (
    <div data-testid={modalInstanceId}>
      <strong>{title}</strong>
      <span>{subtitle}</span>
      <button onClick={onConfirmClick}>{confirmButtonText ?? 'Confirm'}</button>
    </div>
  ),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
    enqueueSuccessSnackBar: mockEnqueueSuccessSnackBar,
    enqueueWarningSnackBar: mockEnqueueWarningSnackBar,
  }),
}));

jest.mock('twenty-ui/feedback', () => ({
  Callout: ({
    title,
    description,
    action,
  }: {
    title: string;
    description: string;
    action?: { label: string; onClick: () => void };
  }) => (
    <div>
      <strong>{title}</strong>
      <span>{description}</span>
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    onClick,
    disabled,
  }: {
    title: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
}));

jest.mock('twenty-ui/layout', () => ({
  AnimatedExpandableContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  Section: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SectionAlignment: { Center: 'center' },
  SectionFontColor: { Primary: 'primary', Secondary: 'secondary' },
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const teamNorth = {
  __typename: 'InconnectCommercialTeamSettingsTeam' as const,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Equipo Norte',
  coordinator: {
    __typename: 'InconnectCommercialTeamSettingsMember' as const,
    membershipId: '21111111-1111-4111-8111-111111111111',
    workspaceMemberId: '31111111-1111-4111-8111-111111111111',
    displayName: 'Tim Apple',
    email: 'tim@apple.dev',
    isAssignable: true,
  },
  executives: [
    {
      __typename: 'InconnectCommercialTeamSettingsMember' as const,
      membershipId: '41111111-1111-4111-8111-111111111111',
      workspaceMemberId: '51111111-1111-4111-8111-111111111111',
      displayName: 'Scott Forstall',
      email: 'scott@apple.dev',
      isAssignable: true,
    },
    {
      __typename: 'InconnectCommercialTeamSettingsMember' as const,
      membershipId: '81111111-1111-4111-8111-111111111111',
      workspaceMemberId: '91111111-1111-4111-8111-111111111111',
      displayName: 'Historical Member',
      email: 'historical@apple.dev',
      isAssignable: false,
    },
  ],
};

const teamSouth = {
  __typename: 'InconnectCommercialTeamSettingsTeam' as const,
  id: '61111111-1111-4111-8111-111111111111',
  name: 'Equipo Sur',
  coordinator: null,
  executives: [],
};

const teamsData: GetInconnectCommercialTeamsQuery = {
  getInconnectCommercialTeams: [teamNorth, teamSouth],
};

const membersData = {
  getInconnectCommercialTeamAvailableMembers: [
    {
      __typename: 'InconnectCommercialTeamSettingsAvailableMember' as const,
      workspaceMemberId: teamNorth.coordinator.workspaceMemberId,
      displayName: 'Tim Apple',
      email: 'tim@apple.dev',
      currentTeamId: teamNorth.id,
      currentMembershipType: InconnectCommercialTeamMembershipType.COORDINATOR,
    },
    {
      __typename: 'InconnectCommercialTeamSettingsAvailableMember' as const,
      workspaceMemberId: teamNorth.executives[0].workspaceMemberId,
      displayName: 'Scott Forstall',
      email: 'scott@apple.dev',
      currentTeamId: teamNorth.id,
      currentMembershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
    },
    {
      __typename: 'InconnectCommercialTeamSettingsAvailableMember' as const,
      workspaceMemberId: '71111111-1111-4111-8111-111111111111',
      displayName: 'Jane Austen',
      email: 'jane@apple.dev',
      currentTeamId: null,
      currentMembershipType: null,
    },
    {
      __typename: 'InconnectCommercialTeamSettingsAvailableMember' as const,
      workspaceMemberId: 'a1111111-1111-4111-8111-111111111111',
      displayName: 'Already Assigned',
      email: 'assigned@apple.dev',
      currentTeamId: teamSouth.id,
      currentMembershipType: InconnectCommercialTeamMembershipType.EXECUTIVE,
    },
  ],
};

const queryRefetch = jest.fn().mockResolvedValue({ data: teamsData });
const membersRefetch = jest.fn().mockResolvedValue({ data: membersData });

const renderPage = () =>
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <SettingsSecurityCommercialTeams />
      </MemoryRouter>
    </I18nProvider>,
  );

const mutationFieldNameByDocument = new Map<unknown, string>([
  [CreateInconnectCommercialTeamDocument, 'createInconnectCommercialTeam'],
  [RenameInconnectCommercialTeamDocument, 'renameInconnectCommercialTeam'],
  [
    AssignInconnectCommercialTeamCoordinatorDocument,
    'assignInconnectCommercialTeamCoordinator',
  ],
  [
    AddInconnectCommercialTeamExecutiveDocument,
    'addInconnectCommercialTeamExecutive',
  ],
  [
    RemoveInconnectCommercialTeamExecutiveDocument,
    'removeInconnectCommercialTeamExecutive',
  ],
  [
    MoveInconnectCommercialTeamMemberDocument,
    'moveInconnectCommercialTeamMember',
  ],
  [DeleteInconnectCommercialTeamDocument, 'deleteInconnectCommercialTeam'],
]);

const getSuccessfulMutationResult = (document: unknown) => ({
  data: {
    [mutationFieldNameByDocument.get(document) ?? 'unknown']: {
      teamId: teamNorth.id,
      membershipId: null,
      cacheStatus: InconnectCommercialTeamCacheStatus.recomputed,
    },
  },
});

describe('SettingsSecurityCommercialTeams', () => {
  let teamsError: Error | undefined;

  beforeEach(() => {
    teamsData.getInconnectCommercialTeams.splice(
      0,
      teamsData.getInconnectCommercialTeams.length,
      teamNorth,
      teamSouth,
    );
    jest.clearAllMocks();
    teamsError = undefined;

    mockUseQuery.mockImplementation((document) => {
      if (document === GetInconnectCommercialTeamsDocument) {
        return {
          data: teamsError ? undefined : teamsData,
          loading: false,
          error: teamsError,
          refetch: queryRefetch,
        };
      }

      if (document === GetInconnectCommercialTeamAvailableMembersDocument) {
        return {
          data: membersData,
          loading: false,
          error: undefined,
          refetch: membersRefetch,
        };
      }

      throw new Error('Unexpected query');
    });

    mutationMocks.clear();
    [
      CreateInconnectCommercialTeamDocument,
      RenameInconnectCommercialTeamDocument,
      AssignInconnectCommercialTeamCoordinatorDocument,
      AddInconnectCommercialTeamExecutiveDocument,
      RemoveInconnectCommercialTeamExecutiveDocument,
      MoveInconnectCommercialTeamMemberDocument,
      DeleteInconnectCommercialTeamDocument,
    ].forEach((document) => {
      mutationMocks.set(
        document,
        jest.fn().mockResolvedValue(getSuccessfulMutationResult(document)),
      );
    });

    mockUseMutation.mockImplementation((document) => {
      const mutation = mutationMocks.get(document);

      if (!mutation) {
        throw new Error('Unexpected mutation');
      }

      return [mutation, { loading: false }];
    });
  });

  it('renders team hierarchy and keeps a non-assignable member visible', () => {
    renderPage();

    expect(screen.getByText('Equipo Norte')).toBeInTheDocument();
    expect(
      screen.getByText('1 coordinator / 2 executives'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('0 coordinators / 0 executives'),
    ).toBeInTheDocument();
    expect(screen.getByText('Tim Apple')).toBeInTheDocument();
    expect(screen.getByText('Scott Forstall')).toBeInTheDocument();
    expect(
      screen.getByText('Member is no longer assignable.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Move')).toHaveLength(1);
    expect(
      screen.getByText(
        'Roles determine access policies. Team membership determines which members belong to a team.',
      ),
    ).toBeInTheDocument();
  });

  it('pluralizes singular coordinator and executive counts', () => {
    teamsData.getInconnectCommercialTeams.splice(
      0,
      teamsData.getInconnectCommercialTeams.length,
      { ...teamNorth, executives: [teamNorth.executives[0]] },
      { ...teamSouth, executives: [teamNorth.executives[1]] },
    );

    renderPage();

    expect(screen.getByText('1 coordinator / 1 executive')).toBeInTheDocument();
    expect(
      screen.getByText('0 coordinators / 1 executive'),
    ).toBeInTheDocument();
  });

  it('renders the empty and query-error states', () => {
    teamsData.getInconnectCommercialTeams.splice(
      0,
      teamsData.getInconnectCommercialTeams.length,
    );
    const { unmount } = renderPage();

    expect(screen.getByText('No commercial teams yet')).toBeInTheDocument();
    unmount();
    teamsData.getInconnectCommercialTeams.push(teamNorth, teamSouth);
    teamsError = new Error('unavailable');
    renderPage();

    expect(
      screen.getByText('Commercial teams could not be loaded'),
    ).toBeInTheDocument();
  });

  it('creates and renames teams using trimmed names', async () => {
    renderPage();

    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-create-name'),
      { target: { value: '  Equipo Prueba  ' } },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-create')).getByText(
        'Create team',
      ),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(CreateInconnectCommercialTeamDocument),
      ).toHaveBeenCalledWith({
        variables: { input: { name: 'Equipo Prueba' } },
      }),
    );

    fireEvent.click(screen.getAllByText('Rename')[0]);
    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-rename-name'),
      { target: { value: 'Equipo Norte Renombrado' } },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-rename')).getByText(
        'Rename team',
      ),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(RenameInconnectCommercialTeamDocument),
      ).toHaveBeenCalledWith({
        variables: {
          input: { teamId: teamNorth.id, name: 'Equipo Norte Renombrado' },
        },
      }),
    );
  });

  it('assigns coordinators, adds executives and moves executives atomically', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Change coordinator'));
    expect(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
    ).toHaveAttribute('data-dropdown-in-modal', 'true');
    expect(
      screen.getByText(
        'The current coordinator will become an executive in this team. Members assigned to another team must be moved or removed first.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
      { target: { value: teamNorth.executives[0].workspaceMemberId } },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-member')).getByText(
        'Assign coordinator',
      ),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(AssignInconnectCommercialTeamCoordinatorDocument),
      ).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getAllByText('Add executive')[0]);
    expect(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
    ).toHaveAttribute('data-dropdown-in-modal', 'true');
    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
      {
        target: {
          value:
            membersData.getInconnectCommercialTeamAvailableMembers[2]
              .workspaceMemberId,
        },
      },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-member')).getByRole(
        'button',
        { name: 'Add executive' },
      ),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(AddInconnectCommercialTeamExecutiveDocument),
      ).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByText('Move'));
    expect(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
    ).toHaveAttribute('data-dropdown-in-modal', 'true');
    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
      { target: { value: teamSouth.id } },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-member')).getByRole(
        'button',
        { name: 'Move executive' },
      ),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(MoveInconnectCommercialTeamMemberDocument),
      ).toHaveBeenCalledWith({
        variables: {
          input: {
            workspaceMemberId: teamNorth.executives[0].workspaceMemberId,
            targetTeamId: teamSouth.id,
          },
        },
      }),
    );
  });

  it('requires clear confirmations before removing an executive or team', async () => {
    renderPage();

    fireEvent.click(screen.getAllByText('Remove')[0]);

    expect(
      within(
        screen.getByTestId('inconnect-commercial-team-remove-executive'),
      ).getByText(
        'Remove Scott Forstall from the commercial team? This does not remove the workspace member or change their role.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(
        screen.getByTestId('inconnect-commercial-team-remove-executive'),
      ).getByText('Remove executive'),
    );

    await waitFor(() =>
      expect(
        mutationMocks.get(RemoveInconnectCommercialTeamExecutiveDocument),
      ).toHaveBeenCalledWith({
        variables: {
          input: {
            teamId: teamNorth.id,
            workspaceMemberId: teamNorth.executives[0].workspaceMemberId,
          },
        },
      }),
    );

    fireEvent.click(screen.getAllByText('Delete')[0]);

    expect(
      within(screen.getByTestId('inconnect-commercial-team-delete')).getByText(
        'Deleting Equipo Norte removes its active commercial team memberships. Workspace members and roles are not deleted.',
      ),
    ).toBeInTheDocument();
  });

  it('refetches after conflicts without retrying automatically', async () => {
    mutationMocks.set(
      AddInconnectCommercialTeamExecutiveDocument,
      jest.fn().mockRejectedValue(
        new CombinedGraphQLErrors({
          errors: [
            {
              message: 'Conflict',
              extensions: { code: 'CONFLICT' },
            },
          ],
        }),
      ),
    );
    renderPage();

    fireEvent.click(screen.getAllByText('Add executive')[0]);
    fireEvent.change(
      screen.getByLabelText('inconnect-commercial-team-member-selection'),
      {
        target: {
          value:
            membersData.getInconnectCommercialTeamAvailableMembers[2]
              .workspaceMemberId,
        },
      },
    );
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-member')).getByRole(
        'button',
        { name: 'Add executive' },
      ),
    );

    await waitFor(() => expect(queryRefetch).toHaveBeenCalled());
    expect(membersRefetch).toHaveBeenCalled();
    expect(mockEnqueueWarningSnackBar).toHaveBeenCalled();
    expect(
      mutationMocks.get(AddInconnectCommercialTeamExecutiveDocument),
    ).toHaveBeenCalledTimes(1);
  });

  it('reports recomputation failure as saved and refetches authority', async () => {
    mutationMocks.set(
      DeleteInconnectCommercialTeamDocument,
      jest.fn().mockResolvedValue({
        data: {
          deleteInconnectCommercialTeam: {
            teamId: teamNorth.id,
            membershipId: null,
            cacheStatus: InconnectCommercialTeamCacheStatus.recomputationFailed,
          },
        },
      }),
    );
    renderPage();

    fireEvent.click(screen.getAllByText('Delete')[0]);
    fireEvent.click(
      within(screen.getByTestId('inconnect-commercial-team-delete')).getByText(
        'Delete team',
      ),
    );

    await waitFor(() =>
      expect(mockEnqueueWarningSnackBar).toHaveBeenCalledWith({
        message:
          'Team changes were saved, but the access cache could not be refreshed. Team-based access is temporarily fail-closed.',
      }),
    );
    expect(queryRefetch).toHaveBeenCalled();
    expect(membersRefetch).toHaveBeenCalled();
  });
});
