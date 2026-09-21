import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { type DiscoveryService } from '@nestjs/core';

import { AddInconnectMessagingWebhookProjectionFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789040000000-add-inconnect-messaging-webhook-projection';
import { AddInconnectMessagingTemplateIntentFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789473600000-add-inconnect-messaging-template-intent';
import { AddInconnectMessagingInboundAttachmentsFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789682400000-add-inconnect-messaging-inbound-attachments';
import { AddInconnectMessagingOutboundUploadsFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1789768800000-add-inconnect-messaging-outbound-uploads';
import { AddInconnectMessagingConversationWorkStateFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1790006024000-add-inconnect-messaging-conversation-work-state';
import { CreateInconnectMessagingTransportSpineFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1788982508902-create-inconnect-messaging-transport-spine';
import { BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-slow-1789040000001-backfill-inconnect-messaging-webhook-projection';
import { InstanceCommandProviderModule } from 'src/database/commands/upgrade-version-command/instance-command-provider.module';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { UpgradeCommandRegistryService } from 'src/engine/core-modules/upgrade/services/upgrade-command-registry.service';
import { UpgradeSequenceReaderService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';

const messagingCommandTypes = [
  CreateInconnectMessagingTransportSpineFastInstanceCommand,
  AddInconnectMessagingWebhookProjectionFastInstanceCommand,
  AddInconnectMessagingTemplateIntentFastInstanceCommand,
  AddInconnectMessagingInboundAttachmentsFastInstanceCommand,
  AddInconnectMessagingOutboundUploadsFastInstanceCommand,
  AddInconnectMessagingConversationWorkStateFastInstanceCommand,
  BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand,
] as const;

@RegisteredWorkspaceCommand('2.32.0', 1790006024001)
class MessagingRegistrationTestWorkspaceCommand {
  async runOnWorkspace(): Promise<void> {}
}

describe('INCONNECT Messaging instance command registration', () => {
  it('exposes every command as a provider discoverable by the upgrade registry', () => {
    const moduleProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      InstanceCommandProviderModule,
    ) as unknown[];

    for (const commandType of messagingCommandTypes) {
      expect(INSTANCE_COMMANDS).toContain(commandType);
      expect(moduleProviders).toContain(commandType);
    }
  });

  it('discovers Fast and Slow commands through their real mechanisms and ordering', () => {
    const instances = [
      ...messagingCommandTypes.map((CommandType) => new CommandType()),
      new MessagingRegistrationTestWorkspaceCommand(),
    ];
    const discoveryService = {
      getProviders: () =>
        instances.map((instance) => ({
          instance,
          metatype: instance.constructor,
        })),
    } as DiscoveryService;
    const registry = new UpgradeCommandRegistryService(discoveryService);

    registry.onModuleInit();

    const bundle = registry.getBundleForVersion('2.32.0');

    expect(
      bundle.fastInstanceCommands.map(
        ({ command }) => command.constructor.name,
      ),
    ).toEqual([
      'CreateInconnectMessagingTransportSpineFastInstanceCommand',
      'AddInconnectMessagingWebhookProjectionFastInstanceCommand',
      'AddInconnectMessagingTemplateIntentFastInstanceCommand',
      'AddInconnectMessagingInboundAttachmentsFastInstanceCommand',
      'AddInconnectMessagingOutboundUploadsFastInstanceCommand',
      'AddInconnectMessagingConversationWorkStateFastInstanceCommand',
    ]);
    expect(
      bundle.slowInstanceCommands.map(
        ({ command }) => command.constructor.name,
      ),
    ).toEqual([
      'BackfillInconnectMessagingWebhookProjectionSlowInstanceCommand',
    ]);

    const sequence = new UpgradeSequenceReaderService(registry)
      .getUpgradeSequence()
      .filter(({ version }) => version === '2.32.0');

    expect(sequence.map(({ kind }) => kind)).toEqual([
      'fast-instance',
      'fast-instance',
      'fast-instance',
      'fast-instance',
      'fast-instance',
      'fast-instance',
      'slow-instance',
      'workspace',
    ]);
  });
});
