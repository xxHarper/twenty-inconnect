import { useLingui } from '@lingui/react/macro';
import { useContext, useId } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconX } from 'twenty-ui/icon';
import { IconButton } from 'twenty-ui/input';
import { ThemeContext } from 'twenty-ui/theme-constants';

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
  StyledContextSummary,
  StyledContextSurface,
  StyledContextTitle,
  StyledDesktopContextPanel,
  StyledObjectLabel,
  StyledRecordLabel,
} from '@/inconnect-messaging/components/InconnectMessagingConversationContextPanel.styles';

type InconnectMessagingConversationContextPanelProps = {
  conversationId: string;
  refreshNonce: number;
  displayMode: 'desktop' | 'modal';
  modalInstanceId: string;
  onUnavailable: () => void;
};

type InconnectMessagingConversationContextContentProps = Omit<
  ReturnType<typeof useInconnectMessagingConversationContext>,
  'conversationId'
> & {
  onClose?: () => void;
};

const InconnectMessagingConversationContextContent = ({
  status,
  context,
  onClose,
}: InconnectMessagingConversationContextContentProps) => {
  const { t } = useLingui();
  const { theme } = useContext(ThemeContext);
  const headingId = useId();
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
        <StyledContextState>{t`No CRM record linked.`}</StyledContextState>
      ) : context?.state === 'LINKED' && context.object && context.record ? (
        <StyledContextScroll>
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
}: InconnectMessagingConversationContextPanelProps) => {
  const { closeModal } = useModal();
  const requestState = useInconnectMessagingConversationContext({
    conversationId,
    refreshNonce,
    onUnavailable,
  });

  if (displayMode === 'desktop') {
    return (
      <StyledDesktopContextPanel>
        <InconnectMessagingConversationContextContent
          status={requestState.status}
          context={requestState.context}
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
        status={requestState.status}
        context={requestState.context}
        onClose={handleClose}
      />
    </ModalStatefulWrapper>
  );
};
