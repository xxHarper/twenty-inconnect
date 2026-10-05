import { computeDeterministicUuid } from 'twenty-shared/application';
import { v5 as uuidv5 } from 'uuid';

export const INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_NAME =
  'INCONNECT Messaging Automation';
export const INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_FIRST_NAME =
  'INCONNECT Messaging';
export const INCONNECT_MESSAGING_AUTOMATION_PRINCIPAL_LAST_NAME = 'Automation';
export const INCONNECT_MESSAGING_AUTOMATION_ROLE_LABEL =
  'INCONNECT Messaging Automation';

export const getInconnectMessagingAutomationPrincipalIds = (
  workspaceId: string,
) => ({
  userId: uuidv5('inconnect-messaging-automation-user', workspaceId),
  userWorkspaceId: uuidv5(
    'inconnect-messaging-automation-user-workspace',
    workspaceId,
  ),
  workspaceMemberId: uuidv5(
    'inconnect-messaging-automation-workspace-member',
    workspaceId,
  ),
  roleId: uuidv5('inconnect-messaging-automation-role', workspaceId),
  roleTargetId: uuidv5(
    'inconnect-messaging-automation-role-target',
    workspaceId,
  ),
  objectPermissionId: uuidv5(
    'inconnect-messaging-automation-object-permission',
    workspaceId,
  ),
});

export const getInconnectMessagingAutomationFieldPermissionId = ({
  workspaceId,
  fieldMetadataId,
}: {
  workspaceId: string;
  fieldMetadataId: string;
}): string =>
  uuidv5(
    `inconnect-messaging-automation-field-permission:${fieldMetadataId}`,
    workspaceId,
  );

export const getInconnectMessagingAutomationInternalEmail = (
  workspaceId: string,
): string => `inconnect-messaging-automation+${workspaceId}@internal.invalid`;

export const getInconnectMessagingAutomationRoleTargetUniversalIdentifier = ({
  applicationUniversalIdentifier,
  userWorkspaceId,
}: {
  applicationUniversalIdentifier: string;
  userWorkspaceId: string;
}): string =>
  computeDeterministicUuid({
    applicationUniversalIdentifier,
    entityNamespace: 'roleTarget',
    value: `userWorkspace:${userWorkspaceId}`,
  });
