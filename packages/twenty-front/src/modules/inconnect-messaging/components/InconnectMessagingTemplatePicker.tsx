import { useLingui } from '@lingui/react/macro';
import { Button } from 'twenty-ui/input';
import { H1Title, H1TitleFontColor } from 'twenty-ui/typography';

import {
  StyledComposerError,
  StyledComposerStatus,
  StyledTemplateDetails,
  StyledTemplateList,
  StyledTemplateModalActions,
  StyledTemplateOption,
  StyledTemplatePreview,
  StyledTemplateVariables,
} from '@/inconnect-messaging/components/InconnectMessagingComposer.styles';
import { TextInput } from '@/ui/input/components/TextInput';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { type InconnectMessagingTemplate } from '@/inconnect-messaging/types/InconnectMessagingRead';

type InconnectMessagingTemplatePickerProps = {
  modalInstanceId: string;
  templates: InconnectMessagingTemplate[];
  loading: boolean;
  loadFailed: boolean;
  selectedTemplateId: string | null;
  variableValues: Record<string, string>;
  errorMessage: string | null;
  sending: boolean;
  onSelect: (template: InconnectMessagingTemplate) => void;
  onVariableChange: (key: string, value: string) => void;
  onSend: () => void;
  onClose: () => void;
};

const renderPreview = (
  body: string,
  variables: Record<string, string>,
): string =>
  body.replace(/{{\s*([A-Za-z0-9]+)\s*}}/g, (match, key: string) => {
    return variables[key]?.length > 0 ? variables[key] : match;
  });

export const InconnectMessagingTemplatePicker = ({
  modalInstanceId,
  templates,
  loading,
  loadFailed,
  selectedTemplateId,
  variableValues,
  errorMessage,
  sending,
  onSelect,
  onVariableChange,
  onSend,
  onClose,
}: InconnectMessagingTemplatePickerProps) => {
  const { t } = useLingui();
  const { closeModal } = useModal();
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? null;
  const variablesComplete =
    selectedTemplate !== null &&
    selectedTemplate.variables.every(
      (variable) =>
        !variable.required ||
        (variableValues[variable.key]?.trim().length ?? 0) > 0,
    );

  const handleClose = () => {
    closeModal(modalInstanceId);
    onClose();
  };

  return (
    <ModalStatefulWrapper
      modalInstanceId={modalInstanceId}
      onClose={onClose}
      isClosable
      padding="large"
      overlay="dark"
      renderInDocumentBody
      narrowWidth
      autoHeight
    >
      <H1Title
        title={t`Use a WhatsApp template`}
        fontColor={H1TitleFontColor.Primary}
      />
      {loading ? (
        <StyledComposerStatus role="status">
          {t`Loading templates…`}
        </StyledComposerStatus>
      ) : loadFailed ? (
        <StyledComposerError role="alert">
          {t`Templates could not be loaded.`}
        </StyledComposerError>
      ) : templates.length === 0 ? (
        <StyledComposerStatus>{t`No approved text templates are available.`}</StyledComposerStatus>
      ) : (
        <StyledTemplateList role="radiogroup" aria-label={t`Templates`}>
          {templates.map((template) => (
            <StyledTemplateOption key={template.id}>
              <input
                type="radio"
                name={`${modalInstanceId}-template`}
                value={template.id}
                checked={template.id === selectedTemplateId}
                onChange={() => onSelect(template)}
              />
              <StyledTemplateDetails>
                <strong>{template.displayName}</strong>
                <span>{template.language}</span>
                <StyledTemplatePreview>{template.body}</StyledTemplatePreview>
              </StyledTemplateDetails>
            </StyledTemplateOption>
          ))}
        </StyledTemplateList>
      )}
      {selectedTemplate !== null && (
        <>
          <StyledTemplateVariables>
            {selectedTemplate.variables.map((variable) => (
              <TextInput
                key={variable.key}
                label={t`Variable ${variable.key}`}
                value={variableValues[variable.key] ?? ''}
                maxLength={variable.maxLength}
                required={variable.required}
                disabled={sending}
                onChange={(value) => onVariableChange(variable.key, value)}
                fullWidth
              />
            ))}
          </StyledTemplateVariables>
          <StyledTemplatePreview aria-label={t`Message preview`}>
            {renderPreview(selectedTemplate.body, variableValues)}
          </StyledTemplatePreview>
        </>
      )}
      {errorMessage !== null && (
        <StyledComposerError role="alert">{errorMessage}</StyledComposerError>
      )}
      <StyledTemplateModalActions>
        <Button
          title={t`Cancel`}
          variant="secondary"
          onClick={handleClose}
          disabled={sending}
        />
        <Button
          title={sending ? t`Sending…` : t`Send template`}
          variant="primary"
          accent="blue"
          onClick={onSend}
          disabled={!variablesComplete || sending}
        />
      </StyledTemplateModalActions>
    </ModalStatefulWrapper>
  );
};
