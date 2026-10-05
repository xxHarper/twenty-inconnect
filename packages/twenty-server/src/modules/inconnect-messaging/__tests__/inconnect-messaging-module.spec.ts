import { MODULE_METADATA } from '@nestjs/common/constants';

import { InconnectRecordAccessModule } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { InconnectMessagingModule } from 'src/modules/inconnect-messaging/inconnect-messaging.module';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { FakeInconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/testing/fake-messaging-provider';
import { TwilioWhatsappMessagingProvider } from 'src/modules/inconnect-messaging/providers/twilio/twilio-whatsapp-messaging-provider';
import { InconnectMessagingWebhookController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-webhook.controller';
import { InconnectMessagingAttachmentController } from 'src/modules/inconnect-messaging/controllers/inconnect-messaging-attachment.controller';
import { InconnectMessagingWebhookRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-webhook-recovery.cron.command';
import { InconnectMessagingOutboxRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-outbox-recovery.cron.command';
import { InconnectMessagingDispatchRecoveryCronCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-dispatch-recovery.cron.command';
import { InconnectMessagingSendResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-send.resolver';
import { InconnectMessagingDispatchJob } from 'src/modules/inconnect-messaging/jobs/inconnect-messaging-dispatch.job';
import { InconnectMessagingReadResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-read.resolver';
import { InconnectMessagingSubscriptionResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-subscription.resolver';
import { InconnectMessagingContextResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-context.resolver';
import { InconnectMessagingLinkResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-link.resolver';
import { InconnectMessagingPhoneIdentityResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-phone-identity.resolver';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { InconnectMessagingAuthorizedProviderContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorized-provider-context.service';
import { InconnectMessagingConversationQueryService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-query.service';
import { InconnectMessagingContextConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context-configuration.service';
import { InconnectMessagingContextService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-context.service';
import { InconnectMessagingConversationLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-conversation-link.service';
import { InconnectMessagingLinkCandidateService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-link-candidate.service';
import { InconnectMessagingPhoneIdentityConfigurationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-configuration.service';
import {
  InconnectMessagingBackgroundPhoneIdentityResolverService,
  InconnectMessagingPhoneIdentityResolverService,
} from 'src/modules/inconnect-messaging/services/inconnect-messaging-phone-identity-resolver.service';
import { InconnectMessagingInboundAutoLinkService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-inbound-auto-link.service';
import { InconnectMessagingAutoCreateAuthorityService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-auto-create-authority.service';
import { InconnectMessagingAutomationPrincipalService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal.service';
import { InconnectMessagingAutomationPrincipalProvisioningService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal-provisioning.service';
import { InconnectMessagingAutomationRecordAccessService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-record-access.service';
import { InconnectMessagingProvisionAutomationPrincipalCommand } from 'src/modules/inconnect-messaging/commands/inconnect-messaging-provision-automation-principal.command';
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
    expect(moduleProviders).toContain(TwilioWhatsappMessagingProvider);
    expect(moduleExports).toContain(
      InconnectMessagingWebhookRecoveryCronCommand,
    );
    expect(moduleExports).toContain(
      InconnectMessagingOutboxRecoveryCronCommand,
    );
    expect(moduleExports).toContain(
      InconnectMessagingDispatchRecoveryCronCommand,
    );
    expect(moduleProviders).toContain(InconnectMessagingDispatchJob);
    expect(moduleProviders).toContain(InconnectMessagingSendResolver);
  });

  it('registers the public webhook and authenticated attachment controllers', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      InconnectMessagingModule,
    ) as unknown[];

    expect(controllers).toContain(InconnectMessagingWebhookController);
    expect(controllers).toContain(InconnectMessagingAttachmentController);
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
      InconnectMessagingAuthorizedProviderContextService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingConversationQueryService,
    );
    expect(moduleProviders).toContain(InconnectMessagingReadResolver);
    expect(moduleProviders).toContain(InconnectMessagingSubscriptionResolver);
    expect(moduleProviders).toContain(InconnectMessagingContextResolver);
    expect(moduleProviders).toContain(InconnectMessagingContextService);
    expect(moduleProviders).toContain(InconnectMessagingLinkResolver);
    expect(moduleProviders).toContain(InconnectMessagingLinkCandidateService);
    expect(moduleProviders).toContain(InconnectMessagingPhoneIdentityResolver);
    expect(moduleProviders).toContain(
      InconnectMessagingPhoneIdentityConfigurationService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingPhoneIdentityResolverService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingBackgroundPhoneIdentityResolverService,
    );
    expect(moduleProviders).toContain(InconnectMessagingInboundAutoLinkService);
    expect(moduleProviders).toContain(
      InconnectMessagingAutoCreateAuthorityService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingAutomationPrincipalService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingAutomationPrincipalProvisioningService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingAutomationRecordAccessService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingProvisionAutomationPrincipalCommand,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingBackgroundPhoneIdentityResolverService,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingInboundAutoLinkService,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingAutoCreateAuthorityService,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingAutomationPrincipalService,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingAutomationPrincipalProvisioningService,
    );
    expect(moduleExports).not.toContain(
      InconnectMessagingAutomationRecordAccessService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingConversationLinkService,
    );
    expect(moduleProviders).toContain(
      InconnectMessagingContextConfigurationService,
    );
    expect(moduleExports).toContain(InconnectMessagingAuthorizationService);
    expect(moduleExports).toContain(InconnectMessagingConversationQueryService);
  });
});
