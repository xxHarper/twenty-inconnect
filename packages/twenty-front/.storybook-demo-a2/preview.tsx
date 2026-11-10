import { i18n, type Messages } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { type Loader, type Preview } from '@storybook/react-vite';
import { graphql, http, HttpResponse } from 'msw';
import { type MswParameters, mswLoader } from 'msw-storybook-addon';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import {
  API_PROXY_PATHS,
  buildApiProxyMatcher,
} from '~/config/apiProxyPrefixes';
import { mockedRoles } from '~/testing/mock-data/generated/metadata/roles/mock-roles-data';

// oxlint-disable-next-line no-restricted-imports
import basePreview from '../.storybook/preview';

declare const DEMO_A2_MESSAGES: Messages;

i18n.load(SOURCE_LOCALE, DEMO_A2_MESSAGES);

const apiMatchers = API_PROXY_PATHS.map(
  (apiPath) => new RegExp(buildApiProxyMatcher(apiPath)),
);

const rejectUnmockedApi = http.all(
  ({ request }) => {
    const { pathname } = new URL(request.url);
    return apiMatchers.some((matcher) => matcher.test(pathname));
  },
  () => HttpResponse.error(),
);

const standardRoleStoryId = 'pages-settings-roles-settingsroleedit--default';

// The standard story opens role 1, while its shared fixtures now use UUIDs.
const demoRoles = graphql.query('GetRoles', () => {
  const example = mockedRoles.find(({ label }) => label === 'Guest');
  if (!example) return HttpResponse.error();

  return HttpResponse.json({
    data: {
      getRoles: [
        {
          ...example,
          id: '1',
          label: 'Rol de ejemplo',
          description: 'Permisos estándar de ejemplo',
          workspaceMembers: [],
          agents: [],
          apiKeys: [],
        },
      ],
    },
  });
});

const isolatedMswLoader: Loader = (context) => {
  const { msw } = context.parameters as MswParameters;
  const handlers = Array.isArray(msw)
    ? msw
    : Object.values(msw?.handlers ?? {}).flat();

  return mswLoader({
    ...context,
    parameters: {
      ...context.parameters,
      msw: {
        handlers: [
          ...(context.id === standardRoleStoryId ? [demoRoles] : []),
          ...handlers,
          rejectUnmockedApi,
        ],
      },
    },
  });
};

const preview: Preview = {
  ...basePreview,
  loaders: [basePreview.loaders ?? []]
    .flat()
    .map((loader) => (loader === mswLoader ? isolatedMswLoader : loader)),
  decorators: [
    ...[basePreview.decorators ?? []].flat(),
    (Story, context) =>
      context.id === standardRoleStoryId ? (
        <>
          <p role="note">
            {t`Demostración con datos ficticios. Este editor muestra los permisos estándar de Twenty.`}
          </p>
          <Story />
        </>
      ) : (
        <Story />
      ),
  ],
};

export default preview;
