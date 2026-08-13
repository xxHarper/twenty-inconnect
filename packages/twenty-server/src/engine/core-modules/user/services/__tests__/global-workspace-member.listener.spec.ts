import { Logger } from '@nestjs/common';

import { GlobalWorkspaceMemberListener } from 'src/engine/core-modules/user/services/global-workspace-member.listener';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

describe('GlobalWorkspaceMemberListener', () => {
  it('invalidates member and INCONNECT team maps when member state changes', async () => {
    const workspaceCacheService = {
      invalidateAndRecompute: jest.fn(),
    } as unknown as WorkspaceCacheService;
    const listener = new GlobalWorkspaceMemberListener(workspaceCacheService);

    await listener.handleWorkspaceMemberEvent({
      workspaceId: 'workspace-id',
      name: 'workspaceMember.updated',
      events: [],
    } as never);

    expect(workspaceCacheService.invalidateAndRecompute).toHaveBeenCalledWith(
      'workspace-id',
      ['flatWorkspaceMemberMaps', 'inconnectTeamAccessMaps'],
    );
  });

  it('does not report a database rollback when refresh fails after commit', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const workspaceCacheService = {
      invalidateAndRecompute: jest
        .fn()
        .mockRejectedValue(new Error('cache unavailable')),
    } as unknown as WorkspaceCacheService;
    const listener = new GlobalWorkspaceMemberListener(workspaceCacheService);

    await expect(
      listener.handleWorkspaceMemberEvent({
        workspaceId: 'workspace-id',
        name: 'workspaceMember.updated',
        events: [],
      } as never),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('after commit'),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
