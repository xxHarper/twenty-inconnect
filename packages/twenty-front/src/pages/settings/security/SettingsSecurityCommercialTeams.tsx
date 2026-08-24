import { useQuery } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';

import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsSkeletonLoader } from '@/settings/components/SettingsSkeletonLoader';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsCommercialTeamsEditor } from '@/settings/security/commercial-teams/components/SettingsCommercialTeamsEditor';
import { Callout } from 'twenty-ui/feedback';
import { IconAlertTriangle, IconHierarchy2 } from 'twenty-ui/icon';
import { Section } from 'twenty-ui/layout';
import { H2Title } from 'twenty-ui/typography';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import {
  GetInconnectCommercialTeamAvailableMembersDocument,
  GetInconnectCommercialTeamsDocument,
} from '~/generated-metadata/graphql';

export const SettingsSecurityCommercialTeams = () => {
  const { t } = useLingui();
  const teamsQuery = useQuery(GetInconnectCommercialTeamsDocument, {
    fetchPolicy: 'network-only',
  });
  const availableMembersQuery = useQuery(
    GetInconnectCommercialTeamAvailableMembersDocument,
    { fetchPolicy: 'network-only' },
  );

  const teams = teamsQuery.data?.getInconnectCommercialTeams;
  const availableMembers =
    availableMembersQuery.data?.getInconnectCommercialTeamAvailableMembers;

  const refetchReadModels = async () => {
    await Promise.all([teamsQuery.refetch(), availableMembersQuery.refetch()]);
  };

  if (
    (teamsQuery.loading && teams === undefined) ||
    (availableMembersQuery.loading && availableMembers === undefined)
  ) {
    return <SettingsSkeletonLoader />;
  }

  const hasQueryError =
    teamsQuery.error !== undefined ||
    availableMembersQuery.error !== undefined ||
    teams === undefined ||
    availableMembers === undefined;

  return (
    <SettingsPageLayout
      title={t`Commercial Teams`}
      icon={<IconHierarchy2 />}
      links={[
        {
          children: t`Workspace`,
          href: getSettingsPath(SettingsPath.General),
        },
        {
          children: t`Security`,
          href: getSettingsPath(SettingsPath.Security),
        },
        { children: t`Commercial Teams` },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title
            title={t`Commercial Teams`}
            description={t`Organize workspace members into commercial teams used by team-based record access.`}
          />
          <div>
            {t`Roles determine access policies. Team membership determines which members belong to a team.`}
          </div>
        </Section>

        {hasQueryError ? (
          <Callout
            variant="error"
            Icon={IconAlertTriangle}
            title={t`Commercial teams could not be loaded`}
            description={t`Teams and available members must both be available before editing.`}
            action={{
              label: t`Retry`,
              onClick: () => void refetchReadModels(),
            }}
          />
        ) : (
          <SettingsCommercialTeamsEditor
            teams={teams}
            availableMembers={availableMembers}
            refetchReadModels={refetchReadModels}
          />
        )}
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
