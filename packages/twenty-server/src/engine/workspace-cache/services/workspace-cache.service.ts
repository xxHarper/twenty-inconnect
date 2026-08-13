import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';

import * as Sentry from '@sentry/node';
import crypto from 'crypto';

import { isDefined, isValidUuid } from 'twenty-shared/utils';

import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { PromiseMemoizer } from 'src/engine/twenty-orm/storage/promise-memoizer.storage';
import { WorkspaceCacheMetricsService } from 'src/engine/workspace-cache/services/workspace-cache-metrics.service';
import {
  WORKSPACE_CACHE_KEY,
  WORKSPACE_CACHE_OPTIONS,
  WorkspaceCacheOptions,
} from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import {
  WorkspaceCacheException,
  WorkspaceCacheExceptionCode,
} from 'src/engine/workspace-cache/exceptions/workspace-cache.exception';
import {
  WorkspaceCacheKeyName,
  type WorkspaceCacheDataMap,
  type WorkspaceCacheResult,
  type WorkspaceCacheResultWithHashes,
  type WorkspaceCacheStoredDataMap,
} from 'src/engine/workspace-cache/types/workspace-cache-key.type';
import {
  type VersionEntry,
  type WorkspaceLocalCacheEntry,
} from 'src/engine/workspace-cache/types/workspace-local-cache-entry.type';
import { combineCacheHashes } from 'src/engine/workspace-cache/utils/combine-cache-hashes.util';
import { getKeyNameFromLocalCacheKey } from 'src/engine/workspace-cache/utils/get-key-name-from-local-cache-key.util';
import { packIdleVersions } from 'src/engine/workspace-cache/utils/pack-idle-versions.util';
import { sweepLocalCache } from 'src/engine/workspace-cache/utils/sweep-local-cache.util';

const LOCAL_TTL_MS = 100; // 100ms
const MEMOIZER_TTL_MS = 10_000; // 10 seconds
const STALE_VERSION_TTL_MS = 5_000; // 5 seconds
const MAX_LOCAL_STALE_VERSIONS = 5; // 5 stale versions
// Sized against 4 GiB pods (--max-old-space-size=3500): 7,500 sat at the heap ceiling.
const MAX_LOCAL_CACHE_ENTRIES = 6_000;
const MIN_EVICT_KEYS = 100;
const LOCAL_ENTRY_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const LOCAL_CACHE_SWEEP_INTERVAL_MS = 60 * 1000;
const PACKING_INTERVAL_MS = 500;
const MAX_ENTRY_VERSIONS_PER_PACKING_RUN = 2;
const MIN_IDLE_BEFORE_PACKING_MS = 60 * 1000;
// Per-provider entry caps, keyed by local cache key prefix (ORM graphs are ~5 MB each).
const MAX_LOCAL_ENTRIES_BY_KEY_NAME = new Map<string, number>([
  ['ORMEntityMetadatas', 128],
  ['flatFieldMetadataMaps', 256],
]);
type CacheDataType = WorkspaceCacheDataMap[WorkspaceCacheKeyName];
type StoredCacheDataType = WorkspaceCacheStoredDataMap[WorkspaceCacheKeyName];

type CacheEntriesResult = {
  data: Partial<WorkspaceCacheDataMap>;
  hashes: Partial<Record<WorkspaceCacheKeyName, string>>;
};

type RecomputeHashResolution =
  | { strategy: 'mint' }
  | {
      strategy: 'recover';
      adoptableHashes: Partial<Record<WorkspaceCacheKeyName, string>>;
    };

export type WorkspaceCacheGenerations = Partial<
  Record<WorkspaceCacheKeyName, number>
>;

