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

import { SettingsMessagingCrmContext } from '~/pages/settings/messaging/SettingsMessagingCrmContext';
import {
  InconnectMessagingContextConfigurationDocument,
  type InconnectMessagingContextConfigurationQuery,
  InconnectMessagingContextValueKind,
  ReplaceInconnectMessagingContextConfigurationDocument,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockReplaceConfiguration = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();
const mockEnqueueSuccessSnackBar = jest.fn();

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
  SettingsSkeletonLoader: () => <div role="status">Loading</div>,
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

jest.mock(
  '@/settings/components/SettingsOptions/SettingsOptionCardContentButton',
  () => ({
    SettingsOptionCardContentButton: ({
      title,
      description,
    }: {
      title: ReactNode;
      description?: string;
    }) => (
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    ),
  }),
);

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
    enqueueSuccessSnackBar: mockEnqueueSuccessSnackBar,
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
    ariaLabel,
    onClick,
    disabled,
  }: {
    title: string;
    ariaLabel?: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button aria-label={ariaLabel} onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
  LightIconButton: ({
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => <button onClick={onClick} disabled={disabled} aria-label={ariaLabel} />,
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

type ContextConfiguration =
  InconnectMessagingContextConfigurationQuery['inconnectMessagingContextConfiguration'];

const createCandidate = (
  fieldMetadataId: string,
  label: string,
  isLabelIdentifier = false,
) => ({
  __typename: 'InconnectMessagingContextCandidateField' as const,
  fieldMetadataId,
  label,
  valueKind: InconnectMessagingContextValueKind.TEXT,
  isLabelIdentifier,
});

const candidates = [
  createCandidate('field-a', 'Field A', true),
  createCandidate('field-b', 'Field B'),
  createCandidate('field-c', 'Field C'),
  createCandidate('field-d', 'Field D'),
];

const createConfiguration = (
  orderedIds: string[],
  availableFields = candidates,
  maximumFieldCount = 20,
): ContextConfiguration => ({
  __typename: 'InconnectMessagingContextConfiguration',
  anchorObject: {
    __typename: 'InconnectMessagingContextObject',
    label: 'CRM object fixture',
  },
  fields: orderedIds.map((fieldMetadataId) => {
    const field = availableFields.find(
      (candidate) => candidate.fieldMetadataId === fieldMetadataId,
    );

    if (field === undefined) {
      throw new Error(`Missing test candidate ${fieldMetadataId}`);
    }

    return {
      __typename: 'InconnectMessagingContextConfiguredField' as const,
      fieldMetadataId,
      label: field.label,
      valueKind: field.valueKind,
    };
  }),
  availableFields,
  maximumFieldCount,
});

const toQueryData = (configuration: ContextConfiguration) => ({
  __typename: 'Query' as const,
  inconnectMessagingContextConfiguration: configuration,
});

const renderPage = () =>
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SettingsMessagingCrmContext />
      </MemoryRouter>
    </I18nProvider>,
  );

const getListLabels = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('SettingsMessagingCrmContext', () => {
  const configurationRefetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    const configuration = createConfiguration(['field-a', 'field-b']);

    configurationRefetch.mockResolvedValue({
      data: toQueryData(configuration),
    });
    mockUseQuery.mockImplementation((document) => {
      expect(document).toBe(InconnectMessagingContextConfigurationDocument);

      return {
        data: toQueryData(configuration),
        loading: false,
        error: undefined,
        refetch: configurationRefetch,
      };
    });
    mockReplaceConfiguration.mockResolvedValue({ data: {} });
    mockUseMutation.mockImplementation((document) => {
      expect(document).toBe(
        ReplaceInconnectMessagingContextConfigurationDocument,
      );

      return [mockReplaceConfiguration, { loading: false }];
    });
  });

  it('renders the safe anchor, configured order, and backend candidates', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'CRM context', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('CRM object fixture')).toBeInTheDocument();
    expect(getListLabels('Fields shown in Messaging')).toEqual([
      expect.stringContaining('Field A'),
      expect.stringContaining('Field B'),
    ]);
    expect(getListLabels('Available fields')).toEqual([
      expect.stringContaining('Field C'),
      expect.stringContaining('Field D'),
    ]);
    expect(screen.getByText('Canonical record label')).toBeInTheDocument();
  });

  it('edits locally and sends only the ordered draft IDs on save', async () => {
    configurationRefetch.mockResolvedValue({
      data: toQueryData(createConfiguration(['field-b', 'field-c'])),
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Field C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Field A' }));

    expect(mockReplaceConfiguration).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Add Field C' }),
    ).not.toBeInTheDocument();
    expect(getListLabels('Fields shown in Messaging')).toEqual([
      expect.stringContaining('Field B'),
      expect.stringContaining('Field C'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockReplaceConfiguration).toHaveBeenCalledWith({
        variables: { fieldMetadataIds: ['field-b', 'field-c'] },
      }),
    );
  });

  it('reorders with keyboard-accessible controls and keeps order significant', async () => {
    const configuration = createConfiguration([
      'field-a',
      'field-b',
      'field-c',
    ]);

    mockUseQuery.mockReturnValue({
      data: toQueryData(configuration),
      loading: false,
      error: undefined,
      refetch: configurationRefetch,
    });
    configurationRefetch.mockResolvedValue({
      data: toQueryData(createConfiguration(['field-a', 'field-c', 'field-b'])),
    });
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Move Field C up' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockReplaceConfiguration).toHaveBeenCalledWith({
        variables: {
          fieldMetadataIds: ['field-a', 'field-c', 'field-b'],
        },
      }),
    );
  });

  it('cancels back to the latest server order', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Move Field B up' }),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(getListLabels('Fields shown in Messaging')).toEqual([
      expect.stringContaining('Field A'),
      expect.stringContaining('Field B'),
    ]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('allows saving an empty configuration', async () => {
    configurationRefetch.mockResolvedValue({
      data: toQueryData(createConfiguration([])),
    });
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Field A' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Field B' }));
    expect(screen.getByText('No fields selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockReplaceConfiguration).toHaveBeenCalledWith({
        variables: { fieldMetadataIds: [] },
      }),
    );
  });

  it('blocks adding beyond the backend maximum without blocking edits', async () => {
    const maximumCandidates = Array.from({ length: 21 }, (_, index) =>
      createCandidate(`field-${index + 1}`, `Field ${index + 1}`),
    );
    const configuration = createConfiguration(
      maximumCandidates.slice(0, 20).map((field) => field.fieldMetadataId),
      maximumCandidates,
      20,
    );

    mockUseQuery.mockReturnValue({
      data: toQueryData(configuration),
      loading: false,
      error: undefined,
      refetch: configurationRefetch,
    });
    renderPage();

    expect(
      await screen.findByRole('button', {
        name: 'Add Field 21; maximum 20 fields selected',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove Field 1' }),
    ).toBeEnabled();
    expect(
      screen.getByText(
        'Maximum 20 fields selected. Remove a field before adding another.',
      ),
    ).toHaveAttribute('role', 'status');
  });

  it('uses the refetched server order as authority after save', async () => {
    configurationRefetch.mockResolvedValue({
      data: toQueryData(createConfiguration(['field-c', 'field-a', 'field-b'])),
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Field C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(getListLabels('Fields shown in Messaging')).toEqual([
        expect.stringContaining('Field C'),
        expect.stringContaining('Field A'),
        expect.stringContaining('Field B'),
      ]),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(mockEnqueueSuccessSnackBar).toHaveBeenCalledWith({
      message: 'Changes saved',
    });
  });

  it('preserves a stale draft and reloads current candidates when save fails', async () => {
    let currentConfiguration = createConfiguration(['field-a', 'field-b']);
    const reloadedConfiguration = createConfiguration(
      ['field-a'],
      [candidates[0]],
    );

    mockUseQuery.mockImplementation(() => ({
      data: toQueryData(currentConfiguration),
      loading: false,
      error: undefined,
      refetch: configurationRefetch,
    }));
    mockReplaceConfiguration.mockRejectedValue(new Error('internal details'));
    configurationRefetch.mockImplementation(async () => {
      currentConfiguration = reloadedConfiguration;

      return { data: toQueryData(reloadedConfiguration) };
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Field C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Changes were not confirmed'),
    ).toBeInTheDocument();
    expect(getListLabels('Fields shown in Messaging')).toEqual([
      expect.stringContaining('Field A'),
      expect.stringContaining('Field B'),
      expect.stringContaining('Field C'),
    ]);
    expect(screen.queryByText('internal details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(getListLabels('Fields shown in Messaging')).toEqual([
        expect.stringContaining('Field A'),
      ]),
    );
    expect(screen.queryByText('Field C')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a loading state without exposing stale controls', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
      refetch: configurationRefetch,
    });
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('shows a safe retryable load error without editable configuration', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('private backend details'),
      refetch: configurationRefetch,
    });
    renderPage();

    expect(screen.getByText('Configuration unavailable')).toBeInTheDocument();
    expect(
      screen.queryByText('private backend details'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
