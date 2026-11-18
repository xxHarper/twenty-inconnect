import { useUnmountCommand } from '@/command-menu-item/engine-command/hooks/useUnmountEngineCommand';
import { CommandComponentInstanceContext } from '@/command-menu-item/engine-command/states/contexts/CommandComponentInstanceContext';
import { PreComputedChipGeneratorsProvider } from '@/object-metadata/components/PreComputedChipGeneratorsProvider';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { getFieldMetadataItemGqlFieldName } from '@/object-metadata/utils/getFieldMetadataItemGqlFieldName';
import { isManyToOneRelationField } from '@/object-metadata/utils/isManyToOneRelationField';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { FormSingleRecordPicker } from '@/object-record/record-field/ui/form-types/components/FormSingleRecordPicker';
import { InputHint } from '@/ui/input/components/InputHint';
import { TextInput } from '@/ui/input/components/TextInput';
import { useAvailableComponentInstanceIdOrThrow } from '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useLingui } from '@lingui/react/macro';
import { atom, useAtomValue, useStore } from 'jotai';
import { type FormEvent, useState } from 'react';
import { AppPath } from 'twenty-shared/types';
import { isDefined, isValidUuid } from 'twenty-shared/utils';
import { Button } from 'twenty-ui/input';
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from 'twenty-ui/surfaces';
import { H2Title } from 'twenty-ui/typography';
import { useIsMobile } from 'twenty-ui/utilities';
import { v4 } from 'uuid';
import { FieldMetadataType } from '~/generated-metadata/graphql';
import { useNavigateApp } from '~/hooks/useNavigateApp';

type CreateLeadFromIndexDialogProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
};

export const CreateLeadFromIndexDialog = ({
  objectMetadataItem,
}: CreateLeadFromIndexDialogProps) => {
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const commandId = useAvailableComponentInstanceIdOrThrow(
    CommandComponentInstanceContext,
  );
  const unmountCommand = useUnmountCommand();
  const navigate = useNavigateApp();
  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular: objectMetadataItem.nameSingular,
  });

  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Keep the same ID on retries in case a previous response was lost after commit.
  const [draftId] = useState(() => v4());
  const [isSavingAtom] = useState(() => atom(false));
  const store = useStore();
  const isSaving = useAtomValue(isSavingAtom);

  const nameField = objectMetadataItem.updatableFields.find(
    (field) =>
      field.id === objectMetadataItem.labelIdentifierFieldMetadataId &&
      field.type === FieldMetadataType.TEXT &&
      field.isActive &&
      field.isUIEditable,
  );
  const ownerField = objectMetadataItem.updatableFields
    .filter(isManyToOneRelationField)
    .find(
      (field) =>
        field.name === 'owner' &&
        field.isActive &&
        field.isUIEditable &&
        field.relation.targetObjectMetadata.nameSingular === 'workspaceMember',
    );

  const handleCancel = () => {
    if (!store.get(isSavingAtom)) {
      unmountCommand(commandId);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (
      store.get(isSavingAtom) ||
      !nameField ||
      !ownerField ||
      !trimmedName ||
      !ownerId
    ) {
      return;
    }

    store.set(isSavingAtom, true);
    setErrorMessage(null);

    let createdLeadId: string;
    try {
      const lead = await createOneRecord({
        id: draftId,
        [nameField.name]: trimmedName,
        [getFieldMetadataItemGqlFieldName(ownerField)]: ownerId,
        position: 'first',
      });
      createdLeadId = lead.id;
    } catch (error) {
      setErrorMessage(
        CombinedGraphQLErrors.is(error)
          ? t`The lead could not be saved. Check the selected owner and your permissions.`
          : t`The lead could not be confirmed. Retry from this form.`,
      );
      store.set(isSavingAtom, false);
      return;
    }

    unmountCommand(commandId);
    navigate(AppPath.RecordShowPage, {
      objectNameSingular: objectMetadataItem.nameSingular,
      objectRecordId: createdLeadId,
    });
  };

  const title = t`New lead`;

  return (
    <Modal
      isOpen
      ariaLabel={title}
      autoHeight
      size="small"
      padding="none"
      isMobile={isMobile}
    >
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <H2Title title={title} />
        </ModalHeader>
        <ModalContent gap={3}>
          {nameField && ownerField ? (
            <>
              <TextInput
                label={nameField.label}
                value={name}
                onChange={setName}
                disabled={isSaving}
                fullWidth
                required
                autoFocus
              />
              <PreComputedChipGeneratorsProvider>
                <FormSingleRecordPicker
                  label={ownerField.label}
                  defaultValue={ownerId}
                  onChange={(value) =>
                    setOwnerId(
                      isDefined(value) && isValidUuid(value) ? value : null,
                    )
                  }
                  onClear={() => setOwnerId(null)}
                  objectNameSingulars={[
                    ownerField.relation.targetObjectMetadata.nameSingular,
                  ]}
                  isDropdownInModal
                  disabled={isSaving}
                />
              </PreComputedChipGeneratorsProvider>
              {errorMessage && (
                <InputHint danger role="alert">
                  {errorMessage}
                </InputHint>
              )}
            </>
          ) : (
            <InputHint danger role="alert">
              {t`Name and Owner must be available and editable to create a lead.`}
            </InputHint>
          )}
        </ModalContent>
        <ModalFooter>
          <Button
            title={t`Cancel`}
            type="button"
            variant="secondary"
            disabled={isSaving}
            onClick={handleCancel}
          />
          <Button
            title={t`Save`}
            type="submit"
            accent="blue"
            isLoading={isSaving}
            disabled={
              isSaving || !nameField || !ownerField || !name.trim() || !ownerId
            }
          />
        </ModalFooter>
      </form>
    </Modal>
  );
};
