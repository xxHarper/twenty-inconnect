import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingConversationContextPanel } from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel';
import { useInconnectMessagingConversationContext } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationContext';
import {
  InconnectMessagingContextState,
  InconnectMessagingContextValueKind,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockCloseModal = jest.fn();

jest.mock(
  '@/inconnect-messaging/hooks/useInconnectMessagingConversationContext',
);
jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({ closeModal: mockCloseModal }),
}));
jest.mock('@/ui/layout/modal/components/ModalStatefulWrapper', () => ({
  ModalStatefulWrapper: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

const mockUseContext = jest.mocked(useInconnectMessagingConversationContext);

const valueKinds = Object.values(InconnectMessagingContextValueKind);

const linkedContext = {
  state: InconnectMessagingContextState.LINKED,
  object: { objectMetadataId: 'object-id', label: 'Customer' },
  record: { recordId: 'private-record-id', recordLabel: 'Ada Lovelace' },
  fields: valueKinds.map((valueKind, ordinal) => ({
    fieldMetadataId: `field-${ordinal}`,
    label: `Label ${ordinal}`,
    valueKind,
    displayValue: ordinal === 1 ? null : `Server value ${ordinal}`,
    ordinal: valueKinds.length - ordinal,
  })),
};

const renderPanel = (displayMode: 'desktop' | 'modal' = 'desktop') => {
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);

  return render(
    <I18nProvider i18n={i18n}>
      <InconnectMessagingConversationContextPanel
        conversationId="conversation-1"
        refreshNonce={0}
        displayMode={displayMode}
        modalInstanceId="context-modal"
        onUnavailable={jest.fn()}
      />
    </I18nProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseContext.mockReturnValue({
    conversationId: 'conversation-1',
    status: 'ready',
    context: linkedContext,
  });
});

describe('InconnectMessagingConversationContextPanel', () => {
  it('renders the generic linked summary and backend display values in server order', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'CRM context' })).toBeVisible();
    expect(screen.getByText('Customer')).toBeVisible();
    expect(screen.getByText('Ada Lovelace')).toBeVisible();

    const labels = screen.getAllByText(/^Label /);
    expect(labels.map((label) => label.textContent)).toEqual(
      valueKinds.map((_, ordinal) => `Label ${ordinal}`),
    );
    expect(screen.getByLabelText('No value')).toHaveTextContent('—');

    valueKinds.forEach((valueKind, ordinal) => {
      const row = screen.getByText(`Label ${ordinal}`).closest('div');
      expect(row).toHaveAttribute('data-value-kind', valueKind);
      if (ordinal !== 1) {
        expect(screen.getByText(`Server value ${ordinal}`)).toBeVisible();
      }
    });
  });

  it('keeps the linked summary visible with zero configured fields', () => {
    mockUseContext.mockReturnValue({
      conversationId: 'conversation-1',
      status: 'ready',
      context: { ...linkedContext, fields: [] },
    });

    renderPanel();

    expect(screen.getByText('Customer')).toBeVisible();
    expect(screen.getByText('Ada Lovelace')).toBeVisible();
    expect(screen.getByText('No context fields configured.')).toBeVisible();
  });

  it('uses a neutral label when the canonical record label is null', () => {
    mockUseContext.mockReturnValue({
      conversationId: 'conversation-1',
      status: 'ready',
      context: {
        ...linkedContext,
        record: { ...linkedContext.record, recordLabel: null },
        fields: [],
      },
    });

    renderPanel();

    expect(screen.getByText('Unlabeled record')).toBeVisible();
    expect(screen.queryByText('private-record-id')).not.toBeInTheDocument();
  });

  it('renders UNASSIGNED without fields or linking actions', () => {
    mockUseContext.mockReturnValue({
      conversationId: 'conversation-1',
      status: 'ready',
      context: {
        state: InconnectMessagingContextState.UNASSIGNED,
        object: null,
        record: null,
        fields: [],
      },
    });

    renderPanel();

    expect(screen.getByText('No CRM record linked.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /link|create|match/i }),
    ).not.toBeInTheDocument();
  });

  it('distinguishes loading and safe unavailable states without exposing errors', () => {
    mockUseContext.mockReturnValue({
      conversationId: 'conversation-1',
      status: 'loading',
      context: null,
    });
    const panel = renderPanel();

    expect(
      screen.getByRole('status', { name: 'Loading CRM context' }),
    ).toBeVisible();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();

    mockUseContext.mockReturnValue({
      conversationId: 'conversation-1',
      status: 'error',
      context: null,
    });
    panel.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingConversationContextPanel
          conversationId="conversation-1"
          refreshNonce={0}
          displayMode="desktop"
          modalInstanceId="context-modal"
          onUnavailable={jest.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'CRM context is unavailable.',
    );
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByText(/sql|stack|forbidden/i)).not.toBeInTheDocument();
  });

  it('uses the existing modal interaction and closes accessibly', () => {
    renderPanel('modal');

    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close CRM context' }));
    expect(mockCloseModal).toHaveBeenCalledWith('context-modal');
  });
});
