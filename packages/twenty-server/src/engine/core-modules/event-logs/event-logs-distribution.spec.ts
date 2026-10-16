import { EventLogTable } from 'twenty-shared/types';

import { EventLogsLiveResolver } from 'src/engine/core-modules/event-logs/event-logs-live.resolver';
import { EventLogsResolver } from 'src/engine/core-modules/event-logs/event-logs.resolver';

const buildHarness = () => {
  const row = {
    workspaceId: 'workspace',
    objectMetadataId: 'object',
    properties: { after: { label: 'private' } },
  };
  const payload = { table: 'objectEvent', rows: [row] };
  const iterator: AsyncIterableIterator<typeof payload> = {
    next: jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: payload })
      .mockResolvedValue({ done: true }),
    return: jest.fn().mockResolvedValue({ done: true }),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  const subscriptions = { subscribe: jest.fn().mockResolvedValue(iterator) };
  const history = {
    validateAccess: jest.fn().mockResolvedValue(undefined),
    queryEventLogs: jest
      .fn()
      .mockResolvedValue({ records: [row], totalCount: 1 }),
  };
  const permissions = {
    userHasWorkspaceSettingPermission: jest.fn().mockResolvedValue(true),
  };
  const live = {
    markWatched: jest.fn(),
    filterPublishableRows: jest.fn().mockResolvedValue([row]),
  };
  const authorization = {
    isGenericRecordEventHistoryAllowed: jest.fn().mockResolvedValue(false),
  };
  const resolver = new EventLogsLiveResolver(
    history as never,
    subscriptions as never,
    live as never,
    permissions as never,
  );
  const historyResolver = new EventLogsResolver(
    history as never,
    authorization as never,
  );
  const subscribe = () =>
    resolver.eventLogsLive(
      EventLogTable.OBJECT_EVENT,
      { id: 'workspace' } as never,
      'user-workspace',
      { userWorkspaceId: 'user-workspace' },
    );
  return {
    row,
    payload,
    iterator,
    subscriptions,
    history,
    permissions,
    live,
    authorization,
    resolver,
    historyResolver,
    subscribe,
  };
};

describe('Audit subscription current delivery authority', () => {
  it('delivers currently allowed rows through the existing subscription', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    expect(await stream.next()).toEqual({
      done: false,
      value: harness.payload,
    });
    expect(harness.live.filterPublishableRows).toHaveBeenCalledWith(
      'workspace',
      'objectEvent',
      [harness.row],
    );
    await stream.return?.();
  });

  it.each(['revoked', 'unavailable', 'entitlement'])(
    'does not deliver or retain a recipient after %s authority',
    async (failure) => {
      const harness = buildHarness();
      const stream = await harness.subscribe();
      if (failure === 'revoked')
        harness.permissions.userHasWorkspaceSettingPermission.mockResolvedValue(
          false,
        );
      if (failure === 'unavailable')
        harness.permissions.userHasWorkspaceSettingPermission.mockRejectedValue(
          new Error('unavailable'),
        );
      if (failure === 'entitlement')
        harness.history.validateAccess.mockRejectedValue(new Error('revoked'));
      expect((await stream.next()).done).toBe(true);
      expect(harness.live.filterPublishableRows).not.toHaveBeenCalled();
      expect(harness.iterator.return).toHaveBeenCalled();
    },
  );

  it('does not deliver a row buffered before Record Access revocation', async () => {
    const harness = buildHarness();
    const stream = await harness.subscribe();
    harness.live.filterPublishableRows.mockResolvedValue([]);
    expect((await stream.next()).done).toBe(true);
    expect(harness.live.filterPublishableRows).toHaveBeenCalledTimes(1);
  });

  it('does not treat a successful first delivery as permanent authority', async () => {
    const harness = buildHarness();
    (harness.iterator.next as jest.Mock)
      .mockReset()
      .mockResolvedValue({ done: false, value: harness.payload });
    const stream = await harness.subscribe();
    expect((await stream.next()).done).toBe(false);
    harness.permissions.userHasWorkspaceSettingPermission.mockResolvedValue(
      false,
    );
    expect((await stream.next()).done).toBe(true);
  });
});

describe('Audit history independent authority boundary', () => {
  it('blocks CRM history and count before reading protected logs', async () => {
    const harness = buildHarness();
    await expect(
      harness.historyResolver.eventLogs({ id: 'workspace' } as never, {
        table: EventLogTable.OBJECT_EVENT,
      }),
    ).rejects.toThrow('unavailable');
    expect(harness.history.queryEventLogs).not.toHaveBeenCalled();
  });

  it('rejects a result if authority changed during the historical read', async () => {
    const harness = buildHarness();
    harness.authorization.isGenericRecordEventHistoryAllowed
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      harness.historyResolver.eventLogs({ id: 'workspace' } as never, {
        table: EventLogTable.OBJECT_EVENT,
      }),
    ).rejects.toThrow('unavailable');
    expect(harness.history.queryEventLogs).toHaveBeenCalledTimes(1);
  });

  it.each([EventLogTable.OBJECT_EVENT, EventLogTable.WORKSPACE_EVENT])(
    'preserves authorized history for %s',
    async (table) => {
      const harness = buildHarness();
      harness.authorization.isGenericRecordEventHistoryAllowed.mockResolvedValue(
        true,
      );
      expect(
        await harness.historyResolver.eventLogs({ id: 'workspace' } as never, {
          table,
        }),
      ).toEqual({ records: [harness.row], totalCount: 1 });
    },
  );
});
