import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingProvider,
  type InconnectMessagingProviderKey,
  type InconnectMessagingNormalizedWebhook,
  type InconnectMessagingProviderTemplate,
  type InconnectMessagingTemplateCatalogRequest,
  type InconnectMessagingWebhookNormalizationRequest,
  type InconnectMessagingWebhookRequest,
  type InconnectMessagingWebhookRoutingHints,
  type InconnectMessagingWebhookValidationRequest,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';

export class FakeInconnectMessagingProvider implements InconnectMessagingProvider {
  public readonly capabilities = [
    'DISPATCH_FREEFORM',
    'DISPATCH_TEMPLATE',
  ] as const;
  public readonly calls: InconnectMessagingDispatchRequest[] = [];
  public readonly templateCatalogCalls: InconnectMessagingTemplateCatalogRequest[] =
    [];
  private templates: InconnectMessagingProviderTemplate[] = [];

  public constructor(
    public readonly key: InconnectMessagingProviderKey,
    private result: InconnectMessagingDispatchResult,
  ) {}

  public setResult(result: InconnectMessagingDispatchResult): void {
    this.result = result;
  }

  public setTemplates(templates: InconnectMessagingProviderTemplate[]): void {
    this.templates = structuredClone(templates);
  }

  public async listTemplates(
    request: InconnectMessagingTemplateCatalogRequest,
  ): Promise<InconnectMessagingProviderTemplate[]> {
    this.templateCatalogCalls.push(structuredClone(request));

    return structuredClone(this.templates);
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
