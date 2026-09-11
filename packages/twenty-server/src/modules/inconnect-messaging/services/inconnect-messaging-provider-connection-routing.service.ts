import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import {
  type InconnectMessagingProviderKey,
  type InconnectMessagingWebhookRoutingHints,
} from 'src/modules/inconnect-messaging/providers/messaging-provider';
import { type InconnectMessagingJson } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type ResolvedInconnectMessagingProviderConnection = {
  connection: InconnectMessagingProviderConnectionEntity;
  credentials: InconnectMessagingJson;
};

@Injectable()
export class InconnectMessagingProviderConnectionRoutingService {
  public constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository -- Public routing must resolve the workspace from an opaque connection key before workspace scope exists.
    @InjectRepository(InconnectMessagingProviderConnectionEntity)
    private readonly providerConnectionRepository: Repository<InconnectMessagingProviderConnectionEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  public async resolveEnabledConnection({
    providerKey,
    routingHints,
  }: {
    providerKey: InconnectMessagingProviderKey;
    routingHints: InconnectMessagingWebhookRoutingHints;
  }): Promise<ResolvedInconnectMessagingProviderConnection> {
    const connections = await this.providerConnectionRepository.find({
      where: {
        provider: providerKey.provider,
        channel: providerKey.channel,
        inboundRoutingKey: routingHints.inboundRoutingKey,
      },
      take: 2,
    });

    if (connections.length === 0) {
      throw new InconnectMessagingWebhookException(
        'CONNECTION_NOT_FOUND',
        false,
      );
    }

    if (connections.length !== 1) {
      throw new InconnectMessagingWebhookException(
        'CONNECTION_AMBIGUOUS',
        false,
      );
    }

    const [connection] = connections;

    if (connection.lifecycleStatus !== 'ENABLED') {
      throw new InconnectMessagingWebhookException(
        'CONNECTION_DISABLED',
        false,
      );
    }

    if (connection.encryptedCredentials === null) {
      throw new InconnectMessagingWebhookException(
        'CREDENTIALS_UNAVAILABLE',
        false,
      );
    }

    try {
      const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
        connection.encryptedCredentials,
        { workspaceId: connection.workspaceId },
      );
      const credentials: unknown = JSON.parse(plaintext);

      if (
        credentials === null ||
        typeof credentials !== 'object' ||
        Array.isArray(credentials)
      ) {
        throw new Error('Provider credentials must be a JSON object');
      }

      return {
        connection,
        credentials: credentials as InconnectMessagingJson,
      };
    } catch {
      throw new InconnectMessagingWebhookException(
        'CREDENTIALS_UNAVAILABLE',
        false,
      );
    }
  }
}
