import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import {
  InconnectMessagingAutoCreateLabelPolicyDTO,
  InconnectMessagingAutoCreateOwnerStrategyDTO,
} from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-auto-create.dto';
import { InconnectMessagingAutoCreateResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-auto-create.resolver';

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({ getWorkspaceAuthContext: jest.fn() }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = { workspace: { id: 'workspace-id' } } as never;

describe('InconnectMessagingAutoCreateResolver', () => {
  beforeEach(() => {
    jest.mocked(getWorkspaceAuthContext).mockReturnValue(authContext);
  });

  it('derives workspace and accepts only logical auto-create configuration', async () => {
    const configurationService = {
      getConfiguration: jest.fn().mockResolvedValue({}),
      replaceConfiguration: jest.fn().mockResolvedValue({}),
    };
    const resolver = new InconnectMessagingAutoCreateResolver(
      configurationService as never,
    );
    const input = {
      enabled: true,
      ownerStrategy:
        InconnectMessagingAutoCreateOwnerStrategyDTO.UNIQUE_ACTIVE_MEMBER_OF_ROLE,
      ownerRoleId: 'role-id',
      labelPolicy: InconnectMessagingAutoCreateLabelPolicyDTO.OMIT,
    };

    await resolver.inconnectMessagingAutoCreateConfiguration();
    await resolver.replaceInconnectMessagingAutoCreateConfiguration(input);

    expect(configurationService.getConfiguration).toHaveBeenCalledWith({
      authContext,
    });
    expect(configurationService.replaceConfiguration).toHaveBeenCalledWith({
      authContext,
      input,
    });
    expect(
      resolver.replaceInconnectMessagingAutoCreateConfiguration,
    ).toHaveLength(1);
  });
});
