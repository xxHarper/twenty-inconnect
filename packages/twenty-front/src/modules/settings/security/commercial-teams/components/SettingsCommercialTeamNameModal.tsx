import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { H1Title, H1TitleFontColor } from 'twenty-ui/typography';

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  margin-top: ${themeCssVariables.spacing[6]};

  > div {
    flex: 1;
  }
`;

type SettingsCommercialTeamNameModalProps = {
  modalInstanceId: string;
  title: string;
  confirmLabel: string;
  initialName?: string;
  isLoading: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
};

export const SettingsCommercialTeamNameModal = ({
  modalInstanceId,
  title,
  confirmLabel,
  initialName = '',
  isLoading,
  onSubmit,
  onClose,
}: SettingsCommercialTeamNameModalProps) => {
  const { t } = useLingui();
  const { closeModal } = useModal();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const handleClose = () => {
    closeModal(modalInstanceId);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      return;
    }

    if (await onSubmit(trimmedName)) {
      handleClose();
    }
  };

  return (
    <ModalStatefulWrapper
      modalInstanceId={modalInstanceId}
      onClose={onClose}
      onEnter={() => void handleSubmit()}
      isClosable
      padding="large"
      overlay="dark"
      dataGloballyPreventClickOutside
      renderInDocumentBody
      smallBorderRadius
      narrowWidth
      autoHeight
    >
      <H1Title title={title} fontColor={H1TitleFontColor.Primary} />
      <SettingsTextInput
        instanceId={`${modalInstanceId}-name`}
        label={t`Team name`}
        value={name}
        onChange={setName}
        fullWidth
        autoFocusOnMount
      />
      <StyledActions>
        <Button
          title={t`Cancel`}
          variant="secondary"
          onClick={handleClose}
          fullWidth
          justify="center"
        />
        <Button
          title={confirmLabel}
          variant="primary"
          accent="blue"
          disabled={name.trim().length === 0 || isLoading}
          onClick={() => void handleSubmit()}
          fullWidth
          justify="center"
        />
      </StyledActions>
    </ModalStatefulWrapper>
  );
};
