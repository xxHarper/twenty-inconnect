import { useEffect, useState } from 'react';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useMutation, useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';

import { SaveAndCancelButtons } from '@/settings/components/SaveAndCancelButtons/SaveAndCancelButtons';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsSkeletonLoader } from '@/settings/components/SettingsSkeletonLoader';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsRecordAccessEditor } from '@/settings/security/record-access/components/SettingsRecordAccessEditor';
import {
  createEmptyInconnectRecordAccessDraft,
  type InconnectRecordAccessConfigurationDraft,
} from '@/settings/security/record-access/types/InconnectRecordAccessDraft';
import {
  configurationToInconnectRecordAccessDraft,
  getInconnectRecordAccessDraftSignature,
  inconnectRecordAccessDraftToInput,
  isInconnectRecordAccessDraftCompatibleWithMetadata,
  isInconnectRecordAccessDraftValid,
} from '@/settings/security/record-access/utils/inconnectRecordAccessDraftUtils';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Callout } from 'twenty-ui/feedback';
import { IconAlertTriangle, IconRefresh, IconShield } from 'twenty-ui/icon';
import { H2Title } from 'twenty-ui/typography';
import { Section } from 'twenty-ui/layout';
import {
  GetInconnectRecordAccessAvailableMetadataDocument,
  GetInconnectRecordAccessConfigurationDocument,
  InconnectRecordAccessCacheStatus,
  InconnectRecordAccessConfigurationStatus,
  InconnectRecordAccessEnforcementMode,
  ReplaceInconnectRecordAccessConfigurationDocument,
  type ReplaceInconnectRecordAccessConfigurationMutation,
} from '~/generated-metadata/graphql';

const DISABLE_MANAGED_ACCESS_MODAL_ID =
  'inconnect-record-access-disable-managed-modal';

const isRevisionConflictError = (error: unknown) =>
  CombinedGraphQLErrors.is(error) &&
  error.errors.some(
    (graphQLError) => graphQLError.extensions?.subCode === 'REVISION_CONFLICT',
  );

