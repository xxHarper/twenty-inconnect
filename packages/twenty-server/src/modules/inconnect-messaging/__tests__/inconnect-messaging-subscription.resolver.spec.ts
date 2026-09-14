import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { SubscriptionService } from 'src/engine/subscriptions/subscription.service';
import { InconnectMessagingSubscriptionResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-subscription.resolver';

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({ getWorkspaceAuthContext: jest.fn() }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = {
  type: 'user',
  workspace: { id: 'workspace-id' },
  workspaceMemberId: 'member-id',
  workspaceMember: { id: 'member-id' },
} as never;

describe('InconnectMessagingSubscriptionResolver', () => {
  beforeEach(() => {
    jest.mocked(getWorkspaceAuthContext).mockReturnValue(authContext);
  });

  it('subscribes only to the authenticated member channel without client identity arguments', async () => {
    const subscriptionService = {
      subscribeToInconnectMessaging: jest.fn().mockResolvedValue('iterator'),
    };
    const authorizationService = {
      canAccessMessaging: jest.fn().mockResolvedValue(true),
    };
    const resolver = new InconnectMessagingSubscriptionResolver(
      subscriptionService as never,
      authorizationService as never,
    );

    await expect(resolver.onInconnectMessagingEvent()).resolves.toBe(
      'iterator',
    );
    expect(
      subscriptionService.subscribeToInconnectMessaging,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      workspaceMemberId: 'member-id',
    });
    expect(resolver.onInconnectMessagingEvent).toHaveLength(0);
  });

  it('denies subscription when current Messaging permission is absent', async () => {
    const subscriptionService = {
      subscribeToInconnectMessaging: jest.fn(),
    };
    const resolver = new InconnectMessagingSubscriptionResolver(
      subscriptionService as never,
      { canAccessMessaging: jest.fn().mockResolvedValue(false) } as never,
    );

    await expect(resolver.onInconnectMessagingEvent()).rejects.toThrow(
      'INCONNECT Messaging access denied',
    );
    expect(
      subscriptionService.subscribeToInconnectMessaging,
    ).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService INCONNECT Messaging channel', () => {
  it('uses the dedicated workspace/member-scoped channel for publish and subscribe', async () => {
    const pubSubClient = {
      asyncIterator: jest.fn().mockReturnValue('iterator'),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SubscriptionService({
      getPubSubClient: jest.fn().mockReturnValue(pubSubClient),
    } as never);

    await expect(
      service.subscribeToInconnectMessaging({
        workspaceId: 'workspace-id',
        workspaceMemberId: 'member-id',
      }),
    ).resolves.toBe('iterator');
    await service.publishToInconnectMessaging({
      workspaceId: 'workspace-id',
      workspaceMemberId: 'member-id',
      payload: { hint: true },
    });

    expect(pubSubClient.asyncIterator).toHaveBeenCalledWith(
      'INCONNECT_MESSAGING:workspace-id:member-id',
    );
    expect(pubSubClient.publish).toHaveBeenCalledWith(
      'INCONNECT_MESSAGING:workspace-id:member-id',
      { hint: true },
    );
  });
});
