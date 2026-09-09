import {
  type InconnectMessagingDispatchRequest,
  type InconnectMessagingDispatchResult,
  type InconnectMessagingProvider,
  type InconnectMessagingProviderKey,
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
}
