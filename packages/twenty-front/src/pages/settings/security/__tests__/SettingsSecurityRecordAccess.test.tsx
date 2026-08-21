import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import {
  availableMetadataFixture,
  managedConfigurationFixture,
} from '@/settings/security/record-access/__tests__/fixtures/inconnectRecordAccessSettingsFixtures';
import { SettingsSecurityRecordAccess } from '~/pages/settings/security/SettingsSecurityRecordAccess';
import {
  GetInconnectRecordAccessAvailableMetadataDocument,
  GetInconnectRecordAccessConfigurationDocument,
  InconnectRecordAccessCacheStatus,
  InconnectRecordAccessConfigurationStatus,
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessOwnerRequirement,
  ReplaceInconnectRecordAccessConfigurationDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockReplaceConfiguration = jest.fn();
const mockOpenModal = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();
const mockEnqueueSuccessSnackBar = jest.fn();
const mockEnqueueWarningSnackBar = jest.fn();

jest.mock('@apollo/client/react', () => ({
  ...jest.requireActual('@apollo/client/react'),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

jest.mock(
  '@/settings/components/SaveAndCancelButtons/SaveAndCancelButtons',
  () => ({
    SaveAndCancelButtons: ({
      onSave,
      onCancel,
      isSaveDisabled,
      isCancelDisabled,
    }: {
      onSave: () => void;
      onCancel: () => void;
      isSaveDisabled: boolean;
      isCancelDisabled: boolean;
    }) => (
      <>
        <button onClick={onCancel} disabled={isCancelDisabled}>
          Cancel
        </button>
        <button onClick={onSave} disabled={isSaveDisabled}>
          Save
        </button>
      </>
    ),
  }),
);

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
    actionButton,
    children,
  }: {
    title: ReactNode;
    actionButton?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {actionButton}
      {children}
    </div>
  ),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    options,
    emptyOption,
    onChange,
  }: {
    label?: string;
    value?: string;
    options: Array<{ label: string; value: string }>;
    emptyOption?: { label: string; value: string };
    onChange?: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
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
    </label>
  ),
}));

jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({ openModal: mockOpenModal }),
}));