@Injectable()
export class WorkspaceCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly localCache = new Map<
    string,
    WorkspaceLocalCacheEntry<CacheDataType>
  >();
  private sweepTimer?: ReturnType<typeof setInterval>;
  private packingTimer?: ReturnType<typeof setInterval>;
  private readonly workspaceCacheProviders = new Map<
    WorkspaceCacheKeyName,
    WorkspaceCacheProvider<CacheDataType, StoredCacheDataType>
  >();
  private readonly localDataOnlyKeys = new Set<WorkspaceCacheKeyName>();
  private readonly generationFencedKeys = new Set<WorkspaceCacheKeyName>();
  private readonly strictSharedCacheKeys = new Set<WorkspaceCacheKeyName>();
  private readonly memoizer = new PromiseMemoizer<CacheEntriesResult>(
    MEMOIZER_TTL_MS,
  );

  private readonly logger = new Logger(WorkspaceCacheService.name);

  constructor(
    @InjectCacheStorage(CacheStorageNamespace.EngineWorkspace)
    private readonly cacheStorage: CacheStorageService,
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly cacheMetricsService: WorkspaceCacheMetricsService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async onModuleInit() {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;

      if (!isDefined(instance) || typeof instance !== 'object') {
        continue;
      }

      const workspaceCacheKeyName = this.reflector.get<WorkspaceCacheKeyName>(
        WORKSPACE_CACHE_KEY,
        instance.constructor,
      );

      if (
        isDefined(workspaceCacheKeyName) &&
        instance instanceof WorkspaceCacheProvider
      ) {
        this.workspaceCacheProviders.set(workspaceCacheKeyName, instance);

        const options: WorkspaceCacheOptions | undefined =
          this.reflector.get<WorkspaceCacheOptions>(
            WORKSPACE_CACHE_OPTIONS,
            instance.constructor,
          );

        if (options?.localDataOnly) {
          this.localDataOnlyKeys.add(workspaceCacheKeyName);
        }

        if (options?.generationFenced) {
          this.generationFencedKeys.add(workspaceCacheKeyName);
        }

        if (options?.strictSharedCache) {
          this.strictSharedCacheKeys.add(workspaceCacheKeyName);
        }
      }
    }

    this.cacheMetricsService.start(this.localCache);
    this.startMaintenanceTimers();
  }

  onModuleDestroy(): void {
    if (isDefined(this.sweepTimer)) {
      clearInterval(this.sweepTimer);
    }
    if (isDefined(this.packingTimer)) {
      clearInterval(this.packingTimer);
    }
    this.cacheMetricsService.stop();
  }

  private startMaintenanceTimers(): void {
    this.sweepTimer = setInterval(
      () => this.sweepLocalCache(),
      LOCAL_CACHE_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref();

    this.packingTimer = setInterval(
      () => this.runPacking(),
      PACKING_INTERVAL_MS,
    );
    this.packingTimer.unref();
  }

  public async getOrRecompute<const K extends WorkspaceCacheKeyName[]>(
    workspaceId: string,
    cacheKeyNames: K,
  ): Promise<WorkspaceCacheResult<K>> {
    const { data } = await this.getOrRecomputeWithHashes(
      workspaceId,
      cacheKeyNames,
    );

    return data;
  }

  public async getOrRecomputeWithHashes<
    const K extends WorkspaceCacheKeyName[],
  >(
    workspaceId: string,
    cacheKeyNames: K,
  ): Promise<WorkspaceCacheResultWithHashes<K>> {
    this.assertValidCacheParameters(workspaceId, cacheKeyNames);

    const execute = async (): Promise<CacheEntriesResult> => {
      // Stage 1: Check local TTL
      const { freshKeys, staleKeys } = this.checkLocalTTL(
        workspaceId,
        cacheKeyNames,
      );
      const freshEntries = this.getFromLocalCache(workspaceId, freshKeys);

      if (staleKeys.length === 0) {
        return freshEntries;
      }

      // Stage 2: Validate ttl stale keys against Redis hash
      const {
        validKeys,
        keysNeedingDataFromRedis,
        keysNeedingRecompute,
        adoptableHashes,
      } = await this.validateLocalHashAgainstRedisHash(workspaceId, staleKeys);
      const validatedEntries = this.getFromLocalCache(workspaceId, validKeys);

      // Stage 3: Fetch data from Redis
      const { redisEntries, missingInRedis } = await this.fetchDataFromRedis(
        workspaceId,
        keysNeedingDataFromRedis,
      );

      // Stage 4: Recompute remaining
      const keysToRecompute = [...keysNeedingRecompute, ...missingInRedis];
      const recomputedEntries = await this.recomputeDataFromProvider(
        workspaceId,
        keysToRecompute,
        { strategy: 'recover', adoptableHashes },
      );

      return {
        data: {
          ...freshEntries.data,
          ...validatedEntries.data,
          ...redisEntries.data,
          ...recomputedEntries.data,
        },
        hashes: {
          ...freshEntries.hashes,
          ...validatedEntries.hashes,
          ...redisEntries.hashes,
          ...recomputedEntries.hashes,
        },
      };
    };
    const usesStrictSharedCache = cacheKeyNames.some((keyName) =>
      this.strictSharedCacheKeys.has(keyName),
    );
    const memoKey =
      `${workspaceId}-${[...cacheKeyNames].sort().join(',')}` as const;
    const result = usesStrictSharedCache
      ? await execute()
      : await this.memoizer.memoizePromiseAndExecute(memoKey, execute);

    return result as WorkspaceCacheResultWithHashes<K>;
  }

  public async getOrRecomputeCombinedHash(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<string> {
    this.assertValidCacheParameters(workspaceId, cacheKeyNames);

    const cachedHashes = await this.getCacheHashes(workspaceId, cacheKeyNames);
    const missingKeys = cacheKeyNames.filter(
      (cacheKeyName) => !isDefined(cachedHashes[cacheKeyName]),
    );

    if (missingKeys.length === 0) {
      return combineCacheHashes(cachedHashes, cacheKeyNames);
    }

    const { hashes: recomputedHashes } = await this.getOrRecomputeWithHashes(
      workspaceId,
      missingKeys,
    );

    return combineCacheHashes(
      { ...cachedHashes, ...recomputedHashes },
      cacheKeyNames,
    );
  }

  public async invalidateAndRecompute(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<void> {
    return Sentry.startSpan(
      {
        name: 'invalidate and recompute workspace metadata cache',
        op: 'cache.invalidate',
        onlyIfParent: true,
        attributes: { 'cache.key_count': cacheKeyNames.length },
      },
      async () => {
        await this.memoizer.clearKeys(`${workspaceId}-`);

        const fencedKeyNames = cacheKeyNames.filter((keyName) =>
          this.generationFencedKeys.has(keyName),
        );
        const regularKeyNames = cacheKeyNames.filter(
          (keyName) => !this.generationFencedKeys.has(keyName),
        );
        const generations = await this.revokeGenerationFencedEntries(
          workspaceId,
          fencedKeyNames,
          'Cache invalidated before recomputation',
        );

        await this.flush(workspaceId, regularKeyNames);
        await this.recomputeDataFromProvider(workspaceId, regularKeyNames, {
          strategy: 'mint',
        });
        await this.recomputeGenerationFencedEntries(workspaceId, generations);

        // Clear memoizer again after recomputation to evict any stale entries
        // cached by concurrent getOrRecompute calls during the flush window.
        await this.memoizer.clearKeys(`${workspaceId}-`);
      },
    );
  }

  public async revokeGenerationFencedEntries(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
    reason: string,
  ): Promise<WorkspaceCacheGenerations> {
    if (cacheKeyNames.length === 0) {
      return {};
    }

    this.assertValidCacheParameters(workspaceId, cacheKeyNames);

    const ttlMs = this.twentyConfigService.get('CACHE_STORAGE_TTL') * 1000;
    const generations: WorkspaceCacheGenerations = {};

    for (const keyName of cacheKeyNames) {
      if (!this.generationFencedKeys.has(keyName)) {
        throw new Error(
          `Cache key "${keyName}" does not support generation fencing`,
        );
      }

      const provider = this.getProviderOrThrow(keyName);
      const invalidationValue = provider.getInvalidationValue(reason);

      if (!isDefined(invalidationValue)) {
        throw new Error(
          `Cache provider "${keyName}" has no fail-closed invalidation value`,
        );
      }

      const baseKey = this.buildCacheKey(workspaceId, keyName);
      const hash = crypto.randomUUID();
      const generation = await this.cacheStorage.incrementGenerationAndSet<
        StoredCacheDataType | string
      >({
        generationKey: `${baseKey}:generation`,
        entries: [
          {
            key: `${baseKey}:data`,
            value: provider.encodeForCacheStorage(invalidationValue),
          },
          { key: `${baseKey}:hash`, value: hash },
        ],
        ttlMs,
      });

      generations[keyName] = generation;
      this.setInLocalCache(workspaceId, keyName, invalidationValue, hash);
    }

    await this.memoizer.clearKeys(`${workspaceId}-`);

    return generations;
  }

  public async recomputeGenerationFencedEntries(
    workspaceId: string,
    generations: WorkspaceCacheGenerations,
  ): Promise<void> {
    const cacheKeyNames = Object.keys(generations) as WorkspaceCacheKeyName[];

    if (cacheKeyNames.length === 0) {
      return;
    }

    await this.recomputeDataFromProvider(
      workspaceId,
      cacheKeyNames,
      { strategy: 'mint' },
      generations,
    );
    await this.memoizer.clearKeys(`${workspaceId}-`);
  }

  public async getCacheHashes(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<Partial<Record<WorkspaceCacheKeyName, string>>> {
    if (cacheKeyNames.length === 0) {
      return {};
    }

    const hashKeys = cacheKeyNames.map(
      (keyName) => `${this.buildCacheKey(workspaceId, keyName)}:hash`,
    );

    const hashes = await this.cacheStorage.mget<string>(hashKeys);

    const result: Partial<Record<WorkspaceCacheKeyName, string>> = {};

    for (const [index, keyName] of cacheKeyNames.entries()) {
      if (isDefined(hashes[index])) {
        result[keyName] = hashes[index];
      }
    }

    return result;
  }

  public async flush(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<void> {
    await this.deleteFromRedis(workspaceId, cacheKeyNames);

    this.deleteFromLocalCache(workspaceId, cacheKeyNames);
  }

  private assertValidCacheParameters(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): void {
    if (
      !isDefined(workspaceId) ||
      cacheKeyNames.length === 0 ||
      !isValidUuid(workspaceId)
    ) {
      throw new WorkspaceCacheException(
        'Invalid parameters: workspace ID and cache key names are required',
        WorkspaceCacheExceptionCode.INVALID_PARAMETERS,
      );
    }
  }

  private checkLocalTTL<K extends WorkspaceCacheKeyName>(
    workspaceId: string,
    cacheKeyNames: readonly K[],
  ): { freshKeys: K[]; staleKeys: K[] } {
    const freshKeys: K[] = [];
    const staleKeys: K[] = [];
    const now = Date.now();

    for (const keyName of cacheKeyNames) {
      if (this.strictSharedCacheKeys.has(keyName)) {
        staleKeys.push(keyName);

        continue;
      }

      const localKey = this.buildCacheKey(workspaceId, keyName);
      const cached = this.localCache.get(localKey);

      if (isDefined(cached) && now - cached.lastHashCheckedAt < LOCAL_TTL_MS) {
        freshKeys.push(keyName);
      } else {
        staleKeys.push(keyName);
      }
    }

    return { freshKeys, staleKeys };
  }

  private async validateLocalHashAgainstRedisHash(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<{
    validKeys: WorkspaceCacheKeyName[];
    keysNeedingDataFromRedis: WorkspaceCacheKeyName[];
    keysNeedingRecompute: WorkspaceCacheKeyName[];
    adoptableHashes: Partial<Record<WorkspaceCacheKeyName, string>>;
  }> {
    const validKeys: WorkspaceCacheKeyName[] = [];
    const keysNeedingDataFromRedis: WorkspaceCacheKeyName[] = [];
    const keysNeedingRecompute: WorkspaceCacheKeyName[] = [];
    const adoptableHashes: Partial<Record<WorkspaceCacheKeyName, string>> = {};

    if (cacheKeyNames.length === 0) {
      return {
        validKeys,
        keysNeedingDataFromRedis,
        keysNeedingRecompute,
        adoptableHashes,
      };
    }

    const hashKeys = cacheKeyNames.map(
      (keyName) => `${this.buildCacheKey(workspaceId, keyName)}:hash`,
    );

    const redisHashes = await this.cacheStorage.mget<string>(hashKeys);

    for (const [index, keyName] of cacheKeyNames.entries()) {
      const redisHash = redisHashes[index];
      const localKey = this.buildCacheKey(workspaceId, keyName);
      const localEntry = this.localCache.get(localKey);

      if (
        isDefined(localEntry) &&
        isDefined(redisHash) &&
        localEntry.latestHash === redisHash
      ) {
        localEntry.lastHashCheckedAt = Date.now();
        validKeys.push(keyName);
      } else if (this.localDataOnlyKeys.has(keyName)) {
        keysNeedingRecompute.push(keyName);

        if (isDefined(redisHash)) {
          adoptableHashes[keyName] = redisHash;
        }
      } else {
        keysNeedingDataFromRedis.push(keyName);
      }
    }

    return {
      validKeys,
      keysNeedingDataFromRedis,
      keysNeedingRecompute,
      adoptableHashes,
    };
  }

  private async fetchDataFromRedis(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<{
    redisEntries: CacheEntriesResult;
    missingInRedis: WorkspaceCacheKeyName[];
  }> {
    const redisEntries: CacheEntriesResult = { data: {}, hashes: {} };
    const missingInRedis: WorkspaceCacheKeyName[] = [];

    if (cacheKeyNames.length === 0) {
      return { redisEntries, missingInRedis };
    }

    // Interleave data and hash keys for atomic fetch: [data1, hash1, data2, hash2, ...]
    const allKeys = cacheKeyNames.flatMap((keyName) => {
      const baseKey = this.buildCacheKey(workspaceId, keyName);

      return [`${baseKey}:data`, `${baseKey}:hash`];
    });

    const allValues = await this.cacheStorage.mget<CacheDataType | string>(
      allKeys,
    );

    for (const [index, keyName] of cacheKeyNames.entries()) {
      const rawData = allValues[index * 2] as CacheDataType | undefined;
      const hash = allValues[index * 2 + 1] as string | undefined;

      if (isDefined(rawData) && isDefined(hash)) {
        let data: CacheDataType;

        try {
          data =
            this.getProviderOrThrow(keyName).decodeFromCacheStorage(rawData);
        } catch (error) {
          this.logger.warn(
            `Failed to decode cached ${keyName} for workspace ${workspaceId}, recomputing`,
            error,
          );
          missingInRedis.push(keyName);
          continue;
        }

        Object.assign(redisEntries.data, { [keyName]: data });
        redisEntries.hashes[keyName] = hash;
        this.setInLocalCache(workspaceId, keyName, data, hash);
      } else {
        missingInRedis.push(keyName);
      }
    }

    return { redisEntries, missingInRedis };
  }

  private async recomputeDataFromProvider(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
    hashResolution: RecomputeHashResolution,
    expectedGenerations: WorkspaceCacheGenerations = {},
  ): Promise<CacheEntriesResult> {
    const result: CacheEntriesResult = { data: {}, hashes: {} };

    if (cacheKeyNames.length === 0) {
      return result;
    }

    const fencedKeyNames = cacheKeyNames.filter((keyName) =>
      this.generationFencedKeys.has(keyName),
    );
    const regularKeyNames = cacheKeyNames.filter(
      (keyName) => !this.generationFencedKeys.has(keyName),
    );

    for (const keyName of fencedKeyNames) {
      const expectedGeneration =
        expectedGenerations[keyName] ??
        (
          await this.revokeGenerationFencedEntries(
            workspaceId,
            [keyName],
            'Cache entry was absent and requires secure recomputation',
          )
        )[keyName];

      if (!isDefined(expectedGeneration)) {
        throw new Error(
          `No generation was allocated for fenced cache "${keyName}"`,
        );
      }

      const fencedEntry = await this.recomputeGenerationFencedEntry(
        workspaceId,
        keyName,
        expectedGeneration,
      );

      Object.assign(result.data, fencedEntry.data);
      Object.assign(result.hashes, fencedEntry.hashes);
    }

    const computePromises = regularKeyNames.map(async (keyName) => {
      const provider = this.getProviderOrThrow(keyName);
      const isLocalDataOnly = this.localDataOnlyKeys.has(keyName);
      const computeStartedAt = performance.now();

      try {
        const data = await Sentry.startSpan(
          {
            name: 'compute workspace metadata cache entry from provider',
            op: 'cache.recompute',
            onlyIfParent: true,
            attributes: {
              'cache.key_name': keyName,
              'cache.recompute.strategy': hashResolution.strategy,
              'cache.local_data_only': isLocalDataOnly,
            },
          },
          () => provider.computeForCache(workspaceId),
        );

        if (hashResolution.strategy === 'mint') {
          return { keyName, data, hash: crypto.randomUUID(), isAdopted: false };
        }

        const adoptableHash = hashResolution.adoptableHashes[keyName];

        return {
          keyName,
          data,
          hash: adoptableHash ?? crypto.randomUUID(),
          isAdopted: isDefined(adoptableHash),
        };
      } finally {
        this.cacheMetricsService.recordRecompute(
          (performance.now() - computeStartedAt) / 1000,
          keyName,
        );
      }
    });

    const computed = await Promise.all(computePromises);

    const redisEntries: Array<{
      key: string;
      value: StoredCacheDataType | string;
    }> = [];
    const bootstrapHashEntries: Array<{ key: string; value: string }> = [];

    for (const { keyName, data, hash, isAdopted } of computed) {
      Object.assign(result.data, { [keyName]: data });
      result.hashes[keyName] = hash;

      const baseKey = this.buildCacheKey(workspaceId, keyName);
      const isLocalDataOnly = this.localDataOnlyKeys.has(keyName);
      const isRecoveryBootstrap =
        hashResolution.strategy === 'recover' && !isAdopted && isLocalDataOnly;

      if (isRecoveryBootstrap) {
        bootstrapHashEntries.push({ key: `${baseKey}:hash`, value: hash });
      } else if (!isAdopted) {
        redisEntries.push({ key: `${baseKey}:hash`, value: hash });
      }

      if (!isLocalDataOnly) {
        redisEntries.push({
          key: `${baseKey}:data`,
          value: this.getProviderOrThrow(keyName).encodeForCacheStorage(data),
        });
      }

      this.setInLocalCache(workspaceId, keyName, data, hash);
    }

    if (redisEntries.length > 0) {
      const redisWriteStartedAt = performance.now();

      try {
        await this.cacheStorage.mset(redisEntries);
      } finally {
        this.cacheMetricsService.recordRedisWrite(
          (performance.now() - redisWriteStartedAt) / 1000,
        );
      }
    }

    if (bootstrapHashEntries.length > 0) {
      const bootstrapHashTtlMs =
        this.twentyConfigService.get('CACHE_STORAGE_TTL') * 1000;

      await Promise.all(
        bootstrapHashEntries.map(({ key, value }) =>
          this.cacheStorage.setIfAbsent(key, value, bootstrapHashTtlMs),
        ),
      );
    }

    return result;
  }

  private async recomputeGenerationFencedEntry(
    workspaceId: string,
    keyName: WorkspaceCacheKeyName,
    expectedGeneration: number,
  ): Promise<CacheEntriesResult> {
    const provider = this.getProviderOrThrow(keyName);
    const computeStartedAt = performance.now();
    let data: CacheDataType;

    try {
      data = await provider.computeForCache(workspaceId);
    } finally {
      this.cacheMetricsService.recordRecompute(
        (performance.now() - computeStartedAt) / 1000,
        keyName,
      );
    }

    const baseKey = this.buildCacheKey(workspaceId, keyName);
    const hash = crypto.randomUUID();
    const ttlMs = this.twentyConfigService.get('CACHE_STORAGE_TTL') * 1000;
    const published = await this.cacheStorage.setIfGenerationMatches<
      StoredCacheDataType | string
    >({
      generationKey: `${baseKey}:generation`,
      expectedGeneration,
      entries: [
        {
          key: `${baseKey}:data`,
          value: provider.encodeForCacheStorage(data),
        },
        { key: `${baseKey}:hash`, value: hash },
      ],
      ttlMs,
    });

    if (published) {
      this.setInLocalCache(workspaceId, keyName, data, hash);

      return {
        data: { [keyName]: data } as Partial<WorkspaceCacheDataMap>,
        hashes: { [keyName]: hash },
      };
    }

    const { redisEntries, missingInRedis } = await this.fetchDataFromRedis(
      workspaceId,
      [keyName],
    );

    if (missingInRedis.length > 0) {
      throw new Error(
        `Fenced cache "${keyName}" lost publication and has no authoritative value`,
      );
    }

    return redisEntries;
  }

  private getFromLocalCache(
    workspaceId: string,
    workspaceCacheKeyNames: WorkspaceCacheKeyName[],
  ): CacheEntriesResult {
    const result: CacheEntriesResult = { data: {}, hashes: {} };

    for (const keyName of workspaceCacheKeyNames) {
      const localKey = this.buildCacheKey(workspaceId, keyName);
      const entry = this.localCache.get(localKey);
      const version = entry?.versions.get(entry.latestHash);

      if (isDefined(entry) && isDefined(version)) {
        const data = this.readVersion({
          keyName,
          entry,
          hash: entry.latestHash,
          version,
        });

        Object.assign(result.data, { [keyName]: data });
        result.hashes[keyName] = entry.latestHash;
        this.cleanupStaleVersions(entry);
      }
    }

    return result;
  }

  private deleteFromLocalCache(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): void {
    for (const keyName of cacheKeyNames) {
      const localKey = this.buildCacheKey(workspaceId, keyName);
      const entry = this.localCache.get(localKey);

      if (isDefined(entry)) {
        entry.lastHashCheckedAt = 0;
      }
    }
  }

  private async deleteFromRedis(
    workspaceId: string,
    cacheKeyNames: WorkspaceCacheKeyName[],
  ): Promise<void> {
    const keysToDelete = cacheKeyNames.flatMap((keyName) => {
      const baseKey = this.buildCacheKey(workspaceId, keyName);
      const keys = [`${baseKey}:data`, `${baseKey}:hash`];

      if (this.generationFencedKeys.has(keyName)) {
        keys.push(`${baseKey}:generation`);
      }

      return keys;
    });

    await this.cacheStorage.mdel(keysToDelete);
  }

  private setInLocalCache(
    workspaceId: string,
    keyName: WorkspaceCacheKeyName,
    data: CacheDataType,
    hash: string,
  ): void {
    const localKey = this.buildCacheKey(workspaceId, keyName);
    let entry = this.localCache.get(localKey);

    if (!isDefined(entry)) {
      entry = { versions: new Map(), latestHash: '', lastHashCheckedAt: 0 };
      this.localCache.set(localKey, entry);
    }

    entry.versions.set(hash, { state: 'live', data, lastReadAt: Date.now() });
    entry.latestHash = hash;
    entry.lastHashCheckedAt = Date.now();

    this.cleanupStaleVersions(entry);
  }

  private sweepLocalCache(): void {
    const now = Date.now();

    const evicted = sweepLocalCache(this.localCache, now, {
      ttlMs: LOCAL_ENTRY_TTL_MS,
      maxEntriesByKeyName: MAX_LOCAL_ENTRIES_BY_KEY_NAME,
      globalMaxEntries: MAX_LOCAL_CACHE_ENTRIES,
      minEvict: MIN_EVICT_KEYS,
    });

    if (evicted > 0) {
      this.cacheMetricsService.recordEviction(evicted);
    }
  }

  private runPacking(): void {
    const startedAt = performance.now();

    const { packed, pending } = packIdleVersions({
      localCache: this.localCache,
      minIdleMs: MIN_IDLE_BEFORE_PACKING_MS,
      maxEntryVersionsPerRun: MAX_ENTRY_VERSIONS_PER_PACKING_RUN,
      isPackable: (localKey) =>
        !this.localDataOnlyKeys.has(
          getKeyNameFromLocalCacheKey(localKey) as WorkspaceCacheKeyName,
        ),
      pack: ({ localKey, data }) => {
        const keyName = getKeyNameFromLocalCacheKey(
          localKey,
        ) as WorkspaceCacheKeyName;

        return Buffer.from(
          JSON.stringify(
            this.getProviderOrThrow(keyName).encodeForCacheStorage(data),
          ),
          'utf8',
        );
      },
    });

    this.cacheMetricsService.recordPackingRun({
      durationSeconds: (performance.now() - startedAt) / 1000,
      packed,
      pending,
    });
  }

  private readVersion({
    keyName,
    entry,
    hash,
    version,
  }: {
    keyName: WorkspaceCacheKeyName;
    entry: WorkspaceLocalCacheEntry<CacheDataType>;
    hash: string;
    version: VersionEntry<CacheDataType>;
  }): CacheDataType {
    if (version.state === 'live') {
      version.lastReadAt = Date.now();

      return version.data;
    }

    const unpackStartedAt = performance.now();
    const data = this.getProviderOrThrow(keyName).decodeFromCacheStorage(
      JSON.parse(version.blob.toString('utf8')),
    );

    entry.versions.set(hash, {
      state: 'live',
      data,
      lastReadAt: Date.now(),
    });

    this.cacheMetricsService.recordUnpacking(
      (performance.now() - unpackStartedAt) / 1000,
      keyName,
    );

    return data;
  }

  private cleanupStaleVersions(
    entry: WorkspaceLocalCacheEntry<CacheDataType>,
  ): void {
    const now = Date.now();

    for (const [hash, version] of entry.versions) {
      if (
        hash !== entry.latestHash &&
        now - version.lastReadAt > STALE_VERSION_TTL_MS
      ) {
        entry.versions.delete(hash);
      }
    }

    if (entry.versions.size >= MAX_LOCAL_STALE_VERSIONS) {
      const sorted = [...entry.versions.entries()]
        .filter(([hash]) => hash !== entry.latestHash)
        .sort((entryA, entryB) => entryA[1].lastReadAt - entryB[1].lastReadAt);

      while (
        entry.versions.size >= MAX_LOCAL_STALE_VERSIONS &&
        sorted.length > 0
      ) {
        const oldestEntry = sorted.shift();

        if (isDefined(oldestEntry)) {
          entry.versions.delete(oldestEntry[0]);
        }
      }
    }
  }

  private getProviderOrThrow(
    keyName: WorkspaceCacheKeyName,
  ): WorkspaceCacheProvider<CacheDataType, StoredCacheDataType> {
    const provider = this.workspaceCacheProviders.get(keyName);

    if (!isDefined(provider)) {
      throw new Error(`Cache provider with key name "${keyName}" not found`);
    }

    return provider;
  }

  private buildCacheKey(
    workspaceId: string,
    keyName: WorkspaceCacheKeyName,
  ): string {
    return `${keyName}:${workspaceId}`;
  }
}
