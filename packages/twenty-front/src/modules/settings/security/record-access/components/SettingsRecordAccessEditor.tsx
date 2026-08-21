import { styled } from '@linaria/react';
import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { SettingsRecordAccessManagedObjectCard } from '@/settings/security/record-access/components/SettingsRecordAccessManagedObjectCard';
import { type InconnectRecordAccessConfigurationDraft } from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import { Select } from '@/ui/input/components/Select';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import {
  InconnectRecordAccessEnforcementMode,
  InconnectRecordAccessOwnerRequirement,
  type InconnectRecordAccessSettingsAvailableMetadata,
} from '~/generated-metadata/graphql';
import { Callout } from 'twenty-ui/feedback';
import { IconAlertTriangle, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { H2Title } from 'twenty-ui/typography';
import { Section } from 'twenty-ui/layout';

const REMOVE_OBJECT_MODAL_ID = 'inconnect-record-access-remove-object-modal';

const StyledEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const StyledManagedObjects = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const StyledAddObject = styled.div`
  align-items: flex-end;
  display: flex;
  gap: 8px;
`;

const StyledSelectContainer = styled.div`
  flex: 1;
`;

type SettingsRecordAccessEditorProps = {
  draft: InconnectRecordAccessConfigurationDraft;
  metadata: InconnectRecordAccessSettingsAvailableMetadata;
  onChange: (draft: InconnectRecordAccessConfigurationDraft) => void;
};

export const SettingsRecordAccessEditor = ({
  draft,
  metadata,
  onChange,
}: SettingsRecordAccessEditorProps) => {
  const { t } = useLingui();
  const { openModal } = useModal();
  const [objectToAddId, setObjectToAddId] = useState('');
  const [objectToRemoveId, setObjectToRemoveId] = useState<string | null>(null);

  const usedObjectIds = new Set(
    draft.managedObjects.map((managedObject) => managedObject.objectMetadataId),
  );
  const availableObjects = metadata.objects.filter(
    (objectMetadata) =>
      objectMetadata.isActive &&
      objectMetadata.ownerFields.length > 0 &&
      !usedObjectIds.has(objectMetadata.objectMetadataId),
  );

  const handleAddObject = () => {
    const objectMetadata = metadata.objects.find(
      (candidate) => candidate.objectMetadataId === objectToAddId,
    );
    const ownerField = objectMetadata?.ownerFields[0];

    if (!objectMetadata || !ownerField) {
      return;
    }

    onChange({
      ...draft,
      managedObjects: [
        ...draft.managedObjects,
        {
          draftId: `managed-object-${objectMetadata.objectMetadataId}`,
          objectMetadataId: objectMetadata.objectMetadataId,
          ownerFieldMetadataId: ownerField.fieldMetadataId,
          ownerRequirement: InconnectRecordAccessOwnerRequirement.required,
          policies: [],
        },
      ],
    });
    setObjectToAddId('');
  };

  const requestRemoveObject = (objectMetadataId: string) => {
    setObjectToRemoveId(objectMetadataId);
    openModal(REMOVE_OBJECT_MODAL_ID);
  };

  const removeObject = () => {
    if (objectToRemoveId === null) {
      return;
    }

    onChange({
      ...draft,
      managedObjects: draft.managedObjects.filter(
        (managedObject) => managedObject.objectMetadataId !== objectToRemoveId,
      ),
    });
    setObjectToRemoveId(null);
  };

  const objectToRemoveLabel = metadata.objects.find(
    (objectMetadata) => objectMetadata.objectMetadataId === objectToRemoveId,
  )?.labelSingular;

  return (
    <StyledEditor>
      <Section>
        <H2Title
          title={t`Enforcement`}
          description={t`Choose whether INCONNECT policies restrict selected objects.`}
        />
        <Select
          dropdownId="inconnect-record-access-enforcement-mode"
          fullWidth
          label={t`Enforcement mode`}
          value={draft.enforcementMode}
          options={[
            {
              label: t`Managed record access`,
              value: InconnectRecordAccessEnforcementMode.MANAGED,
            },
            {
              label: t`Standard Twenty permissions`,
              value: InconnectRecordAccessEnforcementMode.UNMANAGED,
            },
          ]}
          onChange={(enforcementMode) =>
            onChange({ ...draft, enforcementMode })
          }
        />
      </Section>

      {draft.enforcementMode ===
      InconnectRecordAccessEnforcementMode.UNMANAGED ? (
        <Callout
          variant="warning"
          Icon={IconAlertTriangle}
          title={t`Record access is unmanaged`}
          description={t`Standard Twenty permissions apply without INCONNECT record-level restrictions.`}
        />
      ) : (
        <Section>
          <H2Title
            title={t`Managed objects`}
            description={t`Apply record-access policies to selected objects.`}
          />
          <StyledManagedObjects>
            {draft.managedObjects.map((managedObject) => {
              const objectMetadata = metadata.objects.find(
                (candidate) =>
                  candidate.objectMetadataId === managedObject.objectMetadataId,
              );

              if (!objectMetadata) {
                return (
                  <Callout
                    key={managedObject.draftId}
                    variant="error"
                    Icon={IconAlertTriangle}
                    title={t`Object metadata is unavailable`}
                    description={t`Reload the page before editing this configuration.`}
                  />
                );
              }

              return (
                <SettingsRecordAccessManagedObjectCard
                  key={managedObject.draftId}
                  managedObject={managedObject}
                  objectMetadata={objectMetadata}
                  roles={metadata.roles}
                  onChange={(nextManagedObject) =>
                    onChange({
                      ...draft,
                      managedObjects: draft.managedObjects.map(
                        (currentManagedObject) =>
                          currentManagedObject.draftId === managedObject.draftId
                            ? nextManagedObject
                            : currentManagedObject,
                      ),
                    })
                  }
                  onRequestRemove={() =>
                    requestRemoveObject(managedObject.objectMetadataId)
                  }
                />
              );
            })}

            {availableObjects.length > 0 && (
              <StyledAddObject>
                <StyledSelectContainer>
                  <Select
                    dropdownId="inconnect-record-access-add-object"
                    fullWidth
                    label={t`Add object`}
                    value={objectToAddId}
                    emptyOption={{
                      label: t`Select an object`,
                      value: '',
                    }}
                    options={availableObjects.map((objectMetadata) => ({
                      label: objectMetadata.labelSingular,
                      value: objectMetadata.objectMetadataId,
                    }))}
                    onChange={setObjectToAddId}
                  />
                </StyledSelectContainer>
                <Button
                  title={t`Add`}
                  Icon={IconPlus}
                  variant="secondary"
                  disabled={objectToAddId.length === 0}
                  onClick={handleAddObject}
                />
              </StyledAddObject>
            )}
          </StyledManagedObjects>
        </Section>
      )}

      <ConfirmationModal
        modalInstanceId={REMOVE_OBJECT_MODAL_ID}
        title={t`Remove managed object?`}
        subtitle={t`Removing ${objectToRemoveLabel ?? 'this object'} will restore standard Twenty permissions after you save.`}
        confirmButtonText={t`Remove object`}
        onConfirmClick={removeObject}
        onClose={() => setObjectToRemoveId(null)}
      />
    </StyledEditor>
  );
};
