import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Button } from 'twenty-ui/input';

import {
  StyledComposer,
  StyledComposerActions,
  StyledComposerError,
  StyledComposerStatus,
} from '@/inconnect-messaging/components/InconnectMessagingComposer.styles';
import { InconnectMessagingTemplatePicker } from '@/inconnect-messaging/components/InconnectMessagingTemplatePicker';
import { type InconnectMessagingTemplate } from '@/inconnect-messaging/types/InconnectMessagingRead';
import { TextArea } from '@/ui/input/components/TextArea';
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

const getErrorDetails = (error: unknown) => {
  if (!CombinedGraphQLErrors.is(error)) {
    return { code: null, subCode: null };
  }

  const extensions = error.errors[0]?.extensions;

  return {
    code: typeof extensions?.code === 'string' ? extensions.code : null,
    subCode:
      typeof extensions?.subCode === 'string' ? extensions.subCode : null,
  };
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

  useEffect(() => {
    if (capabilitiesQuery.data?.inconnectMessagingSendCapabilities === null) {
      onUnavailable();
    }
  }, [capabilitiesQuery.data, onUnavailable]);

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
    setBody('');
    setSelectedTemplateId(null);
    setVariableValues({});
    setClientRequestId(null);
    setErrorMessage(null);
    setHasUncertainResult(false);
  };

  const handleBodyChange = (value: string) => {
    setBody(value);
    setClientRequestId((current) => current ?? crypto.randomUUID());
    setErrorMessage(null);
  };

  const handleOpenTemplates = () => {
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
    setClientRequestId((current) => current ?? crypto.randomUUID());
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
                  body,
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
      const { code, subCode } = getErrorDetails(error);

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

  const expiryLabel = capabilities.freeformWindowExpiresAt
    ? new Intl.DateTimeFormat(i18n.locale, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(capabilities.freeformWindowExpiresAt))
    : null;

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
          disabled={sendState.loading || hasUncertainResult}
          onChange={handleBodyChange}
        />
      )}
      {errorMessage !== null && (
        <StyledComposerError role="alert">{errorMessage}</StyledComposerError>
      )}
      <StyledComposerActions>
        {hasUncertainResult && (
          <Button
            title={t`Discard and start a new message`}
            variant="secondary"
            onClick={resetIntent}
            disabled={sendState.loading}
          />
        )}
        {capabilities.canSendTemplate && (
          <Button
            title={t`Use template`}
            variant="secondary"
            onClick={handleOpenTemplates}
            disabled={sendState.loading}
          />
        )}
        {capabilities.canSendFreeform && (
          <Button
            title={sendState.loading ? t`Sending…` : t`Send`}
            variant="primary"
            accent="blue"
            onClick={() => void handleSend('FREEFORM')}
            disabled={body.trim().length === 0 || sendState.loading}
          />
        )}
      </StyledComposerActions>
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
    </StyledComposer>
  );
};
