import { isDeepStrictEqual } from 'node:util';

import { ApiPath } from 'twenty-shared/types';

import { type InconnectMessagingWebhookRequest } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InboundIngressPolicy } from 'src/modules/inconnect-messaging/webhook-ingress/ingress-contract';

export const matchesInboundUrlPolicy = (
  request: InconnectMessagingWebhookRequest,
  policy: InboundIngressPolicy,
): boolean => {
  try {
    const origin = new URL(policy.publicOrigin);
    const transport = request.ingressTransport;
    const path = `/${ApiPath.Webhooks}/inconnect-messaging/twilio/whatsapp/${encodeURIComponent(request.routingKey)}/inbound`;
    if (
      policy.mode !== 'DIRECT_TLS_V1' ||
      origin.protocol !== 'https:' ||
      origin.origin !== policy.publicOrigin ||
      !/^[a-z0-9.-]+$/.test(origin.hostname) ||
      origin.hostname.endsWith('.') ||
      !transport?.directTls ||
      transport.hasForwardedHeaders ||
      !transport.validUtf8 ||
      transport.host !== origin.host ||
      transport.requestTarget !== path ||
      request.effectiveUrl !== policy.publicOrigin + path ||
      request.kind !== 'INBOUND_MESSAGE' ||
      (request.contentType?.toLowerCase().replace(/\s/g, '') !==
        'application/x-www-form-urlencoded' &&
        request.contentType?.toLowerCase().replace(/\s/g, '') !==
          'application/x-www-form-urlencoded;charset=utf-8')
    )
      return false;

    const parameters: Record<string, string> = Object.create(null);
    for (const pair of request.rawBody.split('&')) {
      const separator = pair.indexOf('=');
      if (separator < 1) return false;
      const decode = (value: string) =>
        decodeURIComponent(value.replace(/\+/g, ' '));
      const name = decode(pair.slice(0, separator));
      const value = decode(pair.slice(separator + 1));
      // qs nesting and a second percent interpretation are outside v1.
      if (
        !name ||
        /[\[\]\u0000]/.test(name) ||
        /%[0-9a-f]{2}/i.test(name) ||
        Object.prototype.hasOwnProperty.call(parameters, name) ||
        /\u0000/.test(value)
      )
        return false;
      parameters[name] = value;
    }
    return isDeepStrictEqual({ ...parameters }, { ...request.parameters });
  } catch {
    return false;
  }
};
