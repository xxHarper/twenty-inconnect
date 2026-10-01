import { type ActorMetadata, FieldActorSource } from 'twenty-shared/types';

export const INCONNECT_MESSAGING_AUTO_CREATE_SYSTEM_ACTOR_NAME =
  'INCONNECT Messaging auto-create';

export const buildInconnectMessagingAutoCreateSystemActor =
  (): ActorMetadata => ({
    source: FieldActorSource.SYSTEM,
    workspaceMemberId: null,
    name: INCONNECT_MESSAGING_AUTO_CREATE_SYSTEM_ACTOR_NAME,
    context: {},
  });
