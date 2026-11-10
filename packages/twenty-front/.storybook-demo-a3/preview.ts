import { i18n, type Messages } from '@lingui/core';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

// oxlint-disable-next-line no-restricted-imports
import recordAccessPreview from '../.storybook-demo-a2/preview';

declare const DEMO_A3_MESSAGES: Messages;

i18n.load(SOURCE_LOCALE, DEMO_A3_MESSAGES);

export default recordAccessPreview;
