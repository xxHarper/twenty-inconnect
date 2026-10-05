import { getInconnectMessagingAutomationPrincipalIds } from 'src/modules/inconnect-messaging/constants/inconnect-messaging-automation-principal.constant';
import { InconnectMessagingAutomationPrincipalProvisioningService } from 'src/modules/inconnect-messaging/services/inconnect-messaging-automation-principal-provisioning.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

type ProvisioningInternals = {
  reconcileCoreIdentity: (input: { workspaceId: string }) => Promise<void>;
  reconcileWorkspaceMember: (input: { workspaceId: string }) => Promise<void>;
  reconcileRoleAndPermissions: (input: {
    workspaceId: string;
  }) => Promise<void>;
};

describe('InconnectMessagingAutomationPrincipalProvisioningService', () => {
  it('reuses deterministic identities and converges through the same sequence on retries', async () => {
    const configuration = { automationUserWorkspaceId: null as string | null };
    const configurationRepository = {
      findOne: jest.fn(async () => configuration),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => configurationRepository),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const workspaceCacheService = {
      invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
    };
    const automationPrincipalService = {
      validate: jest.fn().mockResolvedValue({
        status: 'VALID',
        principal: {},
      }),
    };
    const automationRecordAccessService = {
      reconcilePolicy: jest.fn().mockResolvedValue(undefined),
    };
    const service =
      new InconnectMessagingAutomationPrincipalProvisioningService(
        dataSource as never,
        {} as never,
        workspaceCacheService as never,
        {} as never,
        automationPrincipalService as never,
        automationRecordAccessService as never,
      );
    const internals = service as unknown as ProvisioningInternals;
    const reconcileCoreIdentity = jest
      .spyOn(internals, 'reconcileCoreIdentity')
      .mockResolvedValue(undefined);
    const reconcileWorkspaceMember = jest
      .spyOn(internals, 'reconcileWorkspaceMember')
      .mockResolvedValue(undefined);
    const reconcileRoleAndPermissions = jest
      .spyOn(internals, 'reconcileRoleAndPermissions')
      .mockResolvedValue(undefined);
    const expectedIds =
      getInconnectMessagingAutomationPrincipalIds(WORKSPACE_ID);

    const firstResult = await service.provision({ workspaceId: WORKSPACE_ID });
    const secondResult = await service.provision({ workspaceId: WORKSPACE_ID });

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toEqual({
      workspaceId: WORKSPACE_ID,
      userWorkspaceId: expectedIds.userWorkspaceId,
      workspaceMemberId: expectedIds.workspaceMemberId,
      roleId: expectedIds.roleId,
      status: 'PROVISIONED',
    });
    expect(configuration.automationUserWorkspaceId).toBe(
      expectedIds.userWorkspaceId,
    );
    expect(reconcileCoreIdentity).toHaveBeenCalledTimes(2);
    expect(reconcileWorkspaceMember).toHaveBeenCalledTimes(2);
    expect(reconcileRoleAndPermissions).toHaveBeenCalledTimes(2);
    expect(automationRecordAccessService.reconcilePolicy).toHaveBeenCalledTimes(
      2,
    );
    expect(
      automationRecordAccessService.reconcilePolicy,
    ).toHaveBeenLastCalledWith({
      roleId: expectedIds.roleId,
      workspaceId: WORKSPACE_ID,
    });
    expect(automationPrincipalService.validate).toHaveBeenCalledTimes(2);
    expect(workspaceCacheService.invalidateAndRecompute).toHaveBeenCalledTimes(
      4,
    );
  });
});
