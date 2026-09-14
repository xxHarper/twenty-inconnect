import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { IsNull, type Repository } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { fromWorkspaceEntityToFlat } from 'src/engine/core-modules/workspace/utils/from-workspace-entity-to-flat.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

@Injectable()
export class InconnectMessagingRealtimeRecipientService {
  constructor(
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async getCandidateAuthContexts(
    workspaceId: string,
  ): Promise<UserWorkspaceAuthContext[]> {
    const [userWorkspaces, { flatWorkspaceMemberMaps }] = await Promise.all([
      this.userWorkspaceRepository.find({
        where: { workspaceId, deletedAt: IsNull() },
        relations: { user: true, workspace: true },
      }),
      this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatWorkspaceMemberMaps',
      ]),
    ]);

    return userWorkspaces.flatMap((userWorkspace) => {
      const workspaceMemberId =
        flatWorkspaceMemberMaps.idByUserId[userWorkspace.userId];
      const workspaceMember = isDefined(workspaceMemberId)
        ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
        : undefined;

      if (
        !isDefined(workspaceMemberId) ||
        !isDefined(workspaceMember) ||
        isDefined(workspaceMember.deletedAt) ||
        isDefined(userWorkspace.user.deletedAt) ||
        userWorkspace.user.disabled
      ) {
        return [];
      }

      return [
        buildUserAuthContext({
          workspace: fromWorkspaceEntityToFlat(userWorkspace.workspace),
          userWorkspaceId: userWorkspace.id,
          user: fromUserEntityToFlat(userWorkspace.user),
          workspaceMemberId,
          workspaceMember,
        }),
      ];
    });
  }
}
