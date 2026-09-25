import { useLingui } from '@lingui/react/macro';
import { useCallback, useContext, useId, useState } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconX } from 'twenty-ui/icon';
import { Button, IconButton } from 'twenty-ui/input';
import { ThemeContext } from 'twenty-ui/theme-constants';

import { InconnectMessagingConversationLinking } from '@/inconnect-messaging/components/InconnectMessagingConversationLinking';
import { useInconnectMessagingConversationContext } from '@/inconnect-messaging/hooks/useInconnectMessagingConversationContext';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';

import {
  StyledContextField,
  StyledContextFieldLabel,
  StyledContextFields,
  StyledContextFieldValue,
  StyledContextHeader,
  StyledContextScroll,
  StyledContextSkeleton,
  StyledContextState,
  StyledContextStateContent,
  StyledContextSummary,
  StyledContextSurface,
  StyledContextTitle,
  StyledDesktopContextPanel,
  StyledLinkingStatus,
  StyledObjectLabel,
  StyledRecordLabel,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';

type InconnectMessagingConversationContextPanelProps = {
  conversationId: string;
  refreshNonce: number;
  displayMode: 'desktop' | 'modal';
  modalInstanceId: string;
  onUnavailable: () => void;
  onConversationLinked: (conversationId: string) => void;
};

type InconnectMessagingConversationContextContentProps = Omit<
  ReturnType<typeof useInconnectMessagingConversationContext>,
  'conversationId'
> & {
  conversationId: string;
  onClose?: () => void;
  onLinked: () => void;
  onAlreadyLinked: () => void;
  onUnavailable: () => void;
  alreadyLinkedNotice: boolean;
};

const InconnectMessagingConversationContextContent = ({
  status,
  context,
  conversationId,
  onClose,
  onLinked,
  onAlreadyLinked,
  onUnavailable,
  alreadyLinkedNotice,
}: InconnectMessagingConversationContextContentProps) => {
  const { t } = useLingui();
  const { theme } = useContext(ThemeContext);
  const headingId = useId();
  const [isLinking, setIsLinking] = useState(false);

  if (isLinking) {
    return (
      <StyledContextSurface aria-labelledby={headingId}>
        <StyledContextHeader>
          <StyledContextTitle
            id={headingId}
          >{t`CRM context`}</StyledContextTitle>
          {onClose && (
            <IconButton
              Icon={IconX}
              ariaLabel={t`Close CRM context`}
              onClick={onClose}
            />
          )}
        </StyledContextHeader>
        <InconnectMessagingConversationLinking
          conversationId={conversationId}
          onCancel={() => setIsLinking(false)}
          onLinked={() => {
            setIsLinking(false);
            onLinked();
          }}
          onAlreadyLinked={() => {
            setIsLinking(false);
            onAlreadyLinked();
          }}
          onUnavailable={onUnavailable}
        />
      </StyledContextSurface>
    );
  }

  return (
    <StyledContextSurface aria-labelledby={headingId}>
      <StyledContextHeader>
        <StyledContextTitle id={headingId}>{t`CRM context`}</StyledContextTitle>
        {onClose && (
          <IconButton
            Icon={IconX}
            ariaLabel={t`Close CRM context`}
            onClick={onClose}
          />
        )}
      </StyledContextHeader>
      {status === 'loading' ? (
        <StyledContextScroll role="status" aria-label={t`Loading CRM context`}>
          <StyledContextSkeleton>
            <SkeletonTheme
              baseColor={theme.background.tertiary}
              highlightColor={theme.background.transparent.lighter}
              borderRadius={4}
            >
              <Skeleton height={18} width="55%" />
              <Skeleton height={24} width="80%" />
              <Skeleton count={5} height={34} />
            </SkeletonTheme>
          </StyledContextSkeleton>
        </StyledContextScroll>
      ) : status === 'error' || status === 'unavailable' ? (
        <StyledContextState role="alert">{t`CRM context is unavailable.`}</StyledContextState>
      ) : context?.state === 'UNASSIGNED' ? (
        <StyledContextState>
          <StyledContextStateContent>
            <span>{t`No CRM record linked.`}</span>
            <Button
              type="button"
              title={t`Link CRM record`}
              ariaLabel={t`Link CRM record`}
              variant="primary"
              accent="blue"
              onClick={() => setIsLinking(true)}
            />
          </StyledContextStateContent>
        </StyledContextState>
      ) : context?.state === 'LINKED' && context.object && context.record ? (
        <StyledContextScroll>
          {alreadyLinkedNotice && (
            <StyledLinkingStatus role="status">{t`This conversation has already been linked.`}</StyledLinkingStatus>
          )}
          <StyledContextSummary>
            <StyledObjectLabel>{context.object.label}</StyledObjectLabel>
            <StyledRecordLabel>
              {context.record.recordLabel ?? t`Unlabeled record`}
            </StyledRecordLabel>
          </StyledContextSummary>
          {context.fields.length === 0 ? (
            <StyledContextState>{t`No context fields configured.`}</StyledContextState>
          ) : (
            <StyledContextFields>
              {context.fields.map((field) => (
                <StyledContextField
                  key={field.fieldMetadataId}
                  data-value-kind={field.valueKind}
                >
                  <StyledContextFieldLabel>
                    {field.label}
                  </StyledContextFieldLabel>
                  <StyledContextFieldValue>
                    {field.displayValue ?? (
                      <span aria-label={t`No value`}>—</span>
                    )}
                  </StyledContextFieldValue>
                </StyledContextField>
              ))}
            </StyledContextFields>
          )}
        </StyledContextScroll>
      ) : (
        <StyledContextState role="alert">{t`CRM context is unavailable.`}</StyledContextState>
      )}
    </StyledContextSurface>
  );
};

export const InconnectMessagingConversationContextPanel = ({
  conversationId,
  refreshNonce,
  displayMode,
  modalInstanceId,
  onUnavailable,
  onConversationLinked,
}: InconnectMessagingConversationContextPanelProps) => {
  const { closeModal } = useModal();
  const [linkRefreshNonce, setLinkRefreshNonce] = useState(0);
  const [alreadyLinkedConversationId, setAlreadyLinkedConversationId] =
    useState<string | null>(null);

  const requestState = useInconnectMessagingConversationContext({
    conversationId,
    refreshNonce: refreshNonce + linkRefreshNonce,
    onUnavailable,
  });

  const refreshAfterLink = useCallback(
    (isAlreadyLinked: boolean) => {
      setAlreadyLinkedConversationId(isAlreadyLinked ? conversationId : null);
      setLinkRefreshNonce((current) => current + 1);
      onConversationLinked(conversationId);
    },
    [conversationId, onConversationLinked],
  );

  if (displayMode === 'desktop') {
    return (
      <StyledDesktopContextPanel>
        <InconnectMessagingConversationContextContent
          key={conversationId}
          conversationId={conversationId}
          status={requestState.status}
          context={requestState.context}
          alreadyLinkedNotice={alreadyLinkedConversationId === conversationId}
          onLinked={() => refreshAfterLink(false)}
          onAlreadyLinked={() => refreshAfterLink(true)}
          onUnavailable={onUnavailable}
        />
      </StyledDesktopContextPanel>
    );
  }

  const handleClose = () => closeModal(modalInstanceId);

  return (
    <ModalStatefulWrapper
      modalInstanceId={modalInstanceId}
      isClosable
      onClose={handleClose}
      padding="none"
      overlay="dark"
      renderInDocumentBody
      size="fullscreen"
    >
      <InconnectMessagingConversationContextContent
        key={conversationId}
        conversationId={conversationId}
        status={requestState.status}
        context={requestState.context}
        alreadyLinkedNotice={alreadyLinkedConversationId === conversationId}
        onClose={handleClose}
        onLinked={() => refreshAfterLink(false)}
        onAlreadyLinked={() => refreshAfterLink(true)}
        onUnavailable={onUnavailable}
      />
    </ModalStatefulWrapper>
  );
};
