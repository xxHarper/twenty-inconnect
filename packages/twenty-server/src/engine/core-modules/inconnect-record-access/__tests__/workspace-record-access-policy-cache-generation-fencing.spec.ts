import { type DiscoveryService, type Reflector } from '@nestjs/core';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type InconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/types/inconnect-record-access-policy-maps.type';
import { invalidInconnectRecordAccessPolicyMaps } from 'src/engine/core-modules/inconnect-record-access/utils/parse-inconnect-record-access-policy-maps.util';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  WORKSPACE_CACHE_KEY,
  WORKSPACE_CACHE_OPTIONS,
} from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';
import { type WorkspaceCacheMetricsService } from 'src/engine/workspace-cache/services/workspace-cache-metrics.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_A_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_B_ID = '00000000-0000-4000-8000-000000000002';
const CACHE_KEY = 'inconnectRecordAccessPolicyMaps';

const validMaps = (revision: string): InconnectRecordAccessPolicyMaps => ({
  version: 1,
  status: 'valid',
  enforcementMode: 'UNMANAGED',
  revision,
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

class TestPolicyCacheProvider extends WorkspaceCacheProvider<InconnectRecordAccessPolicyMaps> {
  computeForCache = jest.fn<
    Promise<InconnectRecordAccessPolicyMaps>,
    [string]
  >();

  override getInvalidationValue(
    reason: string,
  ): InconnectRecordAccessPolicyMaps {
    return invalidInconnectRecordAccessPolicyMaps(
      reason,
      'recomputation-failed',
    );
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
  const provider = new TestPolicyCacheProvider();
  const discoveryService = {
    getProviders: jest.fn(() => [{ instance: provider }]),
  } as unknown as DiscoveryService;
  const reflector = {
    get: jest.fn((metadataKey: string) => {
      if (metadataKey === WORKSPACE_CACHE_KEY) {
        return CACHE_KEY;
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

  return { cacheStorage, provider, service, values };
};

describe('INCONNECT policy WorkspaceCache generation fencing', () => {
  it('discards an older recomputation that finishes after a newer generation', async () => {
    const { provider, service, values } = buildHarness();
    const recomputeA = deferred<InconnectRecordAccessPolicyMaps>();
    const recomputeB = deferred<InconnectRecordAccessPolicyMaps>();

    provider.computeForCache
      .mockReturnValueOnce(recomputeA.promise)
      .mockReturnValueOnce(recomputeB.promise);

    const generationA = await service.revokeGenerationFencedEntries(
      WORKSPACE_A_ID,
      [CACHE_KEY],
      'A',
    );
    const publicationA = service.recomputeGenerationFencedEntries(
      WORKSPACE_A_ID,
      generationA,
    );

    await waitForCallCount(provider.computeForCache, 1);

    const generationB = await service.revokeGenerationFencedEntries(
      WORKSPACE_A_ID,
      [CACHE_KEY],
      'B',
    );
    const publicationB = service.recomputeGenerationFencedEntries(
      WORKSPACE_A_ID,
      generationB,
    );

    await waitForCallCount(provider.computeForCache, 2);
    recomputeB.resolve(validMaps('2'));
    await publicationB;
    recomputeA.resolve(validMaps('1'));
    await publicationA;

    expect(values.get(`${CACHE_KEY}:${WORKSPACE_A_ID}:data`)).toEqual(
      validMaps('2'),
    );
    service.onModuleDestroy();
  });

  it('checks shared Redis authority on every retrieval and rejects a stale local snapshot', async () => {
    const { cacheStorage, provider, service, values } = buildHarness();

    provider.computeForCache.mockResolvedValue(validMaps('1'));

    await expect(
      service.getOrRecompute(WORKSPACE_A_ID, [CACHE_KEY]),
    ).resolves.toEqual({ [CACHE_KEY]: validMaps('1') });
    const callsAfterFirstRead = (cacheStorage.mget as jest.Mock).mock.calls
      .length;

    values.set(`${CACHE_KEY}:${WORKSPACE_A_ID}:data`, validMaps('2'));
    values.set(`${CACHE_KEY}:${WORKSPACE_A_ID}:hash`, 'new-shared-hash');

    await expect(
      service.getOrRecompute(WORKSPACE_A_ID, [CACHE_KEY]),
    ).resolves.toEqual({ [CACHE_KEY]: validMaps('2') });
    expect((cacheStorage.mget as jest.Mock).mock.calls.length).toBeGreaterThan(
      callsAfterFirstRead,
    );
    service.onModuleDestroy();
  });

  it('allocates independent generations per workspace', async () => {
    const { service } = buildHarness();

    await expect(
      service.revokeGenerationFencedEntries(WORKSPACE_A_ID, [CACHE_KEY], 'A'),
    ).resolves.toEqual({ [CACHE_KEY]: 1 });
    await expect(
      service.revokeGenerationFencedEntries(WORKSPACE_B_ID, [CACHE_KEY], 'B'),
    ).resolves.toEqual({ [CACHE_KEY]: 1 });
    service.onModuleDestroy();
  });
});
