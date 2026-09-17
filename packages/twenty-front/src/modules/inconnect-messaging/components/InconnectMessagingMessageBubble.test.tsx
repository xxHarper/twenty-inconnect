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
  sendMode: null,
  outboundState: null,
  displayAt: '2026-09-14T12:00:00.000Z',
  location: null,
  media: [],
  template: null,
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

  it('renders emoji and Unicode text without normalization loss', () => {
    const body = '¡Hola, Jose\u0301! 👩🏽‍💻 مرحبا';

    renderMessage({ ...baseMessage, body });
    expect(screen.getByText(body)).toBeInTheDocument();
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

  it('renders an available image through the authorized attachment route', () => {
    renderMessage({
      ...baseMessage,
      type: 'IMAGE',
      media: [
        {
          id: 'attachment-id',
          type: 'IMAGE',
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          size: 3,
          availabilityState: 'AVAILABLE',
          accessUrl: '/inconnect-messaging/attachments/attachment-id',
        },
      ],
    });

    expect(screen.getByRole('img', { name: 'photo.jpg' })).toHaveAttribute(
      'src',
      expect.stringContaining('/inconnect-messaging/attachments/attachment-id'),
    );
  });

  it('renders an available document without exposing a storage URL', () => {
    renderMessage({
      ...baseMessage,
      type: 'DOCUMENT',
      media: [
        {
          id: 'attachment-id',
          type: 'DOCUMENT',
          filename: 'report.pdf',
          contentType: 'application/pdf',
          size: 2048,
          availabilityState: 'AVAILABLE',
          accessUrl: '/inconnect-messaging/attachments/attachment-id',
        },
      ],
    });

    const link = screen.getByRole('link', { name: 'report.pdf' });

    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/inconnect-messaging/attachments/attachment-id'),
    );
    expect(link.getAttribute('href')).not.toContain('twilio.com');
    expect(link.getAttribute('href')).not.toContain('amazonaws.com');
    expect(screen.getByText('2 kB')).toBeInTheDocument();
  });

  it('renders an available sticker with its compact visual treatment', () => {
    renderMessage({
      ...baseMessage,
      type: 'STICKER',
      media: [
        {
          id: 'sticker-id',
          type: 'STICKER',
          filename: 'sticker.webp',
          contentType: 'image/webp',
          size: 512,
          availabilityState: 'AVAILABLE',
          accessUrl: '/inconnect-messaging/attachments/sticker-id',
        },
      ],
    });

    expect(screen.getByRole('img', { name: 'Sticker' })).toHaveAttribute(
      'src',
      expect.stringContaining('/attachments/sticker-id'),
    );
  });

  it.each([
    ['AUDIO', 'audio', 'voice.ogg', 'audio/ogg'],
    ['VIDEO', 'video', 'clip.mp4', 'video/mp4'],
  ])(
    'renders the authorized %s player',
    (type, elementName, filename, contentType) => {
      const { container } = renderMessage({
        ...baseMessage,
        type,
        media: [
          {
            id: 'media-id',
            type,
            filename,
            contentType,
            size: 1024,
            availabilityState: 'AVAILABLE',
            accessUrl: '/inconnect-messaging/attachments/media-id',
          },
        ],
      });
      const mediaElement = container.querySelector(elementName);

      expect(mediaElement).toHaveAttribute('controls');
      expect(mediaElement).toHaveAttribute(
        'src',
        expect.stringContaining('/attachments/media-id'),
      );
    },
  );

  it('renders a contact card with an authorized vCard download', () => {
    renderMessage({
      ...baseMessage,
      type: 'CONTACT',
      media: [
        {
          id: 'contact-id',
          type: 'CONTACT',
          filename: 'contact.vcf',
          contentType: 'text/vcard',
          size: 256,
          availabilityState: 'AVAILABLE',
          accessUrl: '/inconnect-messaging/attachments/contact-id',
        },
      ],
    });

    expect(screen.getByText('Shared contact')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contact.vcf' })).toHaveAttribute(
      'href',
      expect.stringContaining('/attachments/contact-id'),
    );
  });

  it.each([
    ['PENDING', 'Processing attachment…'],
    ['PROCESSING', 'Processing attachment…'],
    ['FAILED', 'File unavailable'],
    ['EXPIRED', 'File unavailable'],
  ])('renders attachment state %s safely', (availabilityState, label) => {
    renderMessage({
      ...baseMessage,
      type: 'AUDIO',
      media: [
        {
          id: 'attachment-id',
          type: 'AUDIO',
          filename: 'voice.ogg',
          contentType: 'audio/ogg',
          size: null,
          availabilityState,
          accessUrl: null,
        },
      ],
    });

    expect(screen.getByText(label)).toBeInTheDocument();
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

  it('renders the persisted template audit without consulting the catalog', () => {
    renderMessage({
      ...baseMessage,
      direction: 'OUTBOUND',
      sendMode: 'TEMPLATE',
      outboundState: 'SENT',
      body: 'Hola Ana',
      template: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        displayName: 'Appointment reminder',
        language: 'es',
        variables: [{ key: '1', value: 'Ana' }],
      },
    });

    expect(
      screen.getByText(/Template.*Appointment reminder.*es/),
    ).toBeInTheDocument();
    expect(screen.getByText('Hola Ana')).toBeInTheDocument();
  });
});
