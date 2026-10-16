import { ForbiddenException } from '@nestjs/common';

import {
  PermissionFlagType,
  SystemPermissionFlag,
} from 'twenty-shared/constants';
import { EventLogTable } from 'twenty-shared/types';

import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type RawAuthContext } from 'src/engine/core-modules/auth/types/raw-auth-context.type';
import { EventLogsLiveResolver } from 'src/engine/core-modules/event-logs/event-logs-live.resolver';
import { EventLogLiveService } from 'src/engine/core-modules/event-logs/live/event-log-live.service';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { APPLICATION_KEEPALIVE_INTERVAL_MS } from 'src/engine/subscriptions/constants/application-keepalive-interval-ms.constant';
import { SubscriptionChannel } from 'src/engine/subscriptions/enums/subscription-channel.enum';

const buildHarness = (withApplication = true) => {
  const workspace = { id: 'workspace' };
  const userWorkspaceId = 'user-workspace';
  const application = { id: 'application', workspaceId: workspace.id };
  const request: RawAuthContext = {
    workspace: workspace as never,
    userWorkspaceId,
    application: withApplication ? (application as never) : undefined,
    tokenType: withApplication
      ? JwtTokenTypeEnum.APPLICATION_ACCESS
      : JwtTokenTypeEnum.ACCESS,
  };
  const createRole = (id: string) => ({
    id,
    universalIdentifier: id,
    canUpdateAllSettings: false,
    rolePermissionFlagIds: [`${id}-security`],
    rolePermissionFlags: [
      {
        permissionFlag: { universalIdentifier: SystemPermissionFlag.SECURITY },
      },
    ],
  });
  const userRole = createRole('user-role');
  const applicationRole = createRole('application-role');
  const roles = [userRole, applicationRole];
  const flags = roles.map((role) => ({
    id: `${role.id}-security`,
    universalIdentifier: `${role.id}-security`,
    permissionFlagUniversalIdentifier: SystemPermissionFlag.SECURITY,
  }));
  const userRoles = {
    getRolesByUserWorkspaces: jest
      .fn()
      .mockImplementation(async () => new Map([[userWorkspaceId, [userRole]]])),
  };
  const applicationRepository = {
    findOne: jest.fn().mockResolvedValue({
      ...application,
      defaultRoleId: applicationRole.id,
    }),
  };
  const cache = {
    getOrRecompute: jest.fn().mockImplementation(async () => ({
      flatRoleMaps: {
        universalIdentifierById: Object.fromEntries(
          roles.map((role) => [role.id, role.id]),
        ),
        byUniversalIdentifier: Object.fromEntries(
          roles.map((role) => [role.id, role]),
        ),
      },
      flatRolePermissionFlagMaps: {
        universalIdentifierById: Object.fromEntries(
          flags.map((flag) => [flag.id, flag.id]),
        ),
        byUniversalIdentifier: Object.fromEntries(
          flags.map((flag) => [flag.id, flag]),
        ),
      },
    })),
  };
  const permissions = new PermissionsService(
    userRoles as never,
    cache as never,
    {} as never,
    {} as never,
    applicationRepository as never,
  );
  const permissionCheck = jest.spyOn(
    permissions,
    'userHasWorkspaceSettingPermission',
  );
  const allowedRow = {
    workspaceId: workspace.id,
    objectMetadataId: 'unmanaged',
    properties: {},
  };
  const managedRow = { ...allowedRow, objectMetadataId: 'managed' };
  const foreignRow = { ...allowedRow, workspaceId: 'other-workspace' };
  const payload = {
    table: 'objectEvent',
    rows: [allowedRow, managedRow, foreignRow],
  };
  const iterator: AsyncIterableIterator<typeof payload> = {
    next: jest.fn().mockResolvedValue({ done: false, value: payload }),
    return: jest.fn().mockResolvedValue({ done: true, value: undefined }),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  const subscriptions = { subscribe: jest.fn().mockResolvedValue(iterator) };
  const history = { validateAccess: jest.fn().mockResolvedValue(undefined) };
  const recordAuthorization = {
    getGenericRecordEventPublicationDecisions: jest
      .fn()
      .mockImplementation(
        async ({ objectMetadataId }: { objectMetadataId: string }) => [
          objectMetadataId === 'unmanaged',
        ],
      ),
  };
  const presence = { set: jest.fn().mockResolvedValue(undefined) };
  const live = new EventLogLiveService(
    presence as never,
    subscriptions as never,
    recordAuthorization as never,
  );
  const filterRows = jest.spyOn(live, 'filterPublishableRows');
  const resolver = new EventLogsLiveResolver(
    history as never,
    subscriptions as never,
    live,
    permissions,
  );
  const subscribe = () =>
    resolver.eventLogsLive(
      EventLogTable.OBJECT_EVENT,
      workspace as never,
      userWorkspaceId,
      request,
    );
  const revoke = (target: 'application' | 'deleted' | 'user') => {
    if (target === 'deleted')
      applicationRepository.findOne.mockResolvedValue(null);
    else {
      const role = target === 'application' ? applicationRole : userRole;
      role.rolePermissionFlagIds = [];
      role.rolePermissionFlags = [];
    }
  };

  return {
    workspace,
    request,
    application,
    iterator,
    subscriptions,
    history,
    permissionCheck,
    applicationRepository,
    presence,
    filterRows,
    cache,
    revoke,
    subscribe,
    allowedRow,
  };
};

describe('EventLogsLiveResolver complete recipient identity', () => {
  afterEach(() => jest.clearAllTimers());

  it.each([true, false])(
    'should preserve permitted rows for an authorized recipient (application=%s)',
    async (withApplication) => {
      const harness = buildHarness(withApplication);
      const stream = await harness.subscribe();
      for (let delivery = 0; delivery < 3; delivery++) {
        expect(await stream.next()).toEqual({
          done: false,
          value: { table: 'objectEvent', rows: [harness.allowedRow] },
        });
      }
      expect(harness.subscriptions.subscribe).toHaveBeenCalledWith({
        channel: SubscriptionChannel.WORKSPACE_EVENTS_CHANNEL,
        workspaceId: 'workspace',
      });
      expect(harness.permissionCheck).toHaveBeenLastCalledWith({
        workspaceId: 'workspace',
        userWorkspaceId: 'user-workspace',
        applicationId: withApplication ? 'application' : undefined,
        setting: PermissionFlagType.SECURITY,
      });
      expect(harness.filterRows).toHaveBeenCalledWith(
        'workspace',
        'objectEvent',
        expect.any(Array),
      );
      if (withApplication)
        expect(harness.applicationRepository.findOne).toHaveBeenCalledWith({
          where: { id: 'application', workspaceId: 'workspace' },
        });
      else expect(harness.applicationRepository.findOne).not.toHaveBeenCalled();
      await stream.return?.();
    },
  );

  it.each(['application', 'deleted', 'user'] as const)(
    'should stop delivery after %s revocation following several deliveries',
    async (target) => {
      const harness = buildHarness();
      const stream = await harness.subscribe();
      for (let delivery = 0; delivery < 3; delivery++)
        expect((await stream.next()).done).toBe(false);
      harness.revoke(target);
      harness.filterRows.mockClear();
      expect((await stream.next()).done).toBe(true);
      expect(harness.filterRows).not.toHaveBeenCalled();
      expect(harness.iterator.return).toHaveBeenCalled();
    },
  );

  it('should deny a human after user SECURITY is revoked', async () => {
    const harness = buildHarness(false);
    const stream = await harness.subscribe();
    expect((await stream.next()).done).toBe(false);
    harness.revoke('user');
    expect((await stream.next()).done).toBe(true);
  });

  it.each(['application', 'deleted', 'user'] as const)(
    'should stop refreshing presence and release the iterator on heartbeat after %s revocation',
    async (target) => {
      const harness = buildHarness();
      const stream = await harness.subscribe();
      await stream.next();
      harness.revoke(target);
      harness.presence.set.mockClear();
      await jest.advanceTimersByTimeAsync(APPLICATION_KEEPALIVE_INTERVAL_MS);
      expect(harness.presence.set).not.toHaveBeenCalled();
      expect(harness.iterator.return).toHaveBeenCalled();
      expect((await stream.next()).done).toBe(true);
      await stream.return?.();
    },
  );

  it('should refresh presence while the complete principal remains authorized', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    await stream.next();
    harness.presence.set.mockClear();
    await jest.advanceTimersByTimeAsync(APPLICATION_KEEPALIVE_INTERVAL_MS);
    expect(harness.presence.set).toHaveBeenCalledTimes(1);
    expect(harness.permissionCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ applicationId: 'application' }),
    );
    await stream.return?.();
  });

  it('should retain the original IDs if request objects change after subscription', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    harness.application.id = 'other-application';
    harness.request.application = undefined;
    harness.request.userWorkspaceId = 'other-user';
    harness.workspace.id = 'other-workspace';
    harness.revoke('deleted');
    expect((await stream.next()).done).toBe(true);
    expect(harness.permissionCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        applicationId: 'application',
        userWorkspaceId: 'user-workspace',
      }),
    );
  });

  it('should ignore application IDs supplied outside the authenticated application', async () => {
    const harness = buildHarness();
    Object.assign(harness.request, {
      applicationId: 'client-application',
      body: { variables: { applicationId: 'client-application' } },
    });
    const stream = await harness.subscribe();
    harness.revoke('application');
    expect((await stream.next()).done).toBe(true);
    expect(harness.permissionCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ applicationId: 'application' }),
    );
  });

  it.each([
    'missing-application',
    'missing-application-id',
    'empty-application-id',
    'foreign-application',
    'missing-user',
    'different-user',
    'api-key',
  ] as const)(
    'should fail closed before watching or subscribing for %s identity',
    async (invalidIdentity) => {
      const harness = buildHarness();
      if (invalidIdentity === 'missing-application')
        harness.request.application = undefined;
      if (invalidIdentity === 'missing-application-id')
        harness.request.application = { workspaceId: 'workspace' } as never;
      if (invalidIdentity === 'empty-application-id')
        harness.application.id = '';
      if (invalidIdentity === 'foreign-application')
        harness.application.workspaceId = 'other-workspace';
      if (invalidIdentity === 'missing-user')
        harness.request.userWorkspaceId = undefined;
      if (invalidIdentity === 'different-user')
        harness.request.userWorkspaceId = 'other-user';
      if (invalidIdentity === 'api-key')
        harness.request.apiKey = { id: 'api-key' } as never;
      await expect(harness.subscribe()).rejects.toThrow(ForbiddenException);
      expect(harness.presence.set).not.toHaveBeenCalled();
      expect(harness.subscriptions.subscribe).not.toHaveBeenCalled();
    },
  );

  it.each(['application', 'deleted', 'user'] as const)(
    'should revalidate %s authority at subscription setup',
    async (target) => {
      const harness = buildHarness();
      harness.revoke(target);
      await expect(harness.subscribe()).rejects.toThrow(ForbiddenException);
      expect(harness.subscriptions.subscribe).not.toHaveBeenCalled();
      expect(harness.presence.set).not.toHaveBeenCalled();
    },
  );

  it('should deny when permission authority is unavailable', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    harness.cache.getOrRecompute.mockRejectedValue(new Error('unavailable'));
    expect((await stream.next()).done).toBe(true);
    expect(harness.filterRows).not.toHaveBeenCalled();
  });

  it('should revalidate application authority after asynchronous row filtering', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    harness.filterRows.mockImplementationOnce(async () => {
      harness.revoke('application');
      return [harness.allowedRow];
    });
    expect((await stream.next()).done).toBe(true);
  });

  it('should preserve the table boundary', async () => {
    const harness = buildHarness();
    (harness.iterator.next as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        done: false,
        value: { table: 'workspaceEvent', rows: [harness.allowedRow] },
      })
      .mockResolvedValue({ done: true });
    const stream = await harness.subscribe();
    expect((await stream.next()).done).toBe(true);
    expect(harness.filterRows).not.toHaveBeenCalled();
  });
});
