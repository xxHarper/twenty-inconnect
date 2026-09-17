import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import type { InconnectMessagingMessage } from '@/inconnect-messaging/types/InconnectMessagingRead';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

const StyledRow = styled.div<{ isOutbound: boolean }>`
  display: flex;
  justify-content: ${({ isOutbound }) =>
    isOutbound ? 'flex-end' : 'flex-start'};
`;

const StyledBubble = styled.div<{ isOutbound: boolean }>`
  background: ${({ isOutbound }) =>
    isOutbound
      ? themeCssVariables.background.transparent.blue
      : themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.lg};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  max-width: min(75%, 560px);
  overflow-wrap: anywhere;
  padding: ${themeCssVariables.spacing[3]};
  white-space: pre-wrap;
`;

const StyledMeta = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
  margin-top: ${themeCssVariables.spacing[2]};
`;

const StyledTemplateLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin-bottom: ${themeCssVariables.spacing[2]};
`;

const StyledAttachmentList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledMedia = styled.img`
  border-radius: ${themeCssVariables.border.radius.md};
  display: block;
  max-height: 360px;
  max-width: 100%;
  object-fit: contain;
`;

const StyledSticker = styled(StyledMedia)`
  background: transparent;
  max-height: 220px;
  width: 220px;
`;

const StyledAudio = styled.audio`
  max-width: 100%;
`;

const StyledVideo = styled.video`
  border-radius: ${themeCssVariables.border.radius.md};
  max-height: 360px;
  max-width: 100%;
`;

const StyledAttachmentLink = styled.a`
  color: ${themeCssVariables.font.color.primary};
  text-decoration: underline;
`;

type InconnectMessagingMessageBubbleProps = {
  message: InconnectMessagingMessage;
};

export const InconnectMessagingMessageBubble = ({
  message,
}: InconnectMessagingMessageBubbleProps) => {
  const { t, i18n } = useLingui();
  const isOutbound = message.direction === 'OUTBOUND';
  const location = message.location;

  const formatSize = (size: number | null | undefined) =>
    size === null || size === undefined
      ? null
      : new Intl.NumberFormat(i18n.locale, {
          style: 'unit',
          unit: 'kilobyte',
          maximumFractionDigits: 1,
        }).format(size / 1024);

  const absoluteAttachmentUrl = (accessUrl: string) =>
    new URL(accessUrl, REACT_APP_SERVER_BASE_URL).toString();

  const statusLabel = (() => {
    if (!isOutbound) return null;
    switch (message.outboundState) {
      case 'QUEUED':
        return t`Queued`;
      case 'SENDING':
        return t`Sending`;
      case 'SENT':
        return t`Sent`;
      case 'DELIVERED':
        return t`Delivered`;
      case 'READ':
        return t`Read`;
      case 'FAILED':
        return t`Failed`;
      case 'UNKNOWN':
        return t`Status unknown`;
      default:
        return null;
    }
  })();

  return (
    <StyledRow isOutbound={isOutbound}>
      <StyledBubble
        isOutbound={isOutbound}
        aria-label={isOutbound ? t`Outgoing message` : t`Incoming message`}
      >
        {message.template && (
          <StyledTemplateLabel>
            {t`Template`}: {message.template.displayName} ·{' '}
            {message.template.language}
          </StyledTemplateLabel>
        )}
        {message.type === 'TEXT' && <div>{message.body}</div>}
        {message.type === 'LOCATION' && (
          <div>
            <div>
              {t`Location`}:{' '}
              {location?.label ||
                location?.name ||
                location?.address ||
                t`Shared location`}
            </div>
            {location?.address && location.address !== location.label && (
              <div>{location.address}</div>
            )}
            {location && (
              <div>
                {location.latitude}, {location.longitude}
              </div>
            )}
          </div>
        )}
        {message.media.length > 0 && (
          <StyledAttachmentList>
            {message.media.map((attachment, index) => {
              const key = attachment.id ?? `legacy-${index}`;

              if (
                attachment.availabilityState === 'PENDING' ||
                attachment.availabilityState === 'PROCESSING'
              ) {
                return <div key={key}>{t`Processing attachment…`}</div>;
              }

              if (
                attachment.availabilityState !== 'AVAILABLE' ||
                !attachment.accessUrl
              ) {
                return <div key={key}>{t`File unavailable`}</div>;
              }

              const source = absoluteAttachmentUrl(attachment.accessUrl);

              switch (attachment.type) {
                case 'IMAGE':
                  return (
                    <StyledMedia
                      key={key}
                      src={source}
                      alt={attachment.filename || t`Received image`}
                      loading="lazy"
                    />
                  );
                case 'STICKER':
                  return (
                    <StyledSticker
                      key={key}
                      src={source}
                      alt={t`Sticker`}
                      loading="lazy"
                    />
                  );
                case 'AUDIO':
                  return (
                    <StyledAudio
                      key={key}
                      controls
                      preload="metadata"
                      src={source}
                    >
                      {t`Audio playback is not supported by this browser.`}
                    </StyledAudio>
                  );
                case 'VIDEO':
                  return (
                    <StyledVideo
                      key={key}
                      controls
                      preload="metadata"
                      src={source}
                    >
                      {t`Video playback is not supported by this browser.`}
                    </StyledVideo>
                  );
                case 'CONTACT':
                  return (
                    <div key={key}>
                      <div>{t`Shared contact`}</div>
                      <StyledAttachmentLink href={source}>
                        {attachment.filename || t`Download vCard`}
                      </StyledAttachmentLink>
                    </div>
                  );
                default:
                  return (
                    <div key={key}>
                      <StyledAttachmentLink href={source}>
                        {attachment.filename || t`Download document`}
                      </StyledAttachmentLink>
                      {formatSize(attachment.size) && (
                        <div>{formatSize(attachment.size)}</div>
                      )}
                    </div>
                  );
              }
            })}
          </StyledAttachmentList>
        )}
        <StyledMeta>
          <time dateTime={message.displayAt}>
            {new Intl.DateTimeFormat(i18n.locale, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(message.displayAt))}
          </time>
          {statusLabel && <span>{statusLabel}</span>}
        </StyledMeta>
      </StyledBubble>
    </StyledRow>
  );
};
