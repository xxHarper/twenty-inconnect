import { useLingui } from '@lingui/react/macro';
import { type ChangeEvent, useRef } from 'react';
import { IconPaperclip } from 'twenty-ui/icon';
import { Button, IconButton } from 'twenty-ui/input';

import {
  StyledAttachmentCard,
  StyledAttachmentControls,
  StyledAttachmentDetails,
  StyledAttachmentFilename,
  StyledAttachmentPreview,
  StyledComposerError,
  StyledComposerStatus,
  StyledHiddenFileInput,
} from '@/inconnect-messaging/components/InconnectMessagingComposer.styles';
import {
  type InconnectMessagingComposerAttachment,
  type InconnectMessagingAttachmentSelectionError,
} from '@/inconnect-messaging/hooks/useInconnectMessagingAttachmentUpload';
import { type InconnectMessagingMediaTypeCapability } from '~/generated-metadata/graphql';

type InconnectMessagingAttachmentControlProps = {
  attachment: InconnectMessagingComposerAttachment | null;
  mediaTypes: InconnectMessagingMediaTypeCapability[];
  disabled: boolean;
  mediaUnavailable: boolean;
  sessionClosed: boolean;
  selectionError: InconnectMessagingAttachmentSelectionError | null;
  onSelect: (file: File) => void;
  onRetry: () => void;
  onRemove: () => void;
};

const formatFileSize = (size: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: size >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(size / (size >= 1024 * 1024 ? 1024 * 1024 : 1024));

export const InconnectMessagingAttachmentControl = ({
  attachment,
  mediaTypes,
  disabled,
  mediaUnavailable,
  sessionClosed,
  selectionError,
  onSelect,
  onRetry,
  onRemove,
}: InconnectMessagingAttachmentControlProps) => {
  const { t, i18n } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = [...new Set(mediaTypes.flatMap(({ mimeTypes }) => mimeTypes))]
    .sort()
    .join(',');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    event.target.value = '';
    if (file) onSelect(file);
  };

  const statusLabel =
    attachment?.status === 'UPLOADING'
      ? t`Uploading…`
      : attachment?.status === 'FINALIZING'
        ? t`Processing…`
        : attachment?.status === 'READY'
          ? t`Ready`
          : attachment?.status === 'FAILED'
            ? t`Upload failed`
            : t`Selected`;

  return (
    <>
      <StyledAttachmentControls>
        <StyledHiddenFileInput
          ref={inputRef}
          type="file"
          accept={accept}
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleChange}
        />
        <IconButton
          variant="tertiary"
          size="small"
          Icon={IconPaperclip}
          ariaLabel={t`Attach file`}
          disabled={disabled || attachment !== null}
          onClick={() => inputRef.current?.click()}
        />
        {attachment === null && (
          <StyledComposerStatus>
            {sessionClosed
              ? t`Media is unavailable while the 24-hour service window is closed.`
              : mediaUnavailable
                ? t`Media is unavailable for this conversation.`
                : t`Attach one supported file`}
          </StyledComposerStatus>
        )}
      </StyledAttachmentControls>
      {selectionError !== null && (
        <StyledComposerError role="alert">
          {selectionError === 'FILE_TOO_LARGE'
            ? t`File too large.`
            : t`Unsupported file.`}
        </StyledComposerError>
      )}
      {attachment !== null && (
        <StyledAttachmentCard>
          <StyledAttachmentDetails>
            <StyledAttachmentFilename title={attachment.filename}>
              {attachment.filename}
            </StyledAttachmentFilename>
            <StyledComposerStatus role="status" aria-live="polite">
              {statusLabel} ·{' '}
              {formatFileSize(attachment.file.size, i18n.locale)}
            </StyledComposerStatus>
            {attachment.error !== null && (
              <StyledComposerError role="alert">
                {attachment.error === 'FINALIZATION_FAILED'
                  ? t`The file could not be processed. Retry the upload.`
                  : t`The file could not be uploaded. Check your connection and retry.`}
              </StyledComposerError>
            )}
          </StyledAttachmentDetails>
          <StyledAttachmentControls>
            {attachment.status === 'FAILED' && (
              <Button
                title={t`Retry`}
                variant="secondary"
                onClick={onRetry}
                disabled={disabled}
              />
            )}
            <Button title={t`Remove`} variant="secondary" onClick={onRemove} />
          </StyledAttachmentControls>
          {attachment.previewUrl !== null && (
            <StyledAttachmentPreview>
              {attachment.type === 'IMAGE' || attachment.type === 'STICKER' ? (
                <img
                  src={attachment.previewUrl}
                  alt={t`Preview of ${attachment.filename}`}
                />
              ) : attachment.type === 'AUDIO' ? (
                <audio controls src={attachment.previewUrl}>
                  {t`Audio preview is unavailable.`}
                </audio>
              ) : attachment.type === 'VIDEO' ? (
                <video controls src={attachment.previewUrl}>
                  {t`Video preview is unavailable.`}
                </video>
              ) : null}
            </StyledAttachmentPreview>
          )}
        </StyledAttachmentCard>
      )}
    </>
  );
};
