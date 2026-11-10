import { ApolloProvider } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Callout } from 'twenty-ui/feedback';
import { IconInfoCircle } from 'twenty-ui/icon';

import { InconnectLeadManagementPage } from '~/pages/inconnect-lead-management/InconnectLeadManagementPage';
import { createLeadPoolStoryClient } from '~/pages/inconnect-lead-management/__stories__/createLeadPoolStoryClient';

const LeadPoolDemo = ({ storageReady }: { storageReady: boolean }) => {
  const { t } = useLingui();
  const [client] = useState(() => createLeadPoolStoryClient(storageReady));

  return (
    <ApolloProvider client={client}>
      <MemoryRouter
        initialEntries={['/inconnect-lead-management']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
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
            description={t`Las vistas previas y su cancelación sólo existen en memoria. La confirmación está deshabilitada. Recarga para restablecer la demostración.`}
          />
          <InconnectLeadManagementPage />
        </div>
      </MemoryRouter>
    </ApolloProvider>
  );
};

const meta = {
  title: 'Pages/INCONNECT Lead Management',
  component: LeadPoolDemo,
  render: ({ storageReady }) => (
    <LeadPoolDemo key={String(storageReady)} storageReady={storageReady} />
  ),
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta<typeof LeadPoolDemo>;

export default meta;

export const Demo: StoryObj<typeof meta> = { args: { storageReady: true } };

export const StorageUnavailable: StoryObj<typeof meta> = {
  args: { storageReady: false },
};
