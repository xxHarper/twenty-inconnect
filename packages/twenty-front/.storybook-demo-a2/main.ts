import type { StorybookConfig } from '@storybook/react-vite';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// oxlint-disable-next-line no-restricted-imports
import commercialTeamsConfig from '../.storybook/main';

if (
  process.env.STORYBOOK_SCOPE !== 'inconnect-commercial-teams' ||
  typeof commercialTeamsConfig.previewHead !== 'function'
) {
  throw new Error(
    'DEMO-A2 requires the isolated Commercial Teams Storybook scope.',
  );
}

const { previewHead, viteFinal } = commercialTeamsConfig;

const compileRecordAccessMessages = async (root: string) => {
  const { createCompiledCatalog, extractor } = await import('@lingui/cli/api');
  const { getConfig } = await import('@lingui/conf');
  const linguiConfig = getConfig({ cwd: root });
  const messages: Record<string, string> = {};

  for (const file of globSync(
    [
      'src/modules/settings/security/record-access/components/**/*.tsx',
      'src/pages/settings/security/SettingsSecurityRecordAccess.tsx',
      'src/pages/settings/security/__stories__/SettingsRecordAccess.stories.tsx',
      '.storybook-demo-a2/preview.tsx',
    ],
    { cwd: root },
  )) {
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
    throw new Error('Failed to compile the Record Access demo messages.');
  }

  const compiled = JSON.parse(source) as { messages: Record<string, unknown> };
  return JSON.stringify(compiled.messages);
};

const config: StorybookConfig = {
  ...commercialTeamsConfig,
  stories: [
    '../src/pages/settings/security/__stories__/SettingsCommercialTeams.stories.tsx',
    '../src/pages/settings/security/__stories__/SettingsRecordAccess.stories.tsx',
    '../src/pages/settings/members/roles/__stories__/SettingsRoleEdit.stories.tsx',
  ],
  previewHead: (head, options) =>
    previewHead(
      (head ?? '') +
        readFileSync(
          resolve(options.configDir, '../.storybook/preview-head.html'),
          'utf8',
        ),
      options,
    ),
  viteFinal: async (viteConfig, options) => {
    const config = (await viteFinal?.(viteConfig, options)) ?? viteConfig;
    config.define = {
      ...config.define,
      DEMO_A2_MESSAGES: await compileRecordAccessMessages(
        config.root ?? process.cwd(),
      ),
    };
    return config;
  },
};

export default config;
