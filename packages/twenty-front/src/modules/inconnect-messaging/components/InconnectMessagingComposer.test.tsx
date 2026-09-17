import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingComposer } from '@/inconnect-messaging/components/InconnectMessagingComposer';
import { type InconnectMessagingSendCapabilitiesQuery } from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockRefetchCapabilities = jest.fn();
const mockLoadTemplates = jest.fn();
const mockSendMessage = jest.fn();
const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
let mockSendLoading = false;
let mockCapabilities: NonNullable<
  InconnectMessagingSendCapabilitiesQuery['inconnectMessagingSendCapabilities']
> = {
  canSend: true,
  canSendFreeform: true,
  canSendTemplate: true,
  sessionWindowState: 'OPEN',
  freeformWindowExpiresAt: null,
  freeformUnavailableReason: null,
  templateUnavailableReason: null,
};

const template = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Appointment reminder',
  language: 'es',
  body: 'Hola {{1}}',
  variables: [{ key: '1', required: true, maxLength: 1600 }],
};

jest.mock('@apollo/client/react', () => ({
  useQuery: () => ({
    data: { inconnectMessagingSendCapabilities: mockCapabilities },
    loading: false,
    error: undefined,
    refetch: mockRefetchCapabilities,
  }),
  useLazyQuery: () => [
    mockLoadTemplates,
    {
      data: { inconnectMessagingTemplates: [template] },
      loading: false,
      error: undefined,
    },
  ],
  useMutation: () => [mockSendMessage, { loading: mockSendLoading }],
}));

jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({ openModal: mockOpenModal, closeModal: mockCloseModal }),
}));

jest.mock('@/ui/input/components/TextArea', () => ({
  TextArea: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock(
  '@/inconnect-messaging/components/InconnectMessagingTemplatePicker',
  () => ({
    InconnectMessagingTemplatePicker: ({
      onSelect,
      onVariableChange,
      onSend,
    }: {
      onSelect: (value: typeof template) => void;
      onVariableChange: (key: string, value: string) => void;
      onSend: () => void;
    }) => (
      <div>
        <button type="button" onClick={() => onSelect(template)}>
          Choose template
        </button>
        <button type="button" onClick={() => onVariableChange('1', 'Ana')}>
          Fill variable
        </button>
        <button type="button" onClick={onSend}>
          Confirm template
        </button>
      </div>
    ),
  }),
);

const renderComposer = ({
  onAccepted = jest.fn(),
  onUnavailable = jest.fn(),
}: {
  onAccepted?: jest.Mock;
  onUnavailable?: jest.Mock;
} = {}) => {
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);

  return render(
    <I18nProvider i18n={i18n}>
      <InconnectMessagingComposer
        conversationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        refreshNonce={0}
        onAccepted={onAccepted}
        onUnavailable={onUnavailable}
      />
    </I18nProvider>,
  );
};

describe('InconnectMessagingComposer', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockCapabilities = {
      canSend: true,
      canSendFreeform: true,
      canSendTemplate: true,
      sessionWindowState: 'OPEN',
      freeformWindowExpiresAt: null,
      freeformUnavailableReason: null,
      templateUnavailableReason: null,
    };
    mockSendLoading = false;
    mockRefetchCapabilities.mockResolvedValue({});
    mockLoadTemplates.mockResolvedValue({});
    mockSendMessage.mockResolvedValue({
      data: {
        sendInconnectMessagingMessage: {
          messageId: 'message-id',
          outboundState: 'QUEUED',
        },
      },
    });
  });

  it('shows the free-form composer only while the backend capability is open', () => {
    const view = renderComposer();

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Send\b/ })).toBeDisabled();

    mockCapabilities = {
      ...mockCapabilities,
      canSendFreeform: false,
      sessionWindowState: 'CLOSED',
      freeformUnavailableReason: 'SESSION_WINDOW_CLOSED',
    };
    view.rerender(
      <I18nProvider i18n={i18n}>
        <InconnectMessagingComposer
          conversationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          refreshNonce={0}
          onAccepted={jest.fn()}
          onUnavailable={jest.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getByText(/service window is closed/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Use template\b/ }),
    ).toBeEnabled();
  });

  it('sends free-form through the generated mutation contract', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    renderComposer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hola' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });
    expect(mockSendMessage).toHaveBeenCalledWith({
      variables: {
        input: {
          conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          clientRequestId: '11111111-1111-4111-8111-111111111111',
          mode: 'FREEFORM',
          body: 'Hola',
        },
      },
    });
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(mockRefetchCapabilities).toHaveBeenCalled();
  });

  it('disables composer actions while a send is pending', () => {
    mockSendLoading = true;
    renderComposer();

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Sending\b/ })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /^Use template\b/ }),
    ).toBeDisabled();
  });

  it('retains the same clientRequestId for an uncertain retry', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    mockSendMessage.mockRejectedValue(new Error('network uncertain'));
    renderComposer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hola' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(
      mockSendMessage.mock.calls.map(
        ([request]) => request.variables.input.clientRequestId,
      ),
    ).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });

  it('loads, completes, and sends a normalized template', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: /^Use template\b/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill variable' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm template' }));
    });

    expect(mockLoadTemplates).toHaveBeenCalledWith({
      variables: {
        conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    });
    expect(mockSendMessage).toHaveBeenCalledWith({
      variables: {
        input: {
          conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          clientRequestId: '11111111-1111-4111-8111-111111111111',
          mode: 'TEMPLATE',
          templateId: template.id,
          templateVariables: [{ key: '1', value: 'Ana' }],
        },
      },
    });
  });

  it('refreshes capabilities when the server closes the free-form window', async () => {
    mockSendMessage.mockRejectedValue(
      new CombinedGraphQLErrors({
        data: null,
        errors: [
          {
            message: 'Closed',
            extensions: {
              code: 'BAD_USER_INPUT',
              subCode: 'SESSION_WINDOW_CLOSED',
            },
          },
        ],
      }),
    );
    renderComposer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hola' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });

    expect(mockRefetchCapabilities).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/window has closed/i);
  });

  it('clears the intent and closes access after authorization is lost', async () => {
    const onUnavailable = jest.fn();

    mockSendMessage.mockRejectedValue(
      new CombinedGraphQLErrors({
        data: null,
        errors: [
          {
            message: 'Not found',
            extensions: { code: 'NOT_FOUND' },
          },
        ],
      }),
    );
    renderComposer({ onUnavailable });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Hola' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });
});
