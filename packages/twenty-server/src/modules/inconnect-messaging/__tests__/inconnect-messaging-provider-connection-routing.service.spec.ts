import { type Repository } from 'typeorm';

import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { InconnectMessagingProviderConnectionEntity } from 'src/modules/inconnect-messaging/entities/provider-connection.entity';
import { InconnectMessagingWebhookException } from 'src/modules/inconnect-messaging/exceptions/inconnect-messaging-webhook.exception';
import { InconnectMessagingProviderConnectionRoutingService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-provider-connection-routing.service';

const buildConnection = (
  overrides: Partial<InconnectMessagingProviderConnectionEntity> = {},
): InconnectMessagingProviderConnectionEntity =>
  Object.assign(new InconnectMessagingProviderConnectionEntity(), {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    provider: 'TWILIO',
    channel: 'WHATSAPP',
    displayName: 'Twilio WhatsApp',
    externalAccountIdentifier: null,
    normalizedSenderAddress: '+14155238886',
    providerSenderOrServiceIdentifier: null,
    inboundRoutingKey: 'route-1',
    encryptedCredentials: 'enc:v2:key:ciphertext' as EncryptedString,
    credentialsVersion: 1,
    lifecycleStatus: 'ENABLED',
    healthStatus: 'UNKNOWN',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

describe('InconnectMessagingProviderConnectionRoutingService', () => {
  const find = jest.fn();
  const decryptVersionedOrThrow = jest.fn();
  const service = new InconnectMessagingProviderConnectionRoutingService(
    {
      find,
    } as unknown as Repository<InconnectMessagingProviderConnectionEntity>,
    {
      decryptVersionedOrThrow,
    } as unknown as SecretEncryptionService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    decryptVersionedOrThrow.mockReturnValue(
      JSON.stringify({ authToken: 'auth-token', accountSid: 'AC123' }),
    );
  });

  it('resolves exactly one enabled connection and decrypts with its workspace', async () => {
    const connection = buildConnection();

    find.mockResolvedValue([connection]);

    await expect(
      service.resolveEnabledConnection({
        providerKey: { provider: 'TWILIO', channel: 'WHATSAPP' },
        routingHints: { inboundRoutingKey: 'route-1' },
      }),
    ).resolves.toEqual({
      connection,
      credentials: { authToken: 'auth-token', accountSid: 'AC123' },
    });
    expect(find).toHaveBeenCalledWith({
      where: {
        provider: 'TWILIO',
        channel: 'WHATSAPP',
        inboundRoutingKey: 'route-1',
      },
      take: 2,
    });
    expect(decryptVersionedOrThrow).toHaveBeenCalledWith(
      connection.encryptedCredentials,
      { workspaceId: connection.workspaceId },
    );
  });

  it.each([
    ['CONNECTION_NOT_FOUND', []],
    [
      'CONNECTION_AMBIGUOUS',
      [buildConnection(), buildConnection({ id: 'other' })],
    ],
  ] as const)('fails closed with %s', async (category, connections) => {
    find.mockResolvedValue(connections);

    await expect(
      service.resolveEnabledConnection({
        providerKey: { provider: 'TWILIO', channel: 'WHATSAPP' },
        routingHints: { inboundRoutingKey: 'route-1' },
      }),
    ).rejects.toMatchObject<Partial<InconnectMessagingWebhookException>>({
      category,
      retryable: false,
    });
  });

  it('does not process a disabled connection', async () => {
    find.mockResolvedValue([buildConnection({ lifecycleStatus: 'DISABLED' })]);

    await expect(
      service.resolveEnabledConnection({
        providerKey: { provider: 'TWILIO', channel: 'WHATSAPP' },
        routingHints: { inboundRoutingKey: 'route-1' },
      }),
    ).rejects.toMatchObject({ category: 'CONNECTION_DISABLED' });
    expect(decryptVersionedOrThrow).not.toHaveBeenCalled();
  });

  it.each([null, 'not-json', JSON.stringify([])])(
    'fails closed for unavailable credentials: %s',
    async (credentialValue) => {
      const connection = buildConnection({
        encryptedCredentials:
          credentialValue === null
            ? null
            : buildConnection().encryptedCredentials,
      });

      find.mockResolvedValue([connection]);
      decryptVersionedOrThrow.mockReturnValue(credentialValue);

      await expect(
        service.resolveEnabledConnection({
          providerKey: { provider: 'TWILIO', channel: 'WHATSAPP' },
          routingHints: { inboundRoutingKey: 'route-1' },
        }),
      ).rejects.toMatchObject({ category: 'CREDENTIALS_UNAVAILABLE' });
    },
  );
});
