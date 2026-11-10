import type { StorybookConfig } from '@storybook/react-vite';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// oxlint-disable-next-line no-restricted-imports
import recordAccessConfig from '../.storybook-demo-a2/main';

const compileMessagingMessages = async (root: string) => {
  const { createCompiledCatalog, extractor } = await import('@lingui/cli/api');
  const { getConfig } = await import('@lingui/conf');
  const linguiConfig = getConfig({ cwd: root });
  const messages: Record<string, string> = {};

  for (const file of globSync(
    [
      'src/modules/inconnect-messaging/components/**/*.tsx',
      'src/modules/inconnect-messaging/hooks/**/*.ts',
      'src/pages/inconnect-messaging/**/*.tsx',
    ],
    { cwd: root, exclude: ['**/*.test.*', '**/__tests__/**'] },
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
    throw new Error('Failed to compile the Messaging demo messages.');
  }

  const compiled = JSON.parse(source) as { messages: Record<string, unknown> };
  return JSON.stringify(compiled.messages);
};

const config: StorybookConfig = {
  ...recordAccessConfig,
  // Messaging uses the real clock to debounce search and inbox refreshes.
  addons: recordAccessConfig.addons?.filter(
    (addon) => addon !== 'storybook-addon-mock-date',
  ),
  stories: [
    ...(Array.isArray(recordAccessConfig.stories)
      ? recordAccessConfig.stories
      : []),
    '../src/pages/inconnect-messaging/__stories__/InconnectMessaging.stories.tsx',
  ],
  viteFinal: async (viteConfig, options) => {
    const config =
      (await recordAccessConfig.viteFinal?.(viteConfig, options)) ?? viteConfig;
    config.define = {
      ...config.define,
      DEMO_A3_MESSAGES: await compileMessagingMessages(
        config.root ?? process.cwd(),
      ),
    };
    return config;
  },
};

export default config;
