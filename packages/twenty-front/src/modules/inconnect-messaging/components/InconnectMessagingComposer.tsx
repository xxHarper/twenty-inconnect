import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';

import {
  StyledComposerError,
  StyledComposerStatus,
} from '@/inconnect-messaging/components/InconnectMessagingComposer.styles';
import { InconnectMessagingComposerForm } from '@/inconnect-messaging/components/InconnectMessagingComposerForm';
import { InconnectMessagingTemplatePicker } from '@/inconnect-messaging/components/InconnectMessagingTemplatePicker';
import {
  type InconnectMessagingAttachmentSelectionError,
  useInconnectMessagingAttachmentUpload,
} from '@/inconnect-messaging/hooks/useInconnectMessagingAttachmentUpload';
import { type InconnectMessagingTemplate } from '@/inconnect-messaging/types/InconnectMessagingRead';
import {
  formatInconnectMessagingWindowExpiry,
  getInconnectMessagingErrorDetails,
} from '@/inconnect-messaging/utils/getInconnectMessagingErrorDetails';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import {
  InconnectMessagingSendCapabilitiesDocument,
  InconnectMessagingTemplatesDocument,
  SendInconnectMessagingMessageDocument,
} from '~/generated-metadata/graphql';

type InconnectMessagingComposerProps = {
  conversationId: string;
  refreshNonce: number;
  onAccepted: () => void;
  onUnavailable: () => void;
};

