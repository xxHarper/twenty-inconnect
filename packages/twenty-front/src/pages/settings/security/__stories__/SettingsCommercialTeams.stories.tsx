import { ApolloProvider } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { IconInfoCircle } from 'twenty-ui/icon';
import { Callout } from 'twenty-ui/feedback';

import { SnackBarProvider } from '@/ui/feedback/snack-bar-manager/components/SnackBarProvider';
import { SettingsSecurityCommercialTeams } from '~/pages/settings/security/SettingsSecurityCommercialTeams';
import { createCommercialTeamsStoryClient } from '~/pages/settings/security/__stories__/createCommercialTeamsStoryClient';
import { SnackBarDecorator } from '~/testing/decorators/SnackBarDecorator';

const CommercialTeamsDemo = () => {
  const { t } = useLingui();
  const [client] = useState(createCommercialTeamsStoryClient);

  return (
    <ApolloProvider client={client}>
      <MemoryRouter
        initialEntries={['/settings/security/commercial-teams']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SnackBarProvider>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              height: '100dvh',
              padding: 16,
              boxSizing: 'border-box',
            }}
          >
            <Callout
              variant="neutral"
              Icon={IconInfoCircle}
              title={t`Demostración con datos ficticios`}
              description={t`Los cambios sólo existen en esta sesión. Recarga la historia para restablecer los datos de ejemplo.`}
            />
            <SettingsSecurityCommercialTeams />
          </div>
        </SnackBarProvider>
      </MemoryRouter>
    </ApolloProvider>
  );
};

const meta = {
  title: 'Pages/Settings/Security/Commercial Teams',
  component: CommercialTeamsDemo,
  decorators: [SnackBarDecorator],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CommercialTeamsDemo>;

export default meta;

export const Demo: StoryObj<typeof meta> = {};
