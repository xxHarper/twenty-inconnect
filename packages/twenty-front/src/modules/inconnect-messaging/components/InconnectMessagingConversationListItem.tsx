import { useLingui } from '@lingui/react/macro';
import { Pill } from 'twenty-ui/data-display';
import { IconClock, IconStar } from 'twenty-ui/icon';

import type { InconnectMessagingConversationListItem as ConversationListItem } from '@/inconnect-messaging/types/InconnectMessagingRead';
import {
  StyledAddress,
  StyledItem,
  StyledItemMetadata,
  StyledItemState,
  StyledItemTop,
  StyledSecondary,
  StyledUnreadIndicator,
} from '~/pages/inconnect-messaging/InconnectMessagingPage.styles';

type InconnectMessagingConversationListItemProps = {
  conversation: ConversationListItem;
  isSelected: boolean;
  onSelect: () => void;
};

export const InconnectMessagingConversationListItem = ({
  conversation,
  isSelected,
  onSelect,
}: InconnectMessagingConversationListItemProps) => {
  const { t, i18n } = useLingui();

  return (
    <StyledItem
      type="button"
      isSelected={isSelected}
      isUnread={conversation.isUnread}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <StyledItemTop>
        <StyledAddress isUnread={conversation.isUnread}>
          {conversation.externalAddress}
        </StyledAddress>
        <StyledItemState>
          {conversation.isUnread && (
            <StyledUnreadIndicator aria-label={t`Unread`} />
          )}
          {conversation.isFavorite && (
            <IconStar size={16} aria-label={t`Favorite`} />
          )}
          <StyledSecondary>
            {conversation.lastInboundAt &&
              new Intl.DateTimeFormat(i18n.locale, {
                dateStyle: 'short',
              }).format(new Date(conversation.lastInboundAt))}
          </StyledSecondary>
        </StyledItemState>
      </StyledItemTop>
      <StyledItemMetadata>
        <StyledSecondary>
          {conversation.isLinked ? t`Linked conversation` : t`Unassigned`}
        </StyledSecondary>
        {conversation.isPending && <Pill label={t`Pending`} Icon={IconClock} />}
      </StyledItemMetadata>
    </StyledItem>
  );
};
