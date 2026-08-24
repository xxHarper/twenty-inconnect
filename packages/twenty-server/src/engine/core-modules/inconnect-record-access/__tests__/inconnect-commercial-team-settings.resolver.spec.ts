import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GqlExecutionContext } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { InconnectCommercialTeamSettingsResolver } from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team-settings.resolver';
import {
  InconnectCommercialTeamException,
  InconnectCommercialTeamExceptionCode,
} from 'src/engine/core-modules/inconnect-record-access/inconnect-commercial-team.exception';
import { type InconnectCommercialTeamSettingsService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-commercial-team-settings.service';
import { ConflictError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsException } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const TEAM_ID = '00000000-0000-4000-8000-000000000010';
const MEMBER_ID = '00000000-0000-4000-8000-000000000020';

const buildResolver = () => {
  const settingsService = {
    getTeams: jest.fn().mockResolvedValue([]),
    getAvailableMembers: jest.fn().mockResolvedValue([]),
    createTeam: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputed',
    }),
    renameTeam: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputed',
    }),
    assignCoordinator: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: '00000000-0000-4000-8000-000000000030',
      cacheStatus: 'recomputed',
    }),
    addExecutive: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: '00000000-0000-4000-8000-000000000031',
      cacheStatus: 'recomputed',
    }),
    removeExecutive: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputed',
    }),
    moveMember: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: '00000000-0000-4000-8000-000000000031',
      cacheStatus: 'recomputed',
    }),
    deleteTeam: jest.fn().mockResolvedValue({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputed',
    }),
  };
  const resolver = new InconnectCommercialTeamSettingsResolver(
    settingsService as unknown as InconnectCommercialTeamSettingsService,
  );

  return { resolver, settingsService };
};

describe('InconnectCommercialTeamSettingsResolver', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives workspace isolation from AuthWorkspace for reads and mutations', async () => {
    const { resolver, settingsService } = buildResolver();
    const workspace = { id: WORKSPACE_ID } as WorkspaceEntity;

    await resolver.getInconnectCommercialTeams(workspace);
    await resolver.getInconnectCommercialTeamAvailableMembers(workspace);
    await resolver.createInconnectCommercialTeam(
      { name: 'Equipo Norte' },
      workspace,
    );
    await resolver.renameInconnectCommercialTeam(
      { teamId: TEAM_ID, name: 'Equipo Centro' },
      workspace,
    );
    await resolver.assignInconnectCommercialTeamCoordinator(
      { teamId: TEAM_ID, workspaceMemberId: MEMBER_ID },
      workspace,
    );
    await resolver.addInconnectCommercialTeamExecutive(
      { teamId: TEAM_ID, workspaceMemberId: MEMBER_ID },
      workspace,
    );
    await resolver.removeInconnectCommercialTeamExecutive(
      { teamId: TEAM_ID, workspaceMemberId: MEMBER_ID },
      workspace,
    );
    await resolver.moveInconnectCommercialTeamMember(
      { workspaceMemberId: MEMBER_ID, targetTeamId: TEAM_ID },
      workspace,
    );
    await resolver.deleteInconnectCommercialTeam(
      { teamId: TEAM_ID },
      workspace,
    );

    expect(settingsService.getTeams).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(settingsService.getAvailableMembers).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
    expect(settingsService.renameTeam).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_ID,
      name: 'Equipo Centro',
    });
    expect(settingsService.assignCoordinator).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_ID,
      workspaceMemberId: MEMBER_ID,
    });
    expect(settingsService.moveMember).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      workspaceMemberId: MEMBER_ID,
      targetTeamId: TEAM_ID,
    });
  });

  it('returns recomputation-failed as a successful mutation result', async () => {
    const { resolver, settingsService } = buildResolver();

    settingsService.renameTeam.mockResolvedValueOnce({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputation-failed',
    });

    await expect(
      resolver.renameInconnectCommercialTeam(
        { teamId: TEAM_ID, name: 'Equipo Centro' },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).resolves.toEqual({
      teamId: TEAM_ID,
      membershipId: null,
      cacheStatus: 'recomputation-failed',
    });
  });

  it('maps expected membership conflicts to a distinguishable GraphQL conflict', async () => {
    const { resolver, settingsService } = buildResolver();

    settingsService.addExecutive.mockRejectedValueOnce(
      new InconnectCommercialTeamException(
        'internal membership details',
        InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
      ),
    );

    await expect(
      resolver.addInconnectCommercialTeamExecutive(
        { teamId: TEAM_ID, workspaceMemberId: MEMBER_ID },
        { id: WORKSPACE_ID } as WorkspaceEntity,
      ),
    ).rejects.toMatchObject({
      constructor: ConflictError,
      extensions: {
        code: 'CONFLICT',
        subCode: InconnectCommercialTeamExceptionCode.MEMBERSHIP_CONFLICT,
      },
    });
  });

  it('is guarded by workspace auth and the standard SECURITY permission', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      InconnectCommercialTeamSettingsResolver,
    ) as Array<new (permissionsService: PermissionsService) => CanActivate>;

    expect(guards[0]).toBe(WorkspaceAuthGuard);
    expect(guards).toHaveLength(2);

    const userHasWorkspaceSettingPermission = jest.fn().mockResolvedValue(true);
    const guard = new guards[1]({
      userHasWorkspaceSettingPermission,
    } as unknown as PermissionsService);
    const executionContext = {} as ExecutionContext;

    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({
        req: {
          workspace: {
            id: WORKSPACE_ID,
            activationStatus: WorkspaceActivationStatus.ACTIVE,
          },
          userWorkspaceId: '00000000-0000-4000-8000-000000000002',
          apiKey: null,
          application: null,
        },
      }),
    } as unknown as GqlExecutionContext);

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(userHasWorkspaceSettingPermission).toHaveBeenCalledWith({
      userWorkspaceId: '00000000-0000-4000-8000-000000000002',
      setting: PermissionFlagType.SECURITY,
      workspaceId: WORKSPACE_ID,
      apiKeyId: undefined,
      applicationId: undefined,
    });

    userHasWorkspaceSettingPermission.mockResolvedValueOnce(false);

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(
      PermissionsException,
    );
  });
});
