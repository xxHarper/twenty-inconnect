import type { StorybookConfig } from '@storybook/react-vite';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// oxlint-disable-next-line no-restricted-imports
import messagingConfig from '../.storybook-demo-a3/main';

const compileLeadManagementMessages = async (root: string) => {
  const { createCompiledCatalog, extractor } = await import('@lingui/cli/api');
  const { getConfig } = await import('@lingui/conf');
  const linguiConfig = getConfig({ cwd: root });
  const messages: Record<string, string> = {};

  for (const file of globSync(
    [
      'src/modules/inconnect-lead-management/components/*.tsx',
      'src/pages/inconnect-lead-management/**/*.tsx',
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
    throw new Error('Failed to compile the Lead Management demo messages.');
  }

  const compiled = JSON.parse(source) as { messages: Record<string, unknown> };
  return JSON.stringify(compiled.messages);
};

const config: StorybookConfig = {
  ...messagingConfig,
  stories: [
    ...(Array.isArray(messagingConfig.stories) ? messagingConfig.stories : []),
    '../src/pages/inconnect-lead-management/__stories__/InconnectLeadManagement.stories.tsx',
  ],
  viteFinal: async (viteConfig, options) => {
    const { mergeConfig } = await import('vite');
    const config =
      (await messagingConfig.viteFinal?.(viteConfig, options)) ?? viteConfig;
    const root = config.root ?? process.cwd();

    return mergeConfig(config, {
      define: { DEMO_A4_MESSAGES: await compileLeadManagementMessages(root) },
      resolve: {
        alias: {
          '#demo-a4-lead-pool-planner': resolve(
            root,
            '../twenty-server/src/modules/inconnect-lead-management/manual-pool/plan-explicit-lead-pool.ts',
          ),
        },
      },
    });
  },
};

export default config;
