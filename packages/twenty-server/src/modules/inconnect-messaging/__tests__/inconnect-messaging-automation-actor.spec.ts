import { FieldActorSource } from 'twenty-shared/types';

import { ActorFromAuthContextService } from 'src/engine/core-modules/actor/services/actor-from-auth-context.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  getInconnectMessagingAutomationPrincipalIds,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
  INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
} from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_WORKSPACE_MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const ids = getInconnectMessagingAutomationPrincipalIds(WORKSPACE_ID);

describe('INCONNECT Messaging automation Actor provenance', () => {
  it('uses ordinary WorkspaceMember provenance while the CRM Owner remains distinct', async () => {
    const actorFromAuthContextService = new ActorFromAuthContextService({
      getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
        flatObjectMetadataMaps: {
          byUniversalIdentifier: {
            anchor: {
              id: 'anchor-id',
              nameSingular: 'contact',
              fieldIds: ['created-by-id', 'updated-by-id'],
              universalIdentifier: 'anchor',
            },
          },
          universalIdentifierById: { 'anchor-id': 'anchor' },
          universalIdentifiersByApplicationId: {},
        },
        flatFieldMetadataMaps: {
          byUniversalIdentifier: {
            'created-by': {
              id: 'created-by-id',
              name: 'createdBy',
              objectMetadataId: 'anchor-id',
              universalIdentifier: 'created-by',
            },
            'updated-by': {
              id: 'updated-by-id',
              name: 'updatedBy',
              objectMetadataId: 'anchor-id',
              universalIdentifier: 'updated-by',
            },
          },
          universalIdentifierById: {
            'created-by-id': 'created-by',
            'updated-by-id': 'updated-by',
          },
          universalIdentifiersByApplicationId: {},
        },
      }),
    } as never);
    const authContext = {
      type: 'user',
      workspaceMemberId: ids.workspaceMemberId,
      userWorkspaceId: ids.userWorkspaceId,
      user: { id: ids.userId },
      workspaceMember: {
        id: ids.workspaceMemberId,
        name: {
          firstName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME,
          lastName: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME,
        },
      },
      workspace: { id: WORKSPACE_ID },
    } as unknown as WorkspaceAuthContext;

    const [record] =
      await actorFromAuthContextService.injectActorFieldsOnCreate({
        authContext,
        objectMetadataNameSingular: 'contact',
        records: [{ ownerId: OWNER_WORKSPACE_MEMBER_ID }],
      });

    expect(record).toEqual({
      ownerId: OWNER_WORKSPACE_MEMBER_ID,
      createdBy: {
        context: {},
        name: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
        source: FieldActorSource.MANUAL,
        workspaceMemberId: ids.workspaceMemberId,
      },
      updatedBy: {
        context: {},
        name: INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME,
        source: FieldActorSource.MANUAL,
        workspaceMemberId: ids.workspaceMemberId,
      },
    });
    expect(ids.workspaceMemberId).not.toBe(OWNER_WORKSPACE_MEMBER_ID);
  });
});
