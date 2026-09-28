import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { InconnectMessagingPhoneIdentityFieldRoleDTO } from 'src/modules/inconnect-messaging/dtos/inconnect-messaging-phone-identity.dto';
import { InconnectMessagingPhoneIdentityResolver } from 'src/modules/inconnect-messaging/resolvers/inconnect-messaging-phone-identity.resolver';

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({ getWorkspaceAuthContext: jest.fn() }),
);
jest.mock(
  'src/modules/inconnect-messaging/services/inconnect-messaging-authorization.service',
  () => ({ InconnectMessagingAuthorizationService: class {} }),
);

const authContext = { workspace: { id: 'workspace-id' } } as never;

describe('InconnectMessagingPhoneIdentityResolver', () => {
  beforeEach(() => {
    jest.mocked(getWorkspaceAuthContext).mockReturnValue(authContext);
  });

  it('derives workspace and accepts only declarative field identity input', async () => {
    const configurationService = {
      getConfiguration: jest.fn().mockResolvedValue({}),
      replaceConfiguration: jest.fn().mockResolvedValue({}),
    };
    const resolver = new InconnectMessagingPhoneIdentityResolver(
      configurationService as never,
    );
    const fields = [
      {
        fieldMetadataId: 'field-a',
        role: InconnectMessagingPhoneIdentityFieldRoleDTO.PRIMARY,
      },
    ];

    await resolver.inconnectMessagingPhoneIdentityConfiguration();
    await resolver.replaceInconnectMessagingPhoneIdentityConfiguration(fields);

    expect(configurationService.getConfiguration).toHaveBeenCalledWith({
      authContext,
    });
    expect(configurationService.replaceConfiguration).toHaveBeenCalledWith({
      authContext,
      fields,
    });
    expect(
      resolver.replaceInconnectMessagingPhoneIdentityConfiguration,
    ).toHaveLength(1);
  });
});
