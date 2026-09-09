import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { FakeInconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/testing/fake-messaging-provider';

describe('InconnectMessagingProviderRegistry', () => {
  const providerKey = { provider: 'fake-provider', channel: 'fake-channel' };

  it('registers and resolves a provider by provider and channel', () => {
    const registry = new InconnectMessagingProviderRegistry();
    const provider = new FakeInconnectMessagingProvider(providerKey, {
      kind: 'ACCEPTED',
      providerMessageId: 'provider-message-1',
    });

    registry.register(provider);

    expect(registry.resolve(providerKey)).toBe(provider);
  });

  it('fails closed for an unknown combination', () => {
    const registry = new InconnectMessagingProviderRegistry();

    expect(() => registry.resolve(providerKey)).toThrow(
      'No INCONNECT Messaging provider is registered',
    );
  });

  it('rejects duplicate registration for the same combination', () => {
    const registry = new InconnectMessagingProviderRegistry();
    const firstProvider = new FakeInconnectMessagingProvider(providerKey, {
      kind: 'UNKNOWN',
    });
    const duplicateProvider = new FakeInconnectMessagingProvider(providerKey, {
      kind: 'FAILED_BEFORE_SUBMIT',
      error: { code: 'offline', message: 'Offline', retryable: true },
    });

    registry.register(firstProvider);

    expect(() => registry.register(duplicateProvider)).toThrow(
      'already registered',
    );
  });
});
