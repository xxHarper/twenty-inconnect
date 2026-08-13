import { type DiscoveryService, type Reflector } from '@nestjs/core';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type InconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-team-access-maps.type';
import { invalidInconnectTeamAccessMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-team-access-maps.util';
import {
  WORKSPACE_CACHE_KEY,
  WORKSPACE_CACHE_OPTIONS,
} from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';
import { type WorkspaceCacheMetricsService } from 'src/engine/workspace-cache/services/workspace-cache-metrics.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const WORKSPACE_A_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B_ID = '00000000-0000-4000-8000-000000000002';

const validMaps = (marker: string): InconnectTeamAccessMaps => ({
  version: 1,
  status: 'valid',
  membershipByWorkspaceMemberId: {},
  memberWorkspaceMemberIdsByTeamId: { [marker]: [] },
  assignableMemberWorkspaceMemberIdsByTeamId: { [marker]: [] },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const waitForCallCount = async (mock: jest.Mock, expected: number) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (mock.mock.calls.length === expected) {
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }
};

class TestInconnectCacheProvider extends WorkspaceCacheProvider<InconnectTeamAccessMaps> {
  computeForCache = jest.fn<Promise<InconnectTeamAccessMaps>, [string]>();

  override getInvalidationValue(reason: string): InconnectTeamAccessMaps {
    return invalidInconnectTeamAccessMaps(reason);
  }
}

const buildHarness = () => {
  const values = new Map<string, unknown>();
  const generations = new Map<string, number>();
  const cacheStorage = {
    mget: jest.fn(async (keys: string[]) => keys.map((key) => values.get(key))),
    mset: jest.fn(async (entries: Array<{ key: string; value: unknown }>) => {
      entries.forEach(({ key, value }) => values.set(key, value));
    }),
    mdel: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => values.delete(key));
    }),
    setIfAbsent: jest.fn(async () => true),
    incrementGenerationAndSet: jest.fn(
      async ({
        generationKey,
        entries,
      }: {
        generationKey: string;
        entries: Array<{ key: string; value: unknown }>;
      }) => {
        const generation = (generations.get(generationKey) ?? 0) + 1;

        generations.set(generationKey, generation);
        entries.forEach(({ key, value }) => values.set(key, value));

        return generation;
      },
    ),
    setIfGenerationMatches: jest.fn(
      async ({
        generationKey,
        expectedGeneration,
        entries,
      }: {
        generationKey: string;
        expectedGeneration: number;
        entries: Array<{ key: string; value: unknown }>;
      }) => {
        if (generations.get(generationKey) !== expectedGeneration) {
          return false;
        }

        entries.forEach(({ key, value }) => values.set(key, value));

        return true;
      },
    ),
  } as unknown as CacheStorageService;
  const provider = new TestInconnectCacheProvider();
  const discoveryService = {
    getProviders: jest.fn(() => [{ instance: provider }]),
  } as unknown as DiscoveryService;
  const reflector = {
    get: jest.fn((metadataKey: string) => {
      if (metadataKey === WORKSPACE_CACHE_KEY) {
        return 'inconnectTeamAccessMaps';
      }

      if (metadataKey === WORKSPACE_CACHE_OPTIONS) {
        return { generationFenced: true, strictSharedCache: true };
      }

      return undefined;
    }),
  } as unknown as Reflector;
  const metrics = {
    start: jest.fn(),
    stop: jest.fn(),
    recordRecompute: jest.fn(),
    recordRedisWrite: jest.fn(),
    recordEviction: jest.fn(),
    recordPackingRun: jest.fn(),
    recordUnpacking: jest.fn(),
  } as unknown as WorkspaceCacheMetricsService;
  const config = {
    get: jest.fn(() => 60),
  } as unknown as TwentyConfigService;
  const service = new WorkspaceCacheService(
    cacheStorage,
    discoveryService,
    reflector,
    metrics,
    config,
  );

  void service.onModuleInit();

  return { cacheStorage, generations, provider, service, values };
};

describe('WorkspaceCacheService generation fencing', () => {
  it('prevents an older recomputation from overwriting a later generation', async () => {
    const { provider, service, values } = buildHarness();
    const recomputeA = deferred<InconnectTeamAccessMaps>();
    const recomputeB = deferred<InconnectTeamAccessMaps>();

    provider.computeForCache
      .mockReturnValueOnce(recomputeA.promise)
      .mockReturnValueOnce(recomputeB.promise);

    const generationA = await service.revokeGenerationFencedEntries(
      WORKSPACE_A_ID,
      ['inconnectTeamAccessMaps'],
      'A',
    );
    const publicationA = service.recomputeGenerationFencedEntries(
      WORKSPACE_A_ID,
      generationA,
    );

    await waitForCallCount(provider.computeForCache, 1);

    const generationB = await service.revokeGenerationFencedEntries(
      WORKSPACE_A_ID,
      ['inconnectTeamAccessMaps'],
      'B',
    );
    const publicationB = service.recomputeGenerationFencedEntries(
      WORKSPACE_A_ID,
      generationB,
    );

    await waitForCallCount(provider.computeForCache, 2);

    const mapsB = validMaps('00000000-0000-4000-8000-000000000102');

    recomputeB.resolve(mapsB);
    await publicationB;
    recomputeA.resolve(validMaps('00000000-0000-4000-8000-000000000101'));
    await publicationA;

    expect(
      values.get(`inconnectTeamAccessMaps:${WORKSPACE_A_ID}:data`),
    ).toEqual(mapsB);
    await expect(
      service.getOrRecompute(WORKSPACE_A_ID, ['inconnectTeamAccessMaps']),
    ).resolves.toEqual({ inconnectTeamAccessMaps: mapsB });

    service.onModuleDestroy();
  });

  it('allocates generations independently for each workspace', async () => {
    const { service } = buildHarness();

    await expect(
      service.revokeGenerationFencedEntries(
        WORKSPACE_A_ID,
        ['inconnectTeamAccessMaps'],
        'test',
      ),
    ).resolves.toEqual({ inconnectTeamAccessMaps: 1 });
    await expect(
      service.revokeGenerationFencedEntries(
        WORKSPACE_B_ID,
        ['inconnectTeamAccessMaps'],
        'test',
      ),
    ).resolves.toEqual({ inconnectTeamAccessMaps: 1 });

    service.onModuleDestroy();
  });
  it('keeps the revoked value authoritative when post-revocation recomputation fails', async () => {
    const { provider, service, values } = buildHarness();

    provider.computeForCache.mockRejectedValueOnce(
      new Error('recomputation failed'),
    );

    const generations = await service.revokeGenerationFencedEntries(
      WORKSPACE_A_ID,
      ['inconnectTeamAccessMaps'],
      'awaiting recomputation',
    );

    await expect(
      service.recomputeGenerationFencedEntries(WORKSPACE_A_ID, generations),
    ).rejects.toThrow('recomputation failed');
    expect(
      values.get(`inconnectTeamAccessMaps:${WORKSPACE_A_ID}:data`),
    ).toMatchObject({
      version: 1,
      status: 'invalid',
    });

    service.onModuleDestroy();
  });
});
