import { useLingui } from '@lingui/react/macro';

import {
  StyledAvailableFieldList,
  StyledEmptyState,
  StyledFieldActions,
  StyledFieldDetails,
  StyledFieldKind,
  StyledFieldLabel,
  StyledFieldList,
  StyledFieldPosition,
  StyledFieldRow,
  StyledLimitMessage,
} from '@/settings/inconnect-messaging/components/SettingsInconnectMessagingContextEditor.styles';
import {
  IconArrowDown,
  IconArrowUp,
  IconMinus,
  IconPlus,
} from 'twenty-ui/icon';
import { Button, LightIconButton } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { Card } from 'twenty-ui/surfaces';
import { H2Title } from 'twenty-ui/typography';
import { type InconnectMessagingContextConfigurationQuery } from '~/generated-metadata/graphql';

type ContextConfiguration =
  InconnectMessagingContextConfigurationQuery['inconnectMessagingContextConfiguration'];

type SettingsInconnectMessagingContextEditorProps = {
  configuration: ContextConfiguration;
  draftFieldMetadataIds: string[];
  onChange: (fieldMetadataIds: string[]) => void;
};

export const SettingsInconnectMessagingContextEditor = ({
  configuration,
  draftFieldMetadataIds,
  onChange,
}: SettingsInconnectMessagingContextEditorProps) => {
  const { t } = useLingui();
  const selectedIdSet = new Set(draftFieldMetadataIds);
  const candidateById = new Map(
    configuration.availableFields.map((field) => [
      field.fieldMetadataId,
      field,
    ]),
  );
  const configuredById = new Map(
    configuration.fields.map((field) => [field.fieldMetadataId, field]),
  );
  const selectedFields = draftFieldMetadataIds.flatMap((fieldMetadataId) => {
    const field =
      candidateById.get(fieldMetadataId) ?? configuredById.get(fieldMetadataId);

    return field === undefined ? [] : [field];
  });
  const availableFields = configuration.availableFields.filter(
    (field) => !selectedIdSet.has(field.fieldMetadataId),
  );
  const isAtLimit =
    draftFieldMetadataIds.length >= configuration.maximumFieldCount;

  const moveField = (index: number, nextIndex: number) => {
    const nextIds = [...draftFieldMetadataIds];
    const [fieldMetadataId] = nextIds.splice(index, 1);

    if (fieldMetadataId === undefined) {
      return;
    }

    nextIds.splice(nextIndex, 0, fieldMetadataId);
    onChange(nextIds);
  };

  const addField = (fieldMetadataId: string) => {
    if (selectedIdSet.has(fieldMetadataId) || isAtLimit) {
      return;
    }

    onChange([...draftFieldMetadataIds, fieldMetadataId]);
  };

  const removeField = (fieldMetadataId: string) => {
    onChange(
      draftFieldMetadataIds.filter(
        (selectedFieldMetadataId) =>
          selectedFieldMetadataId !== fieldMetadataId,
      ),
    );
  };

  return (
    <>
      <Section>
        <H2Title
          title={t`Fields shown in Messaging`}
          description={t`${draftFieldMetadataIds.length} of ${configuration.maximumFieldCount} fields selected. Their order here is their display order in Messaging.`}
        />
        <Card rounded>
          {selectedFields.length === 0 ? (
            <StyledEmptyState>{t`No fields selected`}</StyledEmptyState>
          ) : (
            <StyledFieldList aria-label={t`Fields shown in Messaging`}>
              {selectedFields.map((field, index) => (
                <StyledFieldRow
                  divider={index < selectedFields.length - 1}
                  key={field.fieldMetadataId}
                >
                  <StyledFieldPosition aria-hidden="true">
                    {index + 1}.
                  </StyledFieldPosition>
                  <StyledFieldDetails>
                    <StyledFieldLabel>{field.label}</StyledFieldLabel>
                    {'isLabelIdentifier' in field &&
                      field.isLabelIdentifier && (
                        <StyledFieldKind>
                          {t`Canonical record label`}
                        </StyledFieldKind>
                      )}
                  </StyledFieldDetails>
                  <StyledFieldActions>
                    <LightIconButton
                      Icon={IconArrowUp}
                      aria-label={t`Move ${field.label} up`}
                      title={t`Move up`}
                      disabled={index === 0}
                      onClick={() => moveField(index, index - 1)}
                    />
                    <LightIconButton
                      Icon={IconArrowDown}
                      aria-label={t`Move ${field.label} down`}
                      title={t`Move down`}
                      disabled={index === selectedFields.length - 1}
                      onClick={() => moveField(index, index + 1)}
                    />
                    <Button
                      Icon={IconMinus}
                      title={t`Remove`}
                      ariaLabel={t`Remove ${field.label}`}
                      variant="tertiary"
                      size="small"
                      onClick={() => removeField(field.fieldMetadataId)}
                    />
                  </StyledFieldActions>
                </StyledFieldRow>
              ))}
            </StyledFieldList>
          )}
        </Card>
        {selectedFields.length === 0 && (
          <StyledLimitMessage>
            {t`Messaging will continue to show the CRM object and record summary without additional context fields.`}
          </StyledLimitMessage>
        )}
      </Section>

      <Section>
        <H2Title
          title={t`Available fields`}
          description={t`Add fields provided by the CRM context management service.`}
        />
        <Card rounded>
          {availableFields.length === 0 ? (
            <StyledEmptyState>{t`No available fields`}</StyledEmptyState>
          ) : (
            <StyledAvailableFieldList aria-label={t`Available fields`}>
              {availableFields.map((field, index) => (
                <StyledFieldRow
                  divider={index < availableFields.length - 1}
                  key={field.fieldMetadataId}
                >
                  <StyledFieldDetails>
                    <StyledFieldLabel>{field.label}</StyledFieldLabel>
                    {field.isLabelIdentifier && (
                      <StyledFieldKind>
                        {t`Canonical record label`}
                      </StyledFieldKind>
                    )}
                  </StyledFieldDetails>
                  <Button
                    Icon={IconPlus}
                    title={t`Add`}
                    ariaLabel={
                      isAtLimit
                        ? t`Add ${field.label}; maximum ${configuration.maximumFieldCount} fields selected`
                        : t`Add ${field.label}`
                    }
                    variant="secondary"
                    size="small"
                    disabled={isAtLimit}
                    onClick={() => addField(field.fieldMetadataId)}
                  />
                </StyledFieldRow>
              ))}
            </StyledAvailableFieldList>
          )}
        </Card>
        {isAtLimit && availableFields.length > 0 && (
          <StyledLimitMessage role="status">
            {t`Maximum ${configuration.maximumFieldCount} fields selected. Remove a field before adding another.`}
          </StyledLimitMessage>
        )}
      </Section>
    </>
  );
};
