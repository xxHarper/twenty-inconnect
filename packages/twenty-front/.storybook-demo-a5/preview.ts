import { type Preview } from '@storybook/react-vite';

// oxlint-disable-next-line no-restricted-imports
import leadManagementPreview from '../.storybook-demo-a4/preview';

const preview: Preview = {
  ...leadManagementPreview,
  parameters: {
    ...leadManagementPreview.parameters,
    options: {
      ...leadManagementPreview.parameters?.options,
      storySort: {
        order: ['Presentación', 'UI', 'Modules', 'Pages'],
      },
    },
  },
};

export default preview;
