import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { useNavigate } from 'react-router-dom';

import { SettingsInconnectMessagingContextEditor } from '@/settings/inconnect-messaging/components/SettingsInconnectMessagingContextEditor';
import { SaveAndCancelButtons } from '@/settings/components/SaveAndCancelButtons/SaveAndCancelButtons';
import { SettingsOptionCardContentButton } from '@/settings/components/SettingsOptions/SettingsOptionCardContentButton';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsSkeletonLoader } from '@/settings/components/SettingsSkeletonLoader';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { isGraphqlErrorOfType } from '~/utils/is-graphql-error-of-type.util';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Callout } from 'twenty-ui/feedback';
import {
  IconAlertTriangle,
  IconHierarchy2,
  IconMessage,
  IconRefresh,
} from 'twenty-ui/icon';
import { Section } from 'twenty-ui/layout';
import { Card } from 'twenty-ui/surfaces';
import { H2Title } from 'twenty-ui/typography';
import {
  InconnectMessagingContextConfigurationDocument,
  type InconnectMessagingContextConfigurationQuery,
  ReplaceInconnectMessagingContextConfigurationDocument,
} from '~/generated-metadata/graphql';

type ContextConfiguration =
  InconnectMessagingContextConfigurationQuery['inconnectMessagingContextConfiguration'];

const getConfiguredFieldMetadataIds = (configuration: ContextConfiguration) =>
  configuration.fields.map((field) => field.fieldMetadataId);

const areOrderedIdsEqual = (left: string[] | null, right: string[] | null) =>
  left !== null &&
  right !== null &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const isSettingsAccessLossError = (error: unknown) =>
  ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].some((errorCode) =>
    isGraphqlErrorOfType(error, errorCode),
  );

