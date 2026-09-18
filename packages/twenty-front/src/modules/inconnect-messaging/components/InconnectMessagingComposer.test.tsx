import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingComposer } from '@/inconnect-messaging/components/InconnectMessagingComposer';
import {
  CompleteInconnectMessagingOutboundUploadDocument,
  CreateInconnectMessagingOutboundUploadDocument,
  type InconnectMessagingSendCapabilitiesQuery,
} from '~/generated-metadata/graphql';
import { messages } from '~/locales/generated/en';

const mockRefetchCapabilities = jest.fn();
const mockLoadTemplates = jest.fn();
const mockSendMessage = jest.fn();
const mockCreateUpload = jest.fn();
const mockCompleteUpload = jest.fn();
const mockUploadFileToUrl = jest.fn();
const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
let mockSendLoading = false;
let mockCapabilities: NonNullable<
  InconnectMessagingSendCapabilitiesQuery['inconnectMessagingSendCapabilities']
> = {
  canSend: true,
  canSendFreeform: true,
  canSendTemplate: true,
  canSendMedia: true,
  maxMediaItems: 1,
  mediaTypes: [
    {
      type: 'IMAGE',
      mimeTypes: ['image/png', 'image/jpeg'],
      maxBytes: 5 * 1024 * 1024,
      captionSupported: true,
    },
    {
      type: 'AUDIO',
      mimeTypes: ['audio/mpeg'],
      maxBytes: 16 * 1024 * 1024,
      captionSupported: false,
    },
  ],
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
  useMutation: (document: unknown) =>
    document === CreateInconnectMessagingOutboundUploadDocument
      ? [mockCreateUpload, { loading: false }]
      : document === CompleteInconnectMessagingOutboundUploadDocument
        ? [mockCompleteUpload, { loading: false }]
        : [mockSendMessage, { loading: mockSendLoading }],
}));

