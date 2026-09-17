import { createHash } from 'crypto';

import { type InconnectMessagingProviderTemplate } from 'src/modules/inconnect-messaging/providers/messaging-provider';

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z0-9]+)\s*}}/g;

export const buildInconnectMessagingTemplateDefinitionFingerprint = (
  template: InconnectMessagingProviderTemplate,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        providerReference: template.providerReference,
        displayName: template.displayName,
        language: template.language,
        content: template.content,
        variables: [...template.variables].sort((left, right) =>
          left.key.localeCompare(right.key, 'en', { numeric: true }),
        ),
      }),
    )
    .digest('hex');

export const renderInconnectMessagingTemplateBody = ({
  body,
  variables,
}: {
  body: string;
  variables: Record<string, string>;
}): string =>
  body.replace(TEMPLATE_VARIABLE_PATTERN, (_match, key: string) => {
    return variables[key] ?? '';
  });
