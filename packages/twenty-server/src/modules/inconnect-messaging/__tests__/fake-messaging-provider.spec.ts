import { type InconnectMessagingDispatchResult } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { FakeInconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/testing/fake-messaging-provider';

const request = {
  workspaceId: '5ed47e4a-57b7-4cb0-b76b-42be921ad92f',
  providerConnectionId: 'ceac2bf1-b6da-45d5-a2a6-2bea92ee9749',
  messageId: '669f3828-871e-4686-a8f2-02cb082c5c20',
  externalAddressNormalized: '+15550001111',
  body: 'Hello',
};

describe('FakeInconnectMessagingProvider', () => {
  it.each([
    {
      kind: 'ACCEPTED',
      providerMessageId: 'provider-message-1',
      providerStatus: 'accepted',
    },
    {
      kind: 'REJECTED_DEFINITIVE',
      error: { code: 'rejected', message: 'Rejected', retryable: false },
    },
    {
      kind: 'FAILED_BEFORE_SUBMIT',
      error: { code: 'offline', message: 'Offline', retryable: true },
    },
    {
      kind: 'UNKNOWN',
      error: { code: 'timeout', message: 'Timed out', retryable: true },
    },
  ] as InconnectMessagingDispatchResult[])(
    'returns deterministic $kind results and records calls',
    async (result) => {
      const provider = new FakeInconnectMessagingProvider(
        { provider: 'fake', channel: 'test' },
        result,
      );

      await expect(provider.dispatch(request)).resolves.toEqual(result);
      await expect(provider.dispatch(request)).resolves.toEqual(result);
      expect(provider.calls).toEqual([request, request]);
      expect(provider.calls).not.toContain(request);
    },
  );

  it('can switch deterministic scenarios without networking', async () => {
    const provider = new FakeInconnectMessagingProvider(
      { provider: 'fake', channel: 'test' },
      { kind: 'UNKNOWN' },
    );

    provider.setResult({
      kind: 'ACCEPTED',
      providerMessageId: 'provider-message-2',
    });

    await expect(provider.dispatch(request)).resolves.toEqual({
      kind: 'ACCEPTED',
      providerMessageId: 'provider-message-2',
    });
  });
});
