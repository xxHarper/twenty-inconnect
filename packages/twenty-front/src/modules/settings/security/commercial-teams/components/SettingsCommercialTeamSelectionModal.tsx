import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { Select } from '@/ui/input/components/Select';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { Button } from 'twenty-ui/input';
import { Section, SectionAlignment, SectionFontColor } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { H1Title, H1TitleFontColor } from 'twenty-ui/typography';

const StyledDescription = styled.div`
  margin-bottom: ${themeCssVariables.spacing[4]};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  margin-top: ${themeCssVariables.spacing[6]};

  > div {
    flex: 1;
  }
`;

type SettingsCommercialTeamSelectionModalProps = {
  modalInstanceId: string;
  title: string;
  description: string;
  selectLabel: string;
  confirmLabel: string;
  emptyLabel: string;
  options: Array<{ label: string; value: string }>;
  isLoading: boolean;
  onSubmit: (value: string) => Promise<boolean>;
  onClose: () => void;
};

export const SettingsCommercialTeamSelectionModal = ({
  modalInstanceId,
  title,
  description,
  selectLabel,
  confirmLabel,
  emptyLabel,
  options,
  isLoading,
  onSubmit,
  onClose,
}: SettingsCommercialTeamSelectionModalProps) => {
  const { t } = useLingui();
  const { closeModal } = useModal();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [title]);

  const handleClose = () => {
    closeModal(modalInstanceId);
    onClose();
  };

  const handleSubmit = async () => {
    if (value.length === 0) {
      return;
    }

    if (await onSubmit(value)) {
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
      <StyledDescription>
        <Section
          alignment={SectionAlignment.Center}
          fontColor={SectionFontColor.Primary}
        >
          {description}
        </Section>
      </StyledDescription>
      <Select
        dropdownId={`${modalInstanceId}-selection`}
        label={selectLabel}
        value={value}
        emptyOption={{ label: emptyLabel, value: '' }}
        options={options}
        onChange={setValue}
        fullWidth
        isDropdownInModal
      />
      {options.length === 0 && (
        <Section fontColor={SectionFontColor.Secondary}>
          {t`No compatible options are currently available.`}
        </Section>
      )}
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
          disabled={value.length === 0 || isLoading}
          onClick={() => void handleSubmit()}
          fullWidth
          justify="center"
        />
      </StyledActions>
    </ModalStatefulWrapper>
  );
};
