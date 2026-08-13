import { type Cache } from '@nestjs/cache-manager';

import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';

const prefixKey = (key: string) =>
  `${CacheStorageNamespace.IntegrationTests}:${CacheStorageNamespace.EngineWorkspace}:${key}`;

describe('CacheStorageService', () => {
  describe('mset', () => {
    const createRedisCacheMock = () => {
      const storeMset = jest.fn().mockResolvedValue(undefined);
      const cache = {
        store: { name: 'redis', mset: storeMset },
        set: jest.fn(),
      } as unknown as Cache;

      return { cache, storeMset };
    };

    it('commits all same-ttl entries in a single atomic store call', async () => {
      const { cache, storeMset } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await cacheStorageService.mset<unknown>([
        { key: 'flat-maps:field-metadata:workspace-id:hash', value: 'hash-1' },
        {
          key: 'flat-maps:field-metadata:workspace-id:data',
          value: { byId: {} },
        },
      ]);

      expect(storeMset).toHaveBeenCalledTimes(1);
      expect(storeMset).toHaveBeenCalledWith(
        [
          [prefixKey('flat-maps:field-metadata:workspace-id:hash'), 'hash-1'],
          [
            prefixKey('flat-maps:field-metadata:workspace-id:data'),
            { byId: {} },
          ],
        ],
        undefined,
      );
    });

    it('groups entries by ttl into one atomic store call per ttl', async () => {
      const { cache, storeMset } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await cacheStorageService.mset([
        { key: 'first', value: 1, ttl: 1000 },
        { key: 'second', value: 2 },
        { key: 'third', value: 3, ttl: 1000 },
      ]);

      expect(storeMset).toHaveBeenCalledTimes(2);
      expect(storeMset).toHaveBeenCalledWith(
        [
          [prefixKey('first'), 1],
          [prefixKey('third'), 3],
        ],
        1000,
      );
      expect(storeMset).toHaveBeenCalledWith(
        [[prefixKey('second'), 2]],
        undefined,
      );
    });

    it('does not call the store for empty entries', async () => {
      const { cache, storeMset } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await cacheStorageService.mset([]);

      expect(storeMset).not.toHaveBeenCalled();
    });

    it('falls back to sequential sets on non-redis stores', async () => {
      const cache = {
        store: { name: 'memory' },
        set: jest.fn().mockResolvedValue(undefined),
      } as unknown as Cache;
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await cacheStorageService.mset([
        { key: 'first', value: 1, ttl: 500 },
        { key: 'second', value: 2 },
      ]);

      expect(cache.set).toHaveBeenNthCalledWith(1, prefixKey('first'), 1, 500);
      expect(cache.set).toHaveBeenNthCalledWith(
        2,
        prefixKey('second'),
        2,
        undefined,
      );
    });
  });

  describe('generation fencing', () => {
    const createRedisCacheMock = (evalResult: number) => {
      const evaluate = jest.fn().mockResolvedValue(evalResult);
      const cache = {
        store: { name: 'redis', client: { eval: evaluate } },
      } as unknown as Cache;

      return { cache, evaluate };
    };

    it('atomically increments a workspace generation and publishes invalid data', async () => {
      const { cache, evaluate } = createRedisCacheMock(7);
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await expect(
        cacheStorageService.incrementGenerationAndSet<unknown>({
          generationKey: 'team-cache:workspace-a:generation',
          entries: [
            {
              key: 'team-cache:workspace-a:data',
              value: { version: 1, status: 'invalid' },
            },
            { key: 'team-cache:workspace-a:hash', value: 'hash-7' },
          ],
          ttlMs: 5000,
        }),
      ).resolves.toBe(7);
      expect(evaluate).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('INCR', KEYS[1])"),
        {
          keys: [
            prefixKey('team-cache:workspace-a:generation'),
            prefixKey('team-cache:workspace-a:data'),
            prefixKey('team-cache:workspace-a:hash'),
          ],
          arguments: [
            '5000',
            JSON.stringify({ version: 1, status: 'invalid' }),
            JSON.stringify('hash-7'),
          ],
        },
      );
    });

    it('publishes only when the expected generation still owns the workspace key', async () => {
      const { cache, evaluate } = createRedisCacheMock(0);
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await expect(
        cacheStorageService.setIfGenerationMatches({
          generationKey: 'team-cache:workspace-a:generation',
          expectedGeneration: 3,
          entries: [
            {
              key: 'team-cache:workspace-a:data',
              value: { version: 1, status: 'valid' },
            },
          ],
          ttlMs: 5000,
        }),
      ).resolves.toBe(false);
      expect(evaluate).toHaveBeenCalledWith(
        expect.stringContaining(
          "tonumber(redis.call('GET', KEYS[1])) ~= tonumber(ARGV[1])",
        ),
        expect.objectContaining({
          keys: [
            prefixKey('team-cache:workspace-a:generation'),
            prefixKey('team-cache:workspace-a:data'),
          ],
          arguments: [
            '3',
            '5000',
            JSON.stringify({ version: 1, status: 'valid' }),
          ],
        }),
      );
    });

    it('requires shared Redis authority instead of unsafe process-local fencing', async () => {
      const cache = {
        store: { name: 'memory' },
      } as unknown as Cache;
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await expect(
        cacheStorageService.incrementGenerationAndSet({
          generationKey: 'generation',
          entries: [],
          ttlMs: 5000,
        }),
      ).rejects.toThrow('requires Redis');
    });
  });

  describe('sorted sets', () => {
    const createRedisCacheMock = () => {
      const zAdd = jest.fn().mockResolvedValue(1);
      const zRem = jest.fn().mockResolvedValue(1);
      const exec = jest.fn().mockResolvedValue([2, 3]);
      const multi = {
        zRemRangeByScore: jest.fn(),
        zCard: jest.fn(),
        exec,
      };

      multi.zRemRangeByScore.mockReturnValue(multi);
      multi.zCard.mockReturnValue(multi);

      const cache = {
        store: {
          name: 'redis',
          client: {
            zAdd,
            zRem,
            multi: jest.fn().mockReturnValue(multi),
          },
        },
      } as unknown as Cache;

      return { cache, exec, multi, zAdd, zRem };
    };

    it('adds members with scores', async () => {
      const { cache, zAdd } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );
      const entries = [
        { score: 1000, value: 'stream-1' },
        { score: 2000, value: 'stream-2' },
      ];

      await cacheStorageService.sortedSetAdd('active-streams', entries);

      expect(zAdd).toHaveBeenCalledWith(prefixKey('active-streams'), entries);
    });

    it('removes members', async () => {
      const { cache, zRem } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      await cacheStorageService.sortedSetRemove('active-streams', [
        'stream-1',
        'stream-2',
      ]);

      expect(zRem).toHaveBeenCalledWith(prefixKey('active-streams'), [
        'stream-1',
        'stream-2',
      ]);
    });

    it('removes expired members and returns the remaining count atomically', async () => {
      const { cache, exec, multi } = createRedisCacheMock();
      const cacheStorageService = new CacheStorageService(
        cache,
        CacheStorageNamespace.EngineWorkspace,
      );

      const count = await cacheStorageService.sortedSetRemoveByScoreAndCount(
        'active-streams',
        0,
        1000,
      );

      expect(multi.zRemRangeByScore).toHaveBeenCalledWith(
        prefixKey('active-streams'),
        0,
        1000,
      );
      expect(multi.zCard).toHaveBeenCalledWith(prefixKey('active-streams'));
      expect(exec).toHaveBeenCalledTimes(1);
      expect(count).toBe(3);
    });
  });
});
