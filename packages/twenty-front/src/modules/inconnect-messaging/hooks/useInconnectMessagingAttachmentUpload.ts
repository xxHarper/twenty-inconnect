import { useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import { uploadFileToUrl } from '@/file/utils/uploadFileToUrl';
import {
  CompleteInconnectMessagingOutboundUploadDocument,
  CreateInconnectMessagingOutboundUploadDocument,
  type InconnectMessagingMediaTypeCapability,
} from '~/generated-metadata/graphql';

export type InconnectMessagingAttachmentUploadStatus =
  | 'SELECTED'
  | 'UPLOADING'
  | 'FINALIZING'
  | 'READY'
  | 'FAILED';

export type InconnectMessagingComposerAttachment = {
  file: File;
  clientUploadId: string;
  uploadId: string | null;
  type: string;
  filename: string;
  contentType: string;
  previewUrl: string | null;
  status: InconnectMessagingAttachmentUploadStatus;
  error: 'UPLOAD_FAILED' | 'FINALIZATION_FAILED' | null;
};

export type InconnectMessagingAttachmentSelectionError =
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE';

const PREVIEWABLE_TYPES = new Set(['IMAGE', 'STICKER', 'AUDIO', 'VIDEO']);

const resolveMediaCapability = (
  file: File,
  mediaTypes: InconnectMessagingMediaTypeCapability[],
) => {
  const declaredMimeType = file.type.toLowerCase();

  return mediaTypes.find((capability) =>
    capability.mimeTypes.includes(declaredMimeType),
  );
};

export const useInconnectMessagingAttachmentUpload = ({
  mediaTypes,
  onSelectionError,
  onIntentionChanged,
}: {
  mediaTypes: InconnectMessagingMediaTypeCapability[];
  onSelectionError: (error: InconnectMessagingAttachmentSelectionError) => void;
  onIntentionChanged: () => void;
}) => {
  const [attachment, setAttachment] =
    useState<InconnectMessagingComposerAttachment | null>(null);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [createUpload] = useMutation(
    CreateInconnectMessagingOutboundUploadDocument,
  );
  const [completeUpload] = useMutation(
    CompleteInconnectMessagingOutboundUploadDocument,
  );

  const clearAttachment = useCallback(() => {
    abortController?.abort();
    setAbortController(null);
    setAttachment(null);
  }, [abortController]);

  useEffect(() => {
    return () => abortController?.abort();
  }, [abortController]);

  const previewUrl = attachment?.previewUrl;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const runUpload = useCallback(
    async (intention: InconnectMessagingComposerAttachment) => {
      const nextAbortController = new AbortController();

      abortController?.abort();
      setAbortController(nextAbortController);
      setAttachment((current) =>
        current?.clientUploadId === intention.clientUploadId
          ? { ...current, status: 'UPLOADING', error: null }
          : current,
      );

      try {
        const createResult = await createUpload({
          variables: {
            input: {
              clientUploadId: intention.clientUploadId,
              filename: intention.file.name,
              size: intention.file.size,
              type: intention.type,
            },
          },
        });
        const upload =
          createResult.data?.createInconnectMessagingOutboundUpload;

        if (!upload) throw new Error('Upload staging is unavailable');
        if (nextAbortController.signal.aborted) return;

        if (upload.state === 'AVAILABLE') {
          setAttachment((current) =>
            current?.clientUploadId === intention.clientUploadId
              ? {
                  ...current,
                  uploadId: upload.uploadId,
                  filename: upload.filename,
                  contentType: upload.contentType ?? current.contentType,
                  status: 'READY',
                  error: null,
                }
              : current,
          );

          return;
        }

        if (!upload.uploadUrl || !upload.uploadContentType) {
          throw new Error('Upload target is unavailable');
        }

        await uploadFileToUrl({
          file: intention.file,
          uploadUrl: upload.uploadUrl,
          contentType: upload.uploadContentType,
          signal: nextAbortController.signal,
        });
        if (nextAbortController.signal.aborted) return;

        setAttachment((current) =>
          current?.clientUploadId === intention.clientUploadId
            ? {
                ...current,
                uploadId: upload.uploadId,
                status: 'FINALIZING',
              }
            : current,
        );

        let completed;

        try {
          const completeResult = await completeUpload({
            variables: { uploadId: upload.uploadId },
          });

          completed =
            completeResult.data?.completeInconnectMessagingOutboundUpload;
        } catch {
          if (nextAbortController.signal.aborted) return;
          setAttachment((current) =>
            current?.clientUploadId === intention.clientUploadId
              ? { ...current, status: 'FAILED', error: 'FINALIZATION_FAILED' }
              : current,
          );

          return;
        }

        if (nextAbortController.signal.aborted) return;
        if (!completed || completed.state !== 'AVAILABLE') {
          setAttachment((current) =>
            current?.clientUploadId === intention.clientUploadId
              ? { ...current, status: 'FAILED', error: 'FINALIZATION_FAILED' }
              : current,
          );

          return;
        }

        setAttachment((current) =>
          current?.clientUploadId === intention.clientUploadId
            ? {
                ...current,
                uploadId: completed.uploadId,
                filename: completed.filename,
                contentType: completed.contentType ?? current.contentType,
                status: 'READY',
                error: null,
              }
            : current,
        );
      } catch (error) {
        if (
          nextAbortController.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        setAttachment((current) =>
          current?.clientUploadId === intention.clientUploadId
            ? { ...current, status: 'FAILED', error: 'UPLOAD_FAILED' }
            : current,
        );
      } finally {
        setAbortController((current) =>
          current === nextAbortController ? null : current,
        );
      }
    },
    [abortController, completeUpload, createUpload],
  );

  const selectFile = useCallback(
    (file: File) => {
      const capability = resolveMediaCapability(file, mediaTypes);

      if (!capability) {
        onSelectionError('UNSUPPORTED_FILE');

        return;
      }
      if (file.size > capability.maxBytes) {
        onSelectionError('FILE_TOO_LARGE');

        return;
      }

      const intention: InconnectMessagingComposerAttachment = {
        file,
        clientUploadId: crypto.randomUUID(),
        uploadId: null,
        type: capability.type,
        filename: file.name,
        contentType: file.type,
        previewUrl: PREVIEWABLE_TYPES.has(capability.type)
          ? URL.createObjectURL(file)
          : null,
        status: 'SELECTED',
        error: null,
      };

      setAttachment(intention);
      onIntentionChanged();
      void runUpload(intention);
    },
    [mediaTypes, onIntentionChanged, onSelectionError, runUpload],
  );

  const retryUpload = useCallback(() => {
    if (attachment?.status !== 'FAILED') return;
    void runUpload(attachment);
  }, [attachment, runUpload]);

  const removeAttachment = useCallback(() => {
    clearAttachment();
    onIntentionChanged();
  }, [clearAttachment, onIntentionChanged]);

  return {
    attachment,
    selectFile,
    retryUpload,
    removeAttachment,
    clearAttachment,
  };
};
