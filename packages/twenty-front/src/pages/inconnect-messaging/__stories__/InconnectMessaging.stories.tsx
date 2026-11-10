import { ApolloProvider } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import { type Meta, type StoryObj } from '@storybook/react-vite';
import { atom, type Atom, createStore, Provider } from 'jotai';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Callout } from 'twenty-ui/feedback';
import { IconInfoCircle } from 'twenty-ui/icon';

import {
  type CurrentUserWorkspace,
  currentUserWorkspaceState,
} from '@/auth/states/currentUserWorkspaceState';
import { INCONNECT_MESSAGING_PATH } from '@/inconnect-messaging/constants/InconnectMessagingPath';
import { PermissionFlagType } from '~/generated-metadata/graphql';
import { InconnectMessagingPage } from '~/pages/inconnect-messaging/InconnectMessagingPage';
import { createMessagingStoryClient } from '~/pages/inconnect-messaging/__stories__/createMessagingStoryClient';

const demoWorkspace = atom<CurrentUserWorkspace | null>({
  permissionFlags: [PermissionFlagType.INCONNECT_MESSAGING],
  twoFactorAuthenticationMethodSummary: [],
  objectsPermissions: [],
  isImpersonating: false,
});

const createMessagingStoryStore = (): ReturnType<typeof createStore> => {
  const store = createStore();
  // Keep the simulated permission in this story's store instead of localStorage.
  const storyAtom = <Value,>(target: Atom<Value>): Atom<Value> =>
    Object.is(target, currentUserWorkspaceState.atom)
      ? (demoWorkspace as unknown as Atom<Value>)
      : target;

  return {
    ...store,
    get: (target) => store.get(storyAtom(target)),
    sub: (target, listener) => store.sub(storyAtom(target), listener),
    set: (target, ...args) => {
      if (Object.is(target, currentUserWorkspaceState.atom)) {
        throw new Error('The simulated Messaging viewer is read-only.');
      }
      return store.set(target, ...args);
    },
  };
};

const MessagingDemo = () => {
  const { t } = useLingui();
  const [client] = useState(createMessagingStoryClient);
  const [store] = useState(createMessagingStoryStore);

  return (
    <Provider store={store}>
      <ApolloProvider client={client}>
        <MemoryRouter
          initialEntries={[INCONNECT_MESSAGING_PATH]}
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
              description={t`Los cambios de estado sólo existen en esta sesión. El envío, los adjuntos salientes y la conexión en tiempo real están deshabilitados. Recarga para restablecer la bandeja.`}
            />
            <InconnectMessagingPage />
          </div>
        </MemoryRouter>
      </ApolloProvider>
    </Provider>
  );
};

const meta = {
  title: 'Pages/INCONNECT Messaging',
  component: MessagingDemo,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MessagingDemo>;

export default meta;

export const Demo: StoryObj<typeof meta> = {};
