import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingProvider,
  type InconnectMessagingProviderKey,
  type InconnectMessagingNormalizedWebhook,
  type InconnectMessagingWebhookNormalizationRequest,
  type InconnectMessagingWebhookRequest,
  type InconnectMessagingWebhookRoutingHints,
  type InconnectMessagingWebhookValidationRequest,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';

export class FakeInconnectMessagingProvider implements InconnectMessagingProvider {
  public readonly capabilities = ['DISPATCH_FREEFORM'] as const;
  public readonly calls: InconnectMessagingDispatchRequest[] = [];

  public constructor(
    public readonly key: InconnectMessagingProviderKey,
    private result: InconnectMessagingDispatchResult,
  ) {}

  public setResult(result: InconnectMessagingDispatchResult): void {
    this.result = result;
  }

  public async dispatch(
    request: InconnectMessagingDispatchRequest,
  ): Promise<InconnectMessagingDispatchResult> {
    this.calls.push(structuredClone(request));

    return structuredClone(this.result);
  }

  public getWebhookRoutingHints(
    request: InconnectMessagingWebhookRequest,
  ): InconnectMessagingWebhookRoutingHints {
    return { inboundRoutingKey: request.routingKey };
  }

  public validateWebhookSignature(
    _request: InconnectMessagingWebhookValidationRequest,
  ): boolean {
    return false;
  }

  public normalizeWebhook(
    request: InconnectMessagingWebhookNormalizationRequest,
  ): InconnectMessagingNormalizedWebhook {
    return {
      kind: 'UNSUPPORTED',
      idempotencyKey: `fake:${request.payloadHash}`,
      requestedKind: request.request.kind,
      reason: 'FAKE_PROVIDER_WEBHOOK_UNSUPPORTED',
      serverReceivedAt: request.request.serverReceivedAt.toISOString(),
    };
  }
}