jest.mock('@/ui/layout/modal/components/ConfirmationModal', () => ({
  ConfirmationModal: ({
    title,
    subtitle,
    confirmButtonText,
    onConfirmClick,
  }: {
    title: string;
    subtitle: ReactNode;
    confirmButtonText?: string;
    onConfirmClick: () => void;
  }) => (
    <div data-testid={`modal-${title}`}>
      {subtitle}
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
  LightIconButton: ({
    onClick,
    'aria-label': ariaLabel,
  }: {
    onClick?: () => void;
    'aria-label'?: string;
  }) => (
    <button onClick={onClick} aria-label={ariaLabel}>
      Remove
    </button>
  ),
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const renderPage = () =>
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <SettingsSecurityRecordAccess />
      </MemoryRouter>
    </I18nProvider>,
  );

const absentConfiguration = {
  __typename: 'Query' as const,
  getInconnectRecordAccessConfiguration: {
    __typename: 'InconnectRecordAccessSettingsConfiguration' as const,
    status: InconnectRecordAccessConfigurationStatus.ABSENT,
    enforcementMode: null,
    revision: null,
    managedObjects: [],
  },
};

const unmanagedConfiguration = {
  __typename: 'Query' as const,
  getInconnectRecordAccessConfiguration: {
    __typename: 'InconnectRecordAccessSettingsConfiguration' as const,
    status: InconnectRecordAccessConfigurationStatus.UNMANAGED,
    enforcementMode: InconnectRecordAccessEnforcementMode.UNMANAGED,
    revision: '1',
    managedObjects: [],
  },
};

describe('SettingsSecurityRecordAccess', () => {
  const configurationRefetch = jest.fn();
  const metadataRefetch = jest.fn();
  let configurationData = managedConfigurationFixture;
  let metadataError: Error | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    configurationData = managedConfigurationFixture;
    metadataError = undefined;

    configurationRefetch.mockResolvedValue({
      data: managedConfigurationFixture,
    });
    metadataRefetch.mockResolvedValue({
      data: availableMetadataFixture,
    });
    mockReplaceConfiguration.mockResolvedValue({
      data: {
        replaceInconnectRecordAccessConfiguration: {
          __typename: 'ReplaceInconnectRecordAccessConfigurationResult',
          revision: '2',
          cacheStatus: InconnectRecordAccessCacheStatus.recomputed,
          changedFromManagedToUnmanaged: false,
        },
      },
    });

    mockUseQuery.mockImplementation((document) => {
      if (document === GetInconnectRecordAccessConfigurationDocument) {
        return {
          data: configurationData,
          loading: false,
          error: undefined,
          refetch: configurationRefetch,
        };
      }

      if (document === GetInconnectRecordAccessAvailableMetadataDocument) {
        return {
          data: metadataError ? undefined : availableMetadataFixture,
          loading: false,
          error: metadataError,
          refetch: metadataRefetch,
        };
      }

      throw new Error('Unexpected query document');
    });

    mockUseMutation.mockImplementation((document) => {
      if (document !== ReplaceInconnectRecordAccessConfigurationDocument) {
        throw new Error('Unexpected mutation document');
      }

      return [mockReplaceConfiguration, { loading: false }];
    });
  });

  it('renders the persisted MANAGED configuration without losing policies', async () => {
    renderPage();

    expect(await screen.findByText('Revision 1')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(screen.getByText('Folio ISO')).toBeInTheDocument();
    expect(screen.getByText('Propietario de lead')).toBeInTheDocument();
    expect(screen.getByText('Propietario de Folio')).toBeInTheDocument();
    expect(screen.getAllByText('Ejecutivo INCONNECT').length).toBeGreaterThan(
      1,
    );
    expect(screen.getAllByText('Default owner role')).toHaveLength(2);
  });

  it('distinguishes ABSENT and starts only a local draft', async () => {
    configurationData = absentConfiguration;
    renderPage();

    expect(
      await screen.findByText(
        'Record access is not configured for this workspace.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Set up record access'));

    expect(screen.getByLabelText('Enforcement mode')).toHaveValue(
      InconnectRecordAccessEnforcementMode.MANAGED,
    );
    expect(screen.getByText('Save')).toBeDisabled();
    expect(mockReplaceConfiguration).not.toHaveBeenCalled();
  });

  it('renders UNMANAGED distinctly', async () => {
    configurationData = unmanagedConfiguration;
    renderPage();

    expect(
      await screen.findByText('Record access is unmanaged'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Enforcement mode')).toHaveValue(
      InconnectRecordAccessEnforcementMode.UNMANAGED,
    );
  });

  it('tracks dirty state and Cancel restores persisted values', async () => {
    renderPage();
    await screen.findByText('Revision 1');

    fireEvent.change(screen.getByLabelText('Enforcement mode'), {
      target: {
        value: InconnectRecordAccessEnforcementMode.UNMANAGED,
      },
    });

    expect(screen.getByText('Save')).toBeEnabled();
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByLabelText('Enforcement mode')).toHaveValue(
      InconnectRecordAccessEnforcementMode.MANAGED,
    );
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('publishes the complete draft with expectedRevision', async () => {
    renderPage();
    await screen.findByText('Revision 1');

    fireEvent.change(screen.getAllByLabelText('Owner requirement')[0], {
      target: { value: InconnectRecordAccessOwnerRequirement.optional },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockReplaceConfiguration).toHaveBeenCalledWith({
        variables: {
          input: expect.objectContaining({
            expectedRevision: '1',
            managedObjects: expect.any(Array),
            policies: expect.any(Array),
          }),
        },
      }),
    );

    const input = mockReplaceConfiguration.mock.calls[0][0].variables.input;

    expect(input.managedObjects).toHaveLength(2);
    expect(input.policies).toHaveLength(8);
  });

  it('shows a revision conflict without retrying automatically', async () => {
    mockReplaceConfiguration.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [
          {
            message: 'Conflict',
            extensions: { subCode: 'REVISION_CONFLICT' },
          },
        ],
      }),
    );
    renderPage();
    await screen.findByText('Revision 1');

    fireEvent.change(screen.getAllByLabelText('Owner requirement')[0], {
      target: { value: InconnectRecordAccessOwnerRequirement.optional },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(
      await screen.findByText('Configuration changed'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reload')).toBeInTheDocument();
    expect(mockReplaceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('reports cache recomputation failure as a saved fail-closed state', async () => {
    mockReplaceConfiguration.mockResolvedValue({
      data: {
        replaceInconnectRecordAccessConfiguration: {
          revision: '2',
          cacheStatus: InconnectRecordAccessCacheStatus.recomputationFailed,
          changedFromManagedToUnmanaged: false,
        },
      },
    });
    renderPage();
    await screen.findByText('Revision 1');

    fireEvent.change(screen.getAllByLabelText('Owner requirement')[0], {
      target: { value: InconnectRecordAccessOwnerRequirement.optional },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(
      await screen.findByText('Access is temporarily fail-closed'),
    ).toBeInTheDocument();
    expect(mockEnqueueWarningSnackBar).toHaveBeenCalled();
    expect(configurationRefetch).toHaveBeenCalled();
  });

  it('requires confirmation before MANAGED becomes UNMANAGED', async () => {
    renderPage();
    await screen.findByText('Revision 1');

    fireEvent.change(screen.getByLabelText('Enforcement mode'), {
      target: {
        value: InconnectRecordAccessEnforcementMode.UNMANAGED,
      },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(mockOpenModal).toHaveBeenCalledWith(
      'inconnect-record-access-disable-managed-modal',
    );
    expect(mockReplaceConfiguration).not.toHaveBeenCalled();
  });

  it('disables the editor when metadata cannot be loaded', async () => {
    metadataError = new Error('metadata unavailable');
    renderPage();

    expect(
      await screen.findByText('Record access could not be loaded'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });
});
