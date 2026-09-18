import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type InconnectMessagingConversationEntity } from 'src/modules/inconnect-messaging/entities/conversation.entity';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { type InconnectMessagingProvider } from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { InconnectMessagingProviderRegistry } from 'src/modules/inconnect-messaging/providers/messaging-provider-registry';
import { InconnectMessagingAuthorizationService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service';
import { type InconnectMessagingJson } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type InconnectMessagingAuthorizedProviderContext =
  | {
      availability: 'AVAILABLE';
      conversation: InconnectMessagingConversationEntity;
      provider: InconnectMessagingProvider;
      credentials: InconnectMessagingJson;
    }
  | {
      availability: 'UNAVAILABLE';
      conversation: InconnectMessagingConversationEntity;
      provider: null;
      credentials: null;
    };

const isJsonObject = (value: unknown): value is InconnectMessagingJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class InconnectMessagingAuthorizedProviderContextService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: InconnectMessagingAuthorizationService,
    private readonly providerRegistry: InconnectMessagingProviderRegistry,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  async getAuthorizedContext({
    authContext,
    conversationId,
  }: {
    authContext: WorkspaceAuthContext;
    conversationId: string;
  }): Promise<InconnectMessagingAuthorizedProviderContext | null> {
    const conversation =
      await this.authorizationService.findAuthorizedConversationForSend({
        authContext,
        conversationId,
      });

    if (conversation === null) {
      return null;
    }

    const connection = await this.dataSource
      .getRepository(InconnectMessagingProviderConnectionEntity)
      .findOne({
        where: {
          id: conversation.providerConnectionId,
          workspaceId: conversation.workspaceId,
          lifecycleStatus: 'ENABLED',
        },
      });

    if (connection === null || connection.encryptedCredentials === null) {
      return {
        availability: 'UNAVAILABLE',
        conversation,
        provider: null,
        credentials: null,
      };
    }

    try {
      const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
        connection.encryptedCredentials,
        { workspaceId: connection.workspaceId },
      );
      const credentials: unknown = JSON.parse(plaintext);

      if (!isJsonObject(credentials)) {
        return {
          availability: 'UNAVAILABLE',
          conversation,
          provider: null,
          credentials: null,
        };
      }

      return {
        availability: 'AVAILABLE',
        conversation,
        credentials,
        provider: this.providerRegistry.resolve({
          provider: connection.provider,
          channel: connection.channel,
        }),
      };
    } catch {
      return {
        availability: 'UNAVAILABLE',
        conversation,
        provider: null,
        credentials: null,
      };
    }
  }
}
