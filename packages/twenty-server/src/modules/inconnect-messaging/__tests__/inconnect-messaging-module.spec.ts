import { MODULE_METADATA } from '@nestjs/common/constants';

import { InconnectMessagingModule } from 'src/modules/inconnect-messaging/inconnect-messaging.module';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { FakeInconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/testing/fake-messaging-provider';
import { ModulesModule } from 'src/modules/modules.module';

describe('InconnectMessagingModule wiring', () => {
  it('registers the vertical module in the Twenty modules bootstrap', () => {
    const moduleImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ModulesModule,
    ) as unknown[];

    expect(moduleImports).toContain(InconnectMessagingModule);
  });

  it('provides and exports the registry without enabling the Fake Provider', () => {
    const moduleProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      InconnectMessagingModule,
    ) as unknown[];
    const moduleExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      InconnectMessagingModule,
    ) as unknown[];

    expect(moduleProviders).toContain(InconnectMessagingProviderRegistry);
    expect(moduleExports).toContain(InconnectMessagingProviderRegistry);
    expect(moduleProviders).not.toContain(FakeInconnectMessagingProvider);
  });
});