jest.mock('@/file/utils/uploadFileToUrl', () => ({
  uploadFileToUrl: (...arguments_: unknown[]) =>
    mockUploadFileToUrl(...arguments_),
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

const getFileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');

  if (!input) throw new Error('File input not found');

  return input;
};

describe('InconnectMessagingComposer', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    i18n.load(SOURCE_LOCALE, messages);
    i18n.activate(SOURCE_LOCALE);
    mockCreateUpload.mockReset();
    mockCompleteUpload.mockReset();
    mockUploadFileToUrl.mockReset();
    mockCapabilities = {
      canSend: true,
      canSendFreeform: true,
      canSendTemplate: true,
      canSendMedia: true,
      maxMediaItems: 1,
      mediaTypes: [
        {
          type: 'IMAGE',
          mimeTypes: ['image/png', 'image/jpeg'],
          maxBytes: 5 * 1024 * 1024,
          captionSupported: true,
        },
        {
          type: 'AUDIO',
          mimeTypes: ['audio/mpeg'],
          maxBytes: 16 * 1024 * 1024,
          captionSupported: false,
        },
      ],
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
    mockCreateUpload.mockResolvedValue({
      data: {
        createInconnectMessagingOutboundUpload: {
          uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          state: 'PENDING',
          type: 'IMAGE',
          filename: 'photo.png',
          size: 4,
          contentType: null,
          uploadUrl: 'https://upload.example.com/capability',
          uploadContentType: 'application/octet-stream',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    mockUploadFileToUrl.mockResolvedValue(undefined);
    mockCompleteUpload.mockResolvedValue({
      data: {
        completeInconnectMessagingOutboundUpload: {
          uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          state: 'AVAILABLE',
          type: 'IMAGE',
          filename: 'photo.png',
          size: 4,
          contentType: 'image/png',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
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
    expect(
      screen.getAllByText(/service window is closed/i).length,
    ).toBeGreaterThan(0);
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
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
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

  it('shows a capability-driven single-file picker and rejects obvious invalid files', () => {
    renderComposer();
    const input = getFileInput();

    expect(screen.getByRole('button', { name: 'Attach file' })).toBeEnabled();
    expect(input).toHaveAttribute('accept', 'audio/mpeg,image/jpeg,image/png');

    fireEvent.change(input, {
      target: {
        files: [new File(['data'], 'unsafe.svg', { type: 'image/svg+xml' })],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/unsupported file/i);
    expect(mockCreateUpload).not.toHaveBeenCalled();

    const oversized = new File(['data'], 'large.png', { type: 'image/png' });

    Object.defineProperty(oversized, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/file too large/i);
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  it('disables media selection outside the free-form session window', () => {
    mockCapabilities = {
      ...mockCapabilities,
      canSendFreeform: false,
      canSendMedia: false,
      sessionWindowState: 'CLOSED',
    };
    renderComposer();

    expect(screen.getByRole('button', { name: 'Attach file' })).toBeDisabled();
    expect(screen.getByText(/media is unavailable/i)).toBeInTheDocument();
  });

  it('stages, transfers, completes, and sends only the opaque upload id', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });

    expect(screen.getByText(/uploading/i)).toBeInTheDocument();
    await screen.findByText(/ready/i);
    expect(mockCreateUpload).toHaveBeenCalledWith({
      variables: {
        input: {
          clientUploadId: '11111111-1111-4111-8111-111111111111',
          filename: 'photo.png',
          size: 4,
          type: 'IMAGE',
        },
      },
    });
    expect(mockUploadFileToUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadUrl: 'https://upload.example.com/capability',
        contentType: 'application/octet-stream',
      }),
    );
    expect(mockCompleteUpload).toHaveBeenCalledWith({
      variables: { uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Caption' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });

    const input = mockSendMessage.mock.calls[0][0].variables.input;

    expect(input).toEqual({
      conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      clientRequestId: expect.any(String),
      mode: 'FREEFORM',
      body: 'Caption',
      outboundUploadIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    });
    expect(input).not.toHaveProperty('fileId');
    expect(input).not.toHaveProperty('uploadUrl');
    expect(input).not.toHaveProperty('providerToken');
    expect(input.clientRequestId).not.toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('retries one upload intention with the same clientUploadId', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');
    mockUploadFileToUrl
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });

    await screen.findByText(/upload failed/i);
    fireEvent.click(screen.getByRole('button', { name: /^Retry\b/ }));
    await screen.findByText(/ready/i);

    expect(
      mockCreateUpload.mock.calls.map(
        ([request]) => request.variables.input.clientUploadId,
      ),
    ).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('keeps removal available but blocks upload retry after the session closes', async () => {
    mockUploadFileToUrl.mockRejectedValue(new Error('network'));
    const view = renderComposer();

    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/upload failed/i);

    mockCapabilities = {
      ...mockCapabilities,
      canSendFreeform: false,
      canSendMedia: false,
      sessionWindowState: 'CLOSED',
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

    expect(screen.getByRole('button', { name: /^Retry\b/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Remove\b/ })).toBeEnabled();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });

  it('aborts and cleans up a selected upload before allowing a new intention', async () => {
    let uploadSignal: AbortSignal | undefined;

    mockUploadFileToUrl.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) => {
        uploadSignal = signal;

        return new Promise<void>(() => undefined);
      },
    );
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });
    await waitFor(() => expect(uploadSignal).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /^Remove\b/ }));

    expect(uploadSignal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeEnabled();
  });

  it('does not let a removed upload overwrite a later attachment when it resolves late', async () => {
    let resolveFirstUpload: (() => void) | undefined;

    mockCreateUpload.mockImplementation(
      ({ variables }: { variables: { input: { filename: string } } }) => {
        const isFirstFile = variables.input.filename === 'first.png';

        return Promise.resolve({
          data: {
            createInconnectMessagingOutboundUpload: {
              uploadId: isFirstFile ? 'upload-first' : 'upload-second',
              state: 'PENDING',
              type: 'IMAGE',
              filename: variables.input.filename,
              size: 4,
              contentType: null,
              uploadUrl: `https://upload.example.com/${variables.input.filename}`,
              uploadContentType: 'application/octet-stream',
              expiresAt: '2026-09-19T00:00:00.000Z',
            },
          },
        });
      },
    );
    mockUploadFileToUrl
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstUpload = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    mockCompleteUpload.mockResolvedValue({
      data: {
        completeInconnectMessagingOutboundUpload: {
          uploadId: 'upload-second',
          state: 'AVAILABLE',
          type: 'IMAGE',
          filename: 'second.png',
          size: 4,
          contentType: 'image/png',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    renderComposer();

    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'first.png', { type: 'image/png' })],
      },
    });
    await screen.findByText('first.png');
    fireEvent.click(screen.getByRole('button', { name: /^Remove\b/ }));
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['next'], 'second.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);

    await act(async () => resolveFirstUpload?.());

    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.queryByText('first.png')).not.toBeInTheDocument();
    expect(mockCompleteUpload).toHaveBeenCalledTimes(1);
    expect(mockCompleteUpload).toHaveBeenCalledWith({
      variables: { uploadId: 'upload-second' },
    });
  });

  it('does not let a late upload from the previous conversation mutate the new composer', async () => {
    let resolveFirstUpload: (() => void) | undefined;

    mockCreateUpload.mockImplementation(
      ({ variables }: { variables: { input: { filename: string } } }) => {
        const isOldConversationFile = variables.input.filename === 'old.png';

        return Promise.resolve({
          data: {
            createInconnectMessagingOutboundUpload: {
              uploadId: isOldConversationFile ? 'upload-old' : 'upload-new',
              state: 'PENDING',
              type: 'IMAGE',
              filename: variables.input.filename,
              size: 4,
              contentType: null,
              uploadUrl: `https://upload.example.com/${variables.input.filename}`,
              uploadContentType: 'application/octet-stream',
              expiresAt: '2026-09-19T00:00:00.000Z',
            },
          },
        });
      },
    );
    mockUploadFileToUrl
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstUpload = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    mockCompleteUpload.mockResolvedValue({
      data: {
        completeInconnectMessagingOutboundUpload: {
          uploadId: 'upload-new',
          state: 'AVAILABLE',
          type: 'IMAGE',
          filename: 'new.png',
          size: 4,
          contentType: 'image/png',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    const renderForConversation = (conversationId: string) => (
      <I18nProvider i18n={i18n}>
        <InconnectMessagingComposer
          key={conversationId}
          conversationId={conversationId}
          refreshNonce={0}
          onAccepted={jest.fn()}
          onUnavailable={jest.fn()}
        />
      </I18nProvider>
    );
    const view = render(renderForConversation('conversation-a'));

    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'old.png', { type: 'image/png' })],
      },
    });
    await screen.findByText('old.png');
    view.rerender(renderForConversation('conversation-b'));
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['next'], 'new.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);

    await act(async () => resolveFirstUpload?.());

    expect(screen.getByText('new.png')).toBeInTheDocument();
    expect(screen.queryByText('old.png')).not.toBeInTheDocument();
    expect(mockCompleteUpload).toHaveBeenCalledTimes(1);
    expect(mockCompleteUpload).toHaveBeenCalledWith({
      variables: { uploadId: 'upload-new' },
    });
  });

  it('blocks unsupported captions and keeps attachment and template modes separate', async () => {
    mockCreateUpload.mockResolvedValue({
      data: {
        createInconnectMessagingOutboundUpload: {
          uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          state: 'PENDING',
          type: 'AUDIO',
          filename: 'voice.mp3',
          size: 4,
          contentType: null,
          uploadUrl: 'https://upload.example.com/capability',
          uploadContentType: 'application/octet-stream',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    mockCompleteUpload.mockResolvedValue({
      data: {
        completeInconnectMessagingOutboundUpload: {
          uploadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          state: 'AVAILABLE',
          type: 'AUDIO',
          filename: 'voice.mp3',
          size: 4,
          contentType: 'audio/mpeg',
          expiresAt: '2026-09-19T00:00:00.000Z',
        },
      },
    });
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'voice.mp3', { type: 'audio/mpeg' })],
      },
    });
    await screen.findByText(/ready/i);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Do not discard me' },
    });

    expect(screen.getByText(/caption unsupported/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Do not discard me',
    );
    expect(screen.getByRole('button', { name: /^Send\b/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^Use template\b/ }));
    expect(mockOpenModal).not.toHaveBeenCalled();
    expect(
      screen.getByText(/remove the attachment before choosing a template/i),
    ).toBeInTheDocument();
  });

  it('retries a completion failure without changing the upload intention', async () => {
    mockCompleteUpload.mockRejectedValueOnce(new Error('completion failed'));
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });

    await screen.findByText(/could not be processed/i);
    expect(screen.getByRole('button', { name: /^Send\b/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Retry\b/ }));
    await screen.findByText(/ready/i);

    const uploadIds = mockCreateUpload.mock.calls.map(
      ([request]) => request.variables.input.clientUploadId,
    );

    expect(uploadIds).toHaveLength(2);
    expect(uploadIds[0]).toBe(uploadIds[1]);
  });

  it('creates a new upload intention after remove and reselect', async () => {
    renderComposer();
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'first.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);
    fireEvent.click(screen.getByRole('button', { name: /^Remove\b/ }));
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['next'], 'second.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);

    const uploadIds = mockCreateUpload.mock.calls.map(
      ([request]) => request.variables.input.clientUploadId,
    );

    expect(uploadIds).toHaveLength(2);
    expect(uploadIds[0]).not.toBe(uploadIds[1]);
  });

  it('cleans the attachment when conversation access is lost', async () => {
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
    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send\b/ }));
    });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('clears an active attachment when the conversation component switches', async () => {
    const renderForConversation = (conversationId: string) => (
      <I18nProvider i18n={i18n}>
        <InconnectMessagingComposer
          key={conversationId}
          conversationId={conversationId}
          refreshNonce={0}
          onAccepted={jest.fn()}
          onUnavailable={jest.fn()}
        />
      </I18nProvider>
    );
    const view = render(renderForConversation('conversation-a'));

    fireEvent.change(getFileInput(), {
      target: {
        files: [new File(['data'], 'photo.png', { type: 'image/png' })],
      },
    });
    await screen.findByText(/ready/i);
    view.rerender(renderForConversation('conversation-b'));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });
});
