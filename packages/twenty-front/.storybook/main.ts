import type { StorybookConfig } from '@storybook/react-vite';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isCommercialTeamsDemo =
  process.env.STORYBOOK_SCOPE === 'inconnect-commercial-teams';

const restrictDemoResources = (head = '') =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ws://127.0.0.1:6006; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; form-action 'none'">${head}`;

const compileCommercialTeamsMessages = async (root: string) => {
  const { createCompiledCatalog, extractor } = await import('@lingui/cli/api');
  const { getConfig } = await import('@lingui/conf');
  const linguiConfig = getConfig({ cwd: root });
  const messages: Record<string, string> = {};
  const files = globSync(
    [
      'src/modules/settings/security/commercial-teams/**/*.ts*',
      'src/pages/settings/security/SettingsSecurityCommercialTeams.tsx',
      'src/pages/settings/security/__stories__/SettingsCommercialTeams.stories.tsx',
    ],
    { cwd: root },
  );

  for (const file of files) {
    const path = resolve(root, file);
    await extractor.extract(
      path,
      readFileSync(path, 'utf8'),
      ({ id, message }) => {
        if (message) messages[id] = message;
      },
      { linguiConfig },
    );
  }

  const { source, errors } = createCompiledCatalog('en', messages, {
    namespace: 'json',
    strict: true,
  });
  if (errors.length > 0 || Object.keys(messages).length === 0) {
    throw new Error('Failed to compile Commercial Teams demo messages.');
  }

  return source;
};

const computeStoriesGlob = () => {
  if (isCommercialTeamsDemo) {
    return [
      '../src/pages/settings/security/__stories__/SettingsCommercialTeams.stories.tsx',
    ];
  }

  if (process.env.STORYBOOK_SCOPE === 'pages') {
    return [
      '../src/pages/**/*.stories.@(js|jsx|ts|tsx)',
      '../src/__stories__/*.stories.@(js|jsx|ts|tsx)',
      '../src/pages/**/*.docs.mdx',
      '../src/__stories__/*.docs.mdx',
    ];
  }

  if (process.env.STORYBOOK_SCOPE === 'modules') {
    return [
      '../src/modules/**/!(perf)/*.stories.@(js|jsx|ts|tsx)',
      '../src/modules/**/*.docs.mdx',
    ];
  }

  if (process.env.STORYBOOK_SCOPE === 'performance') {
    return ['../src/modules/**/perf/*.perf.stories.@(js|jsx|ts|tsx)'];
  }

  if (process.env.STORYBOOK_SCOPE === 'ui-docs') {
    return ['../src/modules/ui/**/*.docs.mdx'];
  }

  return ['../src/**/*.docs.mdx', '../src/**/*.stories.@(js|jsx|ts|tsx)'];
};

const config: StorybookConfig = {
  stories: computeStoriesGlob(),

  ...(isCommercialTeamsDemo && {
    core: { disableTelemetry: true, disableWhatsNewNotifications: true },
    managerHead: restrictDemoResources,
    previewHead: restrictDemoResources,
  }),

  build: {
    test: {
      disabledAddons: [
        '@storybook/addon-docs',
        '@storybook/addon-essentials/docs',
      ],
    },
  },

  addons: [
    '@storybook-community/storybook-addon-cookie',
    '@storybook/addon-links',
    '@storybook/addon-coverage',
    'storybook-addon-pseudo-states',
    // 'storybook-dark-mode',
    'storybook-addon-mock-date',
    '@storybook/addon-vitest',
  ],

  framework: '@storybook/react-vite',

  viteFinal: async (viteConfig) => {
    const { mergeConfig } = await import('vite');

    const configWithLogLevel = mergeConfig(viteConfig, {
      logLevel: 'warn',
    });

    if (isCommercialTeamsDemo) {
      // The demo must never forward a same-origin API request to Twenty.
      configWithLogLevel.server = { ...configWithLogLevel.server, proxy: {} };

      // Supply current source messages without regenerating application catalogs.
      const root = configWithLogLevel.root ?? process.cwd();
      const messages = await compileCommercialTeamsMessages(root);
      const catalogPath = resolve(root, 'src/locales/generated/en.ts');
      const virtualCatalog = '\0inconnect-commercial-teams-catalog';
      configWithLogLevel.plugins = [
        ...(configWithLogLevel.plugins ?? []),
        {
          name: 'inconnect-commercial-teams-catalog',
          enforce: 'pre',
          resolveId: (id: string) =>
            id === '../src/locales/generated/en' ? virtualCatalog : undefined,
          load: (id: string) =>
            id === virtualCatalog
              ? `import { messages as baseline } from ${JSON.stringify(catalogPath)};
                 export const messages = { ...baseline, ...(${messages}).messages };`
              : undefined,
        },
      ];
    }

    return configWithLogLevel;
  },

  logLevel: 'error',

  docs: {},
};

export default config;
