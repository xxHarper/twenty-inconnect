import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import type { InconnectMessagingMessage } from '@/inconnect-messaging/types/InconnectMessagingRead';

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

type InconnectMessagingMessageBubbleProps = {
  message: InconnectMessagingMessage;
};

export const InconnectMessagingMessageBubble = ({
  message,
}: InconnectMessagingMessageBubbleProps) => {
  const { t, i18n } = useLingui();
  const isOutbound = message.direction === 'OUTBOUND';
  const location = message.location;

  const mediaLabel = (() => {
    switch (message.type) {
      case 'IMAGE':
        return isOutbound ? t`Image sent` : t`Image received`;
      case 'AUDIO':
        return isOutbound ? t`Audio sent` : t`Audio received`;
      case 'VIDEO':
        return isOutbound ? t`Video sent` : t`Video received`;
      case 'DOCUMENT':
        return isOutbound ? t`Document sent` : t`Document received`;
      default:
        return null;
    }
  })();

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
        {mediaLabel && (
          <div>
            {mediaLabel}
            {message.media.map(
              (item, index) =>
                item.contentType && <div key={index}>{item.contentType}</div>,
            )}
          </div>
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
