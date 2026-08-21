import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import {
  availableMetadataFixture,
  OBJECT_IDS,
  ROLE_IDS,
} from '@/settings/security/record-access/__tests__/fixtures/inconnectRecordAccessSettingsFixtures';
import { SettingsRecordAccessEditor } from '@/settings/security/record-access/components/SettingsRecordAccessEditor';
import {
  createEmptyInconnectRecordAccessDraft,
  type InconnectRecordAccessConfigurationDraft,
} from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import {
  InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessSettingsAvailableMetadata,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockOpenModal = jest.fn();

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
    confirmButtonText,
    onConfirmClick,
  }: {
    confirmButtonText?: string;
    onConfirmClick: () => void;
  }) => (
    <button onClick={onConfirmClick}>{confirmButtonText ?? 'Confirm'}</button>
  ),
}));

jest.mock('twenty-ui/feedback', () => ({
  Callout: ({ title, description }: { title: string; description: string }) => (
    <div>
      <strong>{title}</strong>
      <span>{description}</span>
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

jest.mock('twenty-ui/layout', () => ({
  AnimatedExpandableContainer: ({
    children,
    isExpanded,
  }: {
    children: ReactNode;
    isExpanded: boolean;
  }) => (isExpanded ? <div>{children}</div> : null),
  Section: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

i18n.load({ [SOURCE_LOCALE]: messages });
i18n.activate(SOURCE_LOCALE);

const metadata =
  availableMetadataFixture.getInconnectRecordAccessAvailableMetadata;

const objectWithoutPoliciesDraft =
  (): InconnectRecordAccessConfigurationDraft => ({
    ...createEmptyInconnectRecordAccessDraft(),
    managedObjects: [
      {
        draftId: 'lead',
        objectMetadataId: OBJECT_IDS.lead,
        ownerFieldMetadataId:
          metadata.objects[0].ownerFields[0].fieldMetadataId,
        ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
        policies: [],
      },
    ],
  });

const Harness = ({
  initialDraft,
  availableMetadata = metadata,
}: {
  initialDraft: InconnectRecordAccessConfigurationDraft;
  availableMetadata?: InconnectRecordAccessSettingsAvailableMetadata;
}) => {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <I18nProvider i18n={i18n}>
      <SettingsRecordAccessEditor
        draft={draft}
        metadata={availableMetadata}
        onChange={setDraft}
      />
    </I18nProvider>
  );
};

describe('SettingsRecordAccessEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds an object only to the local draft and preserves zero policies', () => {
    render(<Harness initialDraft={createEmptyInconnectRecordAccessDraft()} />);

    fireEvent.change(screen.getByLabelText('Add object'), {
      target: { value: OBJECT_IDS.lead },
    });
    fireEvent.click(screen.getByText('Add'));

    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(
      screen.getByText('No roles currently have access to this object.'),
    ).toBeInTheDocument();
  });

  it('renders policies inside an expanded object container and can collapse it', () => {
    render(<Harness initialDraft={objectWithoutPoliciesDraft()} />);

    const collapseButton = screen.getByRole('button', {
      name: 'Collapse Lead',
    });

    expect(collapseButton).toHaveTextContent('Role policies (0)');
    expect(collapseButton).toHaveTextContent('Propietario de lead');
    expect(screen.getByText('Role policies (0)')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner field')).toBeInTheDocument();

    fireEvent.click(collapseButton);

    expect(screen.queryByLabelText('Owner field')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand Lead' }),
    ).toBeInTheDocument();
  });

  it('adds and removes a role policy without allowing a duplicate role', () => {
    render(<Harness initialDraft={objectWithoutPoliciesDraft()} />);

    fireEvent.change(screen.getByLabelText('Add role policy'), {
      target: { value: ROLE_IDS.executive },
    });
    const addPolicyButton = screen
      .getAllByRole('button', { name: 'Add' })
      .find((button) => !button.hasAttribute('disabled'));

    expect(addPolicyButton).toBeDefined();
    fireEvent.click(addPolicyButton!);

    expect(screen.getAllByText('Ejecutivo INCONNECT').length).toBeGreaterThan(
      0,
    );
    expect(
      screen
        .getByLabelText('Add role policy')
        .querySelector(`option[value="${ROLE_IDS.executive}"]`),
    ).toBeNull();

    fireEvent.click(screen.getByLabelText('Remove role policy'));

    expect(
      screen.getByText('No roles currently have access to this object.'),
    ).toBeInTheDocument();
  });

  it('updates owner requirement and filters owner fields from backend metadata', () => {
    const secondFieldId = '30000000-0000-4000-8000-000000000099';
    const expandedMetadata = {
      ...metadata,
      objects: metadata.objects.map((objectMetadata) =>
        objectMetadata.objectMetadataId === OBJECT_IDS.lead
          ? {
              ...objectMetadata,
              ownerFields: [
                ...objectMetadata.ownerFields,
                {
                  ...objectMetadata.ownerFields[0],
                  fieldMetadataId: secondFieldId,
                  label: 'Alternate owner',
                },
              ],
            }
          : objectMetadata,
      ),
    };

    render(
      <Harness
        initialDraft={objectWithoutPoliciesDraft()}
        availableMetadata={expandedMetadata}
      />,
    );

    expect(
      screen.getByLabelText('Owner field').querySelectorAll('option'),
    ).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Owner requirement'), {
      target: { value: InconnectRecordAccessOwnerRequirement.optional },
    });

    expect(screen.getByLabelText('Owner requirement')).toHaveValue(
      InconnectRecordAccessOwnerRequirement.optional,
    );
  });

  it('warns before removing an object from the local draft', () => {
    render(<Harness initialDraft={objectWithoutPoliciesDraft()} />);

    fireEvent.click(screen.getByLabelText('Remove managed object'));

    expect(mockOpenModal).toHaveBeenCalledWith(
      'inconnect-record-access-remove-object-modal',
    );

    fireEvent.click(screen.getByText('Remove object'));

    expect(
      screen.queryByLabelText('Remove managed object'),
    ).not.toBeInTheDocument();
  });
});
