import { i18n, type Messages } from '@lingui/core';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

// oxlint-disable-next-line no-restricted-imports
import messagingPreview from '../.storybook-demo-a3/preview';

declare const DEMO_A4_MESSAGES: Messages;

i18n.load(SOURCE_LOCALE, DEMO_A4_MESSAGES);

export default messagingPreview;