export const SettingsSecurityRecordAccess = () => {
  const { t } = useLingui();
  const { openModal } = useModal();
  const {
    enqueueErrorSnackBar,
    enqueueSuccessSnackBar,
    enqueueWarningSnackBar,
  } = useSnackBar();

  const configurationQuery = useQuery(
    GetInconnectRecordAccessConfigurationDocument,
    { fetchPolicy: 'network-only' },
  );
  const metadataQuery = useQuery(
    GetInconnectRecordAccessAvailableMetadataDocument,
    { fetchPolicy: 'network-only' },
  );
  const [replaceConfiguration, replaceState] = useMutation(
    ReplaceInconnectRecordAccessConfigurationDocument,
  );

  const [baselineDraft, setBaselineDraft] =
    useState<InconnectRecordAccessConfigurationDraft | null>(null);
  const [draft, setDraft] =
    useState<InconnectRecordAccessConfigurationDraft | null>(null);
  const [hasRevisionConflict, setHasRevisionConflict] = useState(false);
  const [hasCacheRecomputationFailure, setHasCacheRecomputationFailure] =
    useState(false);
  const [lastLoadedConfigurationKey, setLastLoadedConfigurationKey] = useState<
    string | null
  >(null);

  const configuration =
    configurationQuery.data?.getInconnectRecordAccessConfiguration;
  const metadata =
    metadataQuery.data?.getInconnectRecordAccessAvailableMetadata;

  useEffect(() => {
    if (!configuration) {
      return;
    }

    const configurationKey = `${configuration.status}:${configuration.revision ?? 'none'}`;

    if (configurationKey === lastLoadedConfigurationKey) {
      return;
    }

    const nextDraft = configurationToInconnectRecordAccessDraft(configuration);

    setLastLoadedConfigurationKey(configurationKey);
    setBaselineDraft(nextDraft);
    setDraft(nextDraft);
    setHasRevisionConflict(false);
  }, [configuration, lastLoadedConfigurationKey]);

  const isDirty =
    getInconnectRecordAccessDraftSignature(draft) !==
    getInconnectRecordAccessDraftSignature(baselineDraft);
  const isDraftValid =
    draft !== null &&
    metadata !== undefined &&
    isInconnectRecordAccessDraftValid(draft) &&
    isInconnectRecordAccessDraftCompatibleWithMetadata({
      draft,
      metadata,
    });

  const reload = async () => {
    setHasRevisionConflict(false);
    setHasCacheRecomputationFailure(false);
    await Promise.all([configurationQuery.refetch(), metadataQuery.refetch()]);
  };

  const publishDraft = async () => {
    if (!draft || !configuration || !isDraftValid) {
      return;
    }

    let publishResult:
      | ReplaceInconnectRecordAccessConfigurationMutation['replaceInconnectRecordAccessConfiguration']
      | undefined;

    try {
      const result = await replaceConfiguration({
        variables: {
          input: inconnectRecordAccessDraftToInput({
            draft,
            expectedRevision: configuration.revision ?? null,
          }),
        },
      });

      publishResult = result.data?.replaceInconnectRecordAccessConfiguration;
    } catch (error) {
      if (isRevisionConflictError(error)) {
        setHasRevisionConflict(true);
        return;
      }

      enqueueErrorSnackBar({
        apolloError: CombinedGraphQLErrors.is(error) ? error : undefined,
      });
      return;
    }

    if (
      publishResult?.cacheStatus ===
      InconnectRecordAccessCacheStatus.recomputationFailed
    ) {
      setHasCacheRecomputationFailure(true);
      enqueueWarningSnackBar({
        message: t`Configuration was saved, but the record-access cache could not be refreshed. Access is temporarily fail-closed.`,
      });
    } else {
      setHasCacheRecomputationFailure(false);
      enqueueSuccessSnackBar({
        message: t`Record access configuration saved.`,
      });
    }

    try {
      await configurationQuery.refetch();
    } catch {
      enqueueWarningSnackBar({
        message: t`Configuration was saved, but the latest revision could not be reloaded. Reload the page before editing again.`,
      });
    }
  };

  const handleSave = () => {
    if (
      configuration?.status ===
        InconnectRecordAccessConfigurationStatus.MANAGED &&
      draft?.enforcementMode === InconnectRecordAccessEnforcementMode.UNMANAGED
    ) {
      openModal(DISABLE_MANAGED_ACCESS_MODAL_ID);
      return;
    }

    void publishDraft();
  };

  const handleCancel = () => {
    setDraft(baselineDraft);
    setHasRevisionConflict(false);
  };

  if (
    (configurationQuery.loading && configuration === undefined) ||
    (metadataQuery.loading && metadata === undefined)
  ) {
    return <SettingsSkeletonLoader />;
  }

  const hasQueryError =
    configurationQuery.error !== undefined ||
    metadataQuery.error !== undefined ||
    configuration === undefined ||
    metadata === undefined;

  return (
    <SettingsPageLayout
      title={t`Record Access`}
      icon={<IconShield />}
      actionButton={
        draft !== null && !hasQueryError ? (
          <SaveAndCancelButtons
            onSave={handleSave}
            onCancel={handleCancel}
            isLoading={replaceState.loading}
            isSaveDisabled={!isDirty || !isDraftValid || replaceState.loading}
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
          children: t`Security`,
          href: getSettingsPath(SettingsPath.Security),
        },
        { children: t`Record Access` },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title
            title={t`Record Access`}
            description={t`Control which records members can access based on their role and record owner.`}
          />
          {configuration?.revision && (
            <div>{t`Revision ${configuration.revision}`}</div>
          )}
        </Section>

        {hasQueryError ? (
          <Callout
            variant="error"
            Icon={IconAlertTriangle}
            title={t`Record access could not be loaded`}
            description={t`Configuration and metadata must both be available before editing.`}
            action={{ label: t`Retry`, onClick: () => void reload() }}
          />
        ) : (
          <>
            {hasRevisionConflict && (
              <Callout
                variant="warning"
                Icon={IconRefresh}
                title={t`Configuration changed`}
                description={t`This configuration changed since you opened it. Reload the latest version before saving.`}
                action={{
                  label: t`Reload`,
                  onClick: () => void reload(),
                }}
              />
            )}
            {hasCacheRecomputationFailure && (
              <Callout
                variant="error"
                Icon={IconAlertTriangle}
                title={t`Access is temporarily fail-closed`}
                description={t`Configuration was saved, but the record-access cache could not be refreshed.`}
              />
            )}
            {draft === null ? (
              <Callout
                variant="neutral"
                Icon={IconShield}
                title={t`Record access is not configured`}
                description={t`Record access is not configured for this workspace.`}
                action={{
                  label: t`Set up record access`,
                  onClick: () =>
                    setDraft(createEmptyInconnectRecordAccessDraft()),
                }}
              />
            ) : (
              <SettingsRecordAccessEditor
                draft={draft}
                metadata={metadata}
                onChange={setDraft}
              />
            )}
          </>
        )}
      </SettingsPageContainer>

      <ConfirmationModal
        modalInstanceId={DISABLE_MANAGED_ACCESS_MODAL_ID}
        title={t`Disable managed record access?`}
        subtitle={t`Disabling managed record access may allow users to see records previously restricted by these policies.`}
        confirmButtonText={t`Disable and save`}
        onConfirmClick={() => void publishDraft()}
      />
    </SettingsPageLayout>
  );
};
