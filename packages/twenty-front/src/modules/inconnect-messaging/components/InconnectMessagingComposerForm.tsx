import { useLingui } from '@lingui/react/macro';
import { Button } from 'twenty-ui/input';

import { InconnectMessagingAttachmentControl } from '@/inconnect-messaging/components/InconnectMessagingAttachmentControl';
import {
  StyledComposer,
  StyledComposerActions,
  StyledComposerError,
  StyledComposerStatus,
} from '@/inconnect-messaging/components/InconnectMessagingComposer.styles';
import {
  type InconnectMessagingAttachmentSelectionError,
  type InconnectMessagingComposerAttachment,
} from '@/inconnect-messaging/hooks/useInconnectMessagingAttachmentUpload';
import { TextArea } from '@/ui/input/components/TextArea';
import { type InconnectMessagingSendCapabilitiesQuery } from '~/generated-metadata/graphql';

type SendCapabilities = NonNullable<
  InconnectMessagingSendCapabilitiesQuery['inconnectMessagingSendCapabilities']
>;

type InconnectMessagingComposerFormProps = {
  conversationId: string;
  capabilities: SendCapabilities;
  expiryLabel: string | null;
  body: string;
  attachment: InconnectMessagingComposerAttachment | null;
  selectionError: InconnectMessagingAttachmentSelectionError | null;
  errorMessage: string | null;
  hasUncertainResult: boolean;
  sending: boolean;
  onBodyChange: (value: string) => void;
  onSelectFile: (file: File) => void;
  onRetryUpload: () => void;
  onRemoveAttachment: () => void;
  onResetIntent: () => void;
  onOpenTemplates: () => void;
  onSendFreeform: () => void;
};

export const InconnectMessagingComposerForm = ({
  conversationId,
  capabilities,
  expiryLabel,
  body,
  attachment,
  selectionError,
  errorMessage,
  hasUncertainResult,
  sending,
  onBodyChange,
  onSelectFile,
  onRetryUpload,
  onRemoveAttachment,
  onResetIntent,
  onOpenTemplates,
  onSendFreeform,
}: InconnectMessagingComposerFormProps) => {
  const { t } = useLingui();
  const captionUnsupported =
    attachment !== null &&
    body.trim().length > 0 &&
    !capabilities.mediaTypes.some(
      ({ type, captionSupported }) =>
        type === attachment.type && captionSupported,
    );
  const attachmentPending =
    attachment !== null && attachment.status !== 'READY';
  const freeformEmpty = body.trim().length === 0 && attachment === null;

  return (
    <StyledComposer>
      <StyledComposerStatus role="status">
        {capabilities.canSendFreeform
          ? expiryLabel
            ? t`24-hour service window open until ${expiryLabel}`
            : t`24-hour service window open`
          : t`The 24-hour service window is closed. Free-form messages are unavailable.`}
      </StyledComposerStatus>
      {capabilities.canSendFreeform && (
        <TextArea
          textAreaId={`inconnect-messaging-composer-${conversationId}`}
          label={t`Message`}
          placeholder={t`Write a message`}
          value={body}
          minRows={2}
          maxRows={6}
          disabled={sending || hasUncertainResult}
          onChange={onBodyChange}
        />
      )}
      <InconnectMessagingAttachmentControl
        attachment={attachment}
        mediaTypes={capabilities.mediaTypes}
        mediaUnavailable={!capabilities.canSendMedia}
        sessionClosed={!capabilities.canSendFreeform}
        disabled={
          !capabilities.canSendFreeform ||
          !capabilities.canSendMedia ||
          sending ||
          hasUncertainResult
        }
        selectionError={selectionError}
        onSelect={onSelectFile}
        onRetry={onRetryUpload}
        onRemove={onRemoveAttachment}
      />
      {captionUnsupported && (
        <StyledComposerError role="alert">
          {t`Caption unsupported with this attachment. Remove the text or the attachment.`}
        </StyledComposerError>
      )}
      {errorMessage !== null && (
        <StyledComposerError role="alert">{errorMessage}</StyledComposerError>
      )}
      <StyledComposerActions>
        {hasUncertainResult && (
          <Button
            title={t`Discard and start a new message`}
            variant="secondary"
            onClick={onResetIntent}
            disabled={sending}
          />
        )}
        {capabilities.canSendTemplate && (
          <Button
            title={t`Use template`}
            variant="secondary"
            onClick={onOpenTemplates}
            disabled={sending}
          />
        )}
        {capabilities.canSendFreeform && (
          <Button
            title={sending ? t`Sending…` : t`Send`}
            variant="primary"
            accent="blue"
            onClick={onSendFreeform}
            disabled={
              freeformEmpty ||
              attachmentPending ||
              captionUnsupported ||
              sending
            }
          />
        )}
      </StyledComposerActions>
    </StyledComposer>
  );
};