export const InconnectMessagingComposer = ({
  conversationId,
  refreshNonce,
  onAccepted,
  onUnavailable,
}: InconnectMessagingComposerProps) => {
  const { t, i18n } = useLingui();
  const { openModal, closeModal } = useModal();
  const modalInstanceId = `inconnect-messaging-template-${conversationId}`;
  const [body, setBody] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUncertainResult, setHasUncertainResult] = useState(false);
  const [selectionError, setSelectionError] =
    useState<InconnectMessagingAttachmentSelectionError | null>(null);
  const capabilitiesQuery = useQuery(
    InconnectMessagingSendCapabilitiesDocument,
    {
      variables: { conversationId },
      fetchPolicy: 'network-only',
    },
  );
  const [loadTemplates, templatesQuery] = useLazyQuery(
    InconnectMessagingTemplatesDocument,
    { fetchPolicy: 'network-only' },
  );
  const [sendMessage, sendState] = useMutation(
    SendInconnectMessagingMessageDocument,
  );
  const capabilities =
    capabilitiesQuery.data?.inconnectMessagingSendCapabilities;
  const refetchCapabilities = capabilitiesQuery.refetch;
  const templates =
    (templatesQuery.data?.inconnectMessagingTemplates as
      | InconnectMessagingTemplate[]
      | null
      | undefined) ?? [];
  const {
    attachment,
    selectFile,
    retryUpload,
    removeAttachment,
    clearAttachment,
  } = useInconnectMessagingAttachmentUpload({
    mediaTypes: capabilities?.mediaTypes ?? [],
    onSelectionError: setSelectionError,
    onIntentionChanged: () => {
      setClientRequestId(crypto.randomUUID());
      setHasUncertainResult(false);
      setErrorMessage(null);
      setSelectionError(null);
    },
  });

  useEffect(() => {
    if (capabilitiesQuery.data?.inconnectMessagingSendCapabilities === null) {
      clearAttachment();
      onUnavailable();
    }
  }, [capabilitiesQuery.data, clearAttachment, onUnavailable]);

  useEffect(() => {
    if (refreshNonce === 0) {
      return;
    }

    void refetchCapabilities().catch(() => undefined);
  }, [refetchCapabilities, refreshNonce]);

  useEffect(() => {
    if (!capabilities?.freeformWindowExpiresAt) {
      return;
    }

    const delay = Math.max(
      0,
      new Date(capabilities.freeformWindowExpiresAt).getTime() - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      void refetchCapabilities().catch(() => undefined);
    }, delay + 250);

    return () => window.clearTimeout(timeout);
  }, [capabilities?.freeformWindowExpiresAt, refetchCapabilities]);

  const resetIntent = () => {
    clearAttachment();
    setBody('');
    setSelectedTemplateId(null);
    setVariableValues({});
    setClientRequestId(null);
    setErrorMessage(null);
    setHasUncertainResult(false);
    setSelectionError(null);
  };

  const handleBodyChange = (value: string) => {
    setBody(value);
    setClientRequestId(crypto.randomUUID());
    setHasUncertainResult(false);
    setErrorMessage(null);
  };

  const handleOpenTemplates = () => {
    if (attachment !== null) {
      setErrorMessage(t`Remove the attachment before choosing a template.`);

      return;
    }
    setErrorMessage(null);
    openModal(modalInstanceId);
    void loadTemplates({ variables: { conversationId } });
  };

  const handleSelectTemplate = (template: InconnectMessagingTemplate) => {
    if (template.id !== selectedTemplateId) {
      setSelectedTemplateId(template.id);
      setVariableValues(
        Object.fromEntries(
          template.variables.map((variable) => [variable.key, '']),
        ),
      );
      setClientRequestId(crypto.randomUUID());
      setHasUncertainResult(false);
      setErrorMessage(null);
    }
  };

  const handleVariableChange = (key: string, value: string) => {
    setVariableValues((current) => ({ ...current, [key]: value }));
    setClientRequestId(crypto.randomUUID());
    setHasUncertainResult(false);
    setErrorMessage(null);
  };

  const handleSend = async (mode: 'FREEFORM' | 'TEMPLATE') => {
    if (sendState.loading) {
      return;
    }

    const effectiveClientRequestId = clientRequestId ?? crypto.randomUUID();

    setClientRequestId(effectiveClientRequestId);
    setErrorMessage(null);

    try {
      await sendMessage({
        variables: {
          input:
            mode === 'FREEFORM'
              ? {
                  conversationId,
                  clientRequestId: effectiveClientRequestId,
                  mode,
                  ...(body.trim().length > 0 ? { body } : {}),
                  ...(attachment?.status === 'READY' && attachment.uploadId
                    ? { outboundUploadIds: [attachment.uploadId] }
                    : {}),
                }
              : {
                  conversationId,
                  clientRequestId: effectiveClientRequestId,
                  mode,
                  templateId: selectedTemplateId,
                  templateVariables: Object.entries(variableValues).map(
                    ([key, value]) => ({ key, value }),
                  ),
                },
        },
      });
      resetIntent();
      closeModal(modalInstanceId);
      await refetchCapabilities().catch(() => undefined);
      onAccepted();
    } catch (error) {
      const { code, subCode } = getInconnectMessagingErrorDetails(error);

      if (['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(code ?? '')) {
        resetIntent();
        closeModal(modalInstanceId);
        onUnavailable();

        return;
      }

      if (subCode === 'SESSION_WINDOW_CLOSED') {
        setErrorMessage(
          t`The 24-hour window has closed. Use an approved template instead.`,
        );
        void refetchCapabilities().catch(() => undefined);
      } else if (subCode === 'IDEMPOTENCY_KEY_CONFLICT') {
        setErrorMessage(
          t`This send attempt no longer matches its original content. Start a new message before sending.`,
        );
      } else if (subCode === 'OUTBOUND_UPLOAD_UNAVAILABLE') {
        setErrorMessage(
          t`This upload is no longer available. Remove it and attach the file again.`,
        );
      } else if (
        subCode === 'TEMPLATE_UNAVAILABLE' ||
        subCode === 'INVALID_TEMPLATE_VARIABLES'
      ) {
        setErrorMessage(t`This template is no longer available or valid.`);
        void loadTemplates({ variables: { conversationId } });
      } else if (
        subCode === 'INVALID_MESSAGE' ||
        subCode === 'INVALID_MESSAGE_MODE' ||
        subCode === 'PROVIDER_UNAVAILABLE'
      ) {
        setErrorMessage(t`This message cannot be sent right now.`);
      } else {
        setHasUncertainResult(true);
        setErrorMessage(
          t`The result is uncertain. Retry to safely reuse the same send request.`,
        );
      }
    }
  };

  if (capabilitiesQuery.loading && capabilities === undefined) {
    return (
      <StyledComposerStatus role="status">{t`Loading send options…`}</StyledComposerStatus>
    );
  }

  if (capabilitiesQuery.error || capabilities == null) {
    return (
      <StyledComposerError role="alert">{t`Send options are temporarily unavailable.`}</StyledComposerError>
    );
  }

  const expiryLabel = formatInconnectMessagingWindowExpiry(
    capabilities.freeformWindowExpiresAt,
    i18n.locale,
  );
  return (
    <>
      <InconnectMessagingComposerForm
        conversationId={conversationId}
        capabilities={capabilities}
        expiryLabel={expiryLabel}
        body={body}
        attachment={attachment}
        selectionError={selectionError}
        errorMessage={errorMessage}
        hasUncertainResult={hasUncertainResult}
        sending={sendState.loading}
        onBodyChange={handleBodyChange}
        onSelectFile={selectFile}
        onRetryUpload={retryUpload}
        onRemoveAttachment={removeAttachment}
        onResetIntent={resetIntent}
        onOpenTemplates={handleOpenTemplates}
        onSendFreeform={() => void handleSend('FREEFORM')}
      />
      <InconnectMessagingTemplatePicker
        modalInstanceId={modalInstanceId}
        templates={templates}
        loading={templatesQuery.loading}
        loadFailed={Boolean(templatesQuery.error)}
        selectedTemplateId={selectedTemplateId}
        variableValues={variableValues}
        errorMessage={errorMessage}
        sending={sendState.loading}
        onSelect={handleSelectTemplate}
        onVariableChange={handleVariableChange}
        onSend={() => void handleSend('TEMPLATE')}
        onClose={() => undefined}
      />
    </>
  );
};
