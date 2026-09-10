import { MODULE_METADATA } from '@nestjs/common/constants';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { InconnectMessagingModule } from 'src/modules/inconnect-messaging/inconnect-messaging.module';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { FakeInconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/testing/fake-messaging-provider';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
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

  it('wires the centralized authorization boundary and its scoped query service', () => {
    const moduleImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      InconnectMessagingModule,
    ) as unknown[];
    const moduleProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      InconnectMessagingModule,
    ) as unknown[];
    const moduleExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      InconnectMessagingModule,
    ) as unknown[];

    expect(moduleImports).toContain(InconnectRecordAccessModule);
    expect(moduleImports).toContain(PermissionsModule);
    expect(moduleProviders).toContain(InconnectMessagingAuthorizationService);
    expect(moduleProviders).toContain(
      InconnectMessagingConversationQueryService,
    );
    expect(moduleExports).toContain(InconnectMessagingAuthorizationService);
    expect(moduleExports).toContain(InconnectMessagingConversationQueryService);
  });
});