export const SettingsMessagingCrmContext = () => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();
  const configurationQuery = useQuery(
    InconnectMessagingContextConfigurationDocument,
    { fetchPolicy: 'network-only' },
  );
  const [replaceConfiguration, replaceState] = useMutation(
    ReplaceInconnectMessagingContextConfigurationDocument,
  );
  const [baselineFieldMetadataIds, setBaselineFieldMetadataIds] = useState<
    string[] | null
  >(null);
  const [draftFieldMetadataIds, setDraftFieldMetadataIds] = useState<
    string[] | null
  >(null);
  const [hasSaveError, setHasSaveError] = useState(false);

  const configuration =
    configurationQuery.data?.inconnectMessagingContextConfiguration;

  useEffect(() => {
    if (
      configuration === undefined ||
      baselineFieldMetadataIds !== null ||
      draftFieldMetadataIds !== null
    ) {
      return;
    }

    const configuredFieldMetadataIds =
      getConfiguredFieldMetadataIds(configuration);

    setBaselineFieldMetadataIds(configuredFieldMetadataIds);
    setDraftFieldMetadataIds(configuredFieldMetadataIds);
  }, [baselineFieldMetadataIds, configuration, draftFieldMetadataIds]);

  const isDirty = !areOrderedIdsEqual(
    baselineFieldMetadataIds,
    draftFieldMetadataIds,
  );
  const isDraftWithinLimit =
    draftFieldMetadataIds !== null &&
    configuration !== undefined &&
    draftFieldMetadataIds.length <= configuration.maximumFieldCount;

  const resetToConfiguration = (nextConfiguration: ContextConfiguration) => {
    const configuredFieldMetadataIds =
      getConfiguredFieldMetadataIds(nextConfiguration);

    setBaselineFieldMetadataIds(configuredFieldMetadataIds);
    setDraftFieldMetadataIds(configuredFieldMetadataIds);
    setHasSaveError(false);
  };

  const reloadConfiguration = async () => {
    try {
      const result = await configurationQuery.refetch();
      const nextConfiguration =
        result.data?.inconnectMessagingContextConfiguration;

      if (nextConfiguration !== undefined) {
        resetToConfiguration(nextConfiguration);
      }
    } catch {
      // The query state renders the safe retryable error.
    }
  };

  const handleSave = async () => {
    if (draftFieldMetadataIds === null || !isDirty || !isDraftWithinLimit) {
      return;
    }

    setHasSaveError(false);

    try {
      await replaceConfiguration({
        variables: { fieldMetadataIds: draftFieldMetadataIds },
      });
    } catch (error) {
      if (isSettingsAccessLossError(error)) {
        setBaselineFieldMetadataIds(null);
        setDraftFieldMetadataIds(null);
        navigate(getSettingsPath(SettingsPath.ProfilePage), { replace: true });
        return;
      }

      setHasSaveError(true);
      enqueueErrorSnackBar({
        message: t`CRM context configuration could not be saved.`,
      });
      return;
    }

    try {
      const result = await configurationQuery.refetch();
      const nextConfiguration =
        result.data?.inconnectMessagingContextConfiguration;

      if (nextConfiguration === undefined) {
        throw new Error('Configuration refetch returned no data');
      }

      resetToConfiguration(nextConfiguration);
      enqueueSuccessSnackBar({ message: t`Changes saved` });
    } catch {
      setHasSaveError(true);
      enqueueErrorSnackBar({
        message: t`The configuration was saved but could not be reloaded. Reload before editing again.`,
      });
    }
  };

  if (configurationQuery.loading && configuration === undefined) {
    return <SettingsSkeletonLoader />;
  }

  const hasQueryError =
    configurationQuery.error !== undefined || configuration === undefined;

  return (
    <SettingsPageLayout
      title={t`CRM context`}
      icon={<IconMessage />}
      actionButton={
        !hasQueryError && draftFieldMetadataIds !== null ? (
          <SaveAndCancelButtons
            onSave={() => void handleSave()}
            onCancel={() => {
              setDraftFieldMetadataIds(baselineFieldMetadataIds);
              setHasSaveError(false);
            }}
            isLoading={replaceState.loading}
            isSaveDisabled={
              !isDirty || !isDraftWithinLimit || replaceState.loading
            }
            isCancelDisabled={!isDirty || replaceState.loading}
          />
        ) : undefined
      }
      links={[
        {
          children: t`Workspace`,
          href: getSettingsPath(SettingsPath.General),
        },
        {
          children: t`Messaging`,
          href: getSettingsPath(SettingsPath.Messaging),
        },
        { children: t`CRM context` },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title
            title={t`CRM context`}
            description={t`Choose which CRM fields appear in Messaging and the order in which they are shown.`}
          />
        </Section>

        {hasQueryError ? (
          <Callout
            variant="error"
            Icon={IconAlertTriangle}
            title={t`Configuration unavailable`}
            description={t`CRM context configuration could not be loaded.`}
            action={{
              label: t`Retry`,
              onClick: () => void reloadConfiguration(),
            }}
          />
        ) : draftFieldMetadataIds === null ? (
          <SettingsSkeletonLoader />
        ) : (
          <>
            <Section>
              <H2Title
                title={t`CRM object`}
                description={t`The CRM object linked to Messaging conversations. This setting is read-only here.`}
              />
              <Card rounded>
                <SettingsOptionCardContentButton
                  Icon={IconHierarchy2}
                  title={configuration.anchorObject.label}
                  description={t`Current Messaging CRM anchor`}
                />
              </Card>
            </Section>

            {hasSaveError && (
              <Callout
                variant="error"
                Icon={IconRefresh}
                title={t`Changes were not confirmed`}
                description={t`Your draft is preserved. Retry saving, or reload the latest configuration and available fields.`}
                action={{
                  label: t`Reload`,
                  onClick: () => void reloadConfiguration(),
                }}
              />
            )}

            <SettingsInconnectMessagingContextEditor
              configuration={configuration}
              draftFieldMetadataIds={draftFieldMetadataIds}
              onChange={(fieldMetadataIds) => {
                setDraftFieldMetadataIds(fieldMetadataIds);
                setHasSaveError(false);
              }}
            />
          </>
        )}
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
