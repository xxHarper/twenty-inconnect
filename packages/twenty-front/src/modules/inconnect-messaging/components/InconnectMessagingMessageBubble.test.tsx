import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { InconnectMessagingMessageBubble } from '@/inconnect-messaging/components/InconnectMessagingMessageBubble';
import type { InconnectMessagingMessage } from '@/inconnect-messaging/types/InconnectMessagingRead';
import { messages } from '~/locales/generated/en';

const baseMessage: InconnectMessagingMessage = {
  id: 'message-id',
  direction: 'INBOUND',
  type: 'TEXT',
  body: 'Hello',
  outboundState: null,
  displayAt: '2026-09-14T12:00:00.000Z',
  location: null,
  media: [],
};

const renderMessage = (message: InconnectMessagingMessage) => {
  i18n.load(SOURCE_LOCALE, messages);
  i18n.activate(SOURCE_LOCALE);
  return render(
    <I18nProvider i18n={i18n}>
      <InconnectMessagingMessageBubble message={message} />
    </I18nProvider>,
  );
};

describe('InconnectMessagingMessageBubble', () => {
  it('renders inbound text with direction', () => {
    renderMessage(baseMessage);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByLabelText('Incoming message')).toBeInTheDocument();
  });

  it.each([
    'QUEUED',
    'SENDING',
    'SENT',
    'DELIVERED',
    'READ',
    'FAILED',
    'UNKNOWN',
  ])('renders outbound state %s', (outboundState) => {
    renderMessage({ ...baseMessage, direction: 'OUTBOUND', outboundState });
    expect(screen.getByLabelText('Outgoing message')).toHaveTextContent(
      outboundState === 'UNKNOWN'
        ? 'Status unknown'
        : outboundState.charAt(0) + outboundState.slice(1).toLowerCase(),
    );
  });

  it.each([
    ['IMAGE', 'Image received'],
    ['AUDIO', 'Audio received'],
    ['VIDEO', 'Video received'],
    ['DOCUMENT', 'Document received'],
  ])('shows a safe placeholder for %s', (type, label) => {
    renderMessage({
      ...baseMessage,
      type,
      media: [{ contentType: 'image/jpeg' }],
    });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('image/jpeg')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows structured location without a media link', () => {
    renderMessage({
      ...baseMessage,
      type: 'LOCATION',
      location: {
        latitude: '1',
        longitude: '2',
        label: 'Office',
        name: null,
        address: 'Main Street',
      },
    });
    expect(screen.getByText(/Office/)).toBeInTheDocument();
    expect(screen.getByText('Main Street')).toBeInTheDocument();
    expect(screen.getByText(/1, 2/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
