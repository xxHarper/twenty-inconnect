import { ApolloProvider } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Callout } from 'twenty-ui/feedback';
import { IconInfoCircle } from 'twenty-ui/icon';

import { SnackBarProvider } from '@/ui/feedback/snack-bar-manager/components/SnackBarProvider';
import { InconnectRecordAccessCacheStatus } from '~/generated-metadata/graphql';
import { SettingsSecurityRecordAccess } from '~/pages/settings/security/SettingsSecurityRecordAccess';
import { createRecordAccessStoryClient } from '~/pages/settings/security/__stories__/createRecordAccessStoryClient';
import { SnackBarDecorator } from '~/testing/decorators/SnackBarDecorator';

const RecordAccessDemo = ({
  cacheStatus,
}: {
  cacheStatus?: InconnectRecordAccessCacheStatus;
}) => {
  const { t } = useLingui();
  const [client] = useState(() => createRecordAccessStoryClient(cacheStatus));

  return (
    <ApolloProvider client={client}>
      <MemoryRouter
        initialEntries={['/settings/security/record-access']}
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
              description={t`El Role determina la política. Commercial Teams aporta las membresías al alcance de equipo. Record Access restringe los registros según la política y los permisos de Twenty. Los cambios se guardan en memoria y se restablecen al recargar.`}
            />
            <SettingsSecurityRecordAccess />
          </div>
        </SnackBarProvider>
      </MemoryRouter>
    </ApolloProvider>
  );
};

const meta = {
  title: 'Pages/Settings/Security/Record Access',
  component: RecordAccessDemo,
  decorators: [SnackBarDecorator],
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta<typeof RecordAccessDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Demo: Story = {};

export const CacheRecomputationFailure: Story = {
  name: 'Fallo de recomputación de caché',
  args: { cacheStatus: InconnectRecordAccessCacheStatus.recomputationFailed },
};
