import { type StorybookConfig } from '@storybook/react-vite';

// oxlint-disable-next-line no-restricted-imports
import leadManagementConfig from '../.storybook-demo-a4/main';

const config: StorybookConfig = {
  ...leadManagementConfig,
  stories: [
    './Presentation.stories.tsx',
    ...(Array.isArray(leadManagementConfig.stories)
      ? leadManagementConfig.stories
      : []),
  ],
};

export default config;
