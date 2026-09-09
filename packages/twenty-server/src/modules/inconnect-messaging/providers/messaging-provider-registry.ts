import { Injectable } from '@nestjs/common';

import {
  type InconnectMessagingProvider,
  type InconnectMessagingProviderKey,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';

const buildRegistryKey = ({
  provider,
  channel,
}: InconnectMessagingProviderKey): string =>
  JSON.stringify([provider, channel]);

@Injectable()
export class InconnectMessagingProviderRegistry {
  private readonly providers = new Map<string, InconnectMessagingProvider>();

  public register(provider: InconnectMessagingProvider): void {
    const registryKey = buildRegistryKey(provider.key);

    if (this.providers.has(registryKey)) {
      throw new Error(
        `An INCONNECT Messaging provider is already registered for ${provider.key.provider}/${provider.key.channel}`,
      );
    }

    this.providers.set(registryKey, provider);
  }

  public resolve(
    key: InconnectMessagingProviderKey,
  ): InconnectMessagingProvider {
    const provider = this.providers.get(buildRegistryKey(key));

    if (provider === undefined) {
      throw new Error(
        `No INCONNECT Messaging provider is registered for ${key.provider}/${key.channel}`,
      );
    }

    return provider;
  }
}
