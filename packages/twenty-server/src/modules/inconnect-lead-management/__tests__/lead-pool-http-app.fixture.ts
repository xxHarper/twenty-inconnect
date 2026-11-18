import {
  type INestApplication,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, DiscoveryModule, ModulesContainer } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';
import { ApiPath } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { CommonArgsProcessors } from 'src/engine/api/common/common-args-processors/common-args-processors';
import { ProcessNestedRelationsHelper } from 'src/engine/api/common/common-nested-relations-processor/process-nested-relations.helper';
import { ProcessNestedRelationsV2Helper } from 'src/engine/api/common/common-nested-relations-processor/process-nested-relations-v2.helper';
import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { CommonResultGettersService } from 'src/engine/api/common/common-result-getters/common-result-getters.service';
import { WorkspaceQueryHookStorage } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/storage/workspace-query-hook.storage';
import { WorkspaceQueryHookExplorer } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.explorer';
import { WorkspaceQueryHookMetadataAccessor } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook-metadata.accessor';
import { WorkspaceQueryHookService } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.service';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ActorFromAuthContextService } from 'src/engine/core-modules/actor/services/actor-from-auth-context.service';
import { UpdatedByUpdateManyPreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-many.pre-query-hook';
import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { WorkspaceAuthContextMiddleware } from 'src/engine/core-modules/auth/middlewares/workspace-auth-context.middleware';
import { JwtAuthStrategy } from 'src/engine/core-modules/auth/strategies/jwt.auth.strategy';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { FileUrlService } from 'src/engine/core-modules/file/file-url/file-url.service';
import { useDisableIntrospectionAndSuggestionsForUnauthenticatedUsers } from 'src/engine/core-modules/graphql/hooks/use-disable-introspection-and-suggestions-for-unauthenticated-users.hook';
import { useGraphQLErrorHandlerHook } from 'src/engine/core-modules/graphql/hooks/use-graphql-error-handler.hook';
import { useValidateGraphqlQueryComplexity } from 'src/engine/core-modules/graphql/hooks/use-validate-graphql-query-complexity.hook';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { ImpersonationAuthorizationService } from 'src/engine/core-modules/impersonation/services/impersonation-authorization.service';
import { InconnectRecordAccessService } from 'src/engine/core-modules/inconnect-record-access/inconnect-record-access.service';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { InconnectRecordAccessPolicySourceService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-policy-source.service';
import { InconnectWorkspaceMemberService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-workspace-member.service';
import { JwtKeyManagerService } from 'src/engine/core-modules/jwt/services/jwt-key-manager.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { SigningKeyVerifyCounterService } from 'src/engine/core-modules/jwt/services/signing-key-verify-counter.service';
import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { RecordInputTransformerService } from 'src/engine/core-modules/record-transformer/services/record-input-transformer.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { UserSessionEntity } from 'src/engine/core-modules/user-session/user-session.entity';
import { UserSessionCookieService } from 'src/engine/core-modules/user-session/services/user-session-cookie.service';
import { UserSessionService } from 'src/engine/core-modules/user-session/services/user-session.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { CookieSessionCsrfMiddleware } from 'src/engine/middlewares/cookie-session-csrf.middleware';
import { GraphQLHydrateRequestFromTokenMiddleware } from 'src/engine/middlewares/graphql-hydrate-request-from-token.middleware';
import { MiddlewareService } from 'src/engine/middlewares/middleware.service';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceDataSourceV2Service } from 'src/engine/twenty-orm-v2/datasource/workspace-data-source-v2.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { UnhandledExceptionFilter } from 'src/filters/unhandled-exception.filter';
import { LeadManagementResolver } from 'src/modules/inconnect-lead-management/lead-management.resolver';
import { LeadPoolAuthorityService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';
import { LeadPoolQueryService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-query.service';
import { LeadPoolStoreService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-store.service';
import { LeadPoolService } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool.service';

@Module({})
class LeadPoolHttpTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        CookieSessionCsrfMiddleware,
        GraphQLHydrateRequestFromTokenMiddleware,
        WorkspaceAuthContextMiddleware,
      )
      .forRoutes({ path: ApiPath.Metadata, method: RequestMethod.ALL });
  }
}

const refuse = (boundary: string) =>
  jest.fn(() => {
    throw new Error(`Unexpected I/O boundary: ${boundary}`);
  });

const LIFECYCLE_METHODS = [
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
];

export const compileLeadPoolHttpApp = async ({
  core,
  getPrimary,
  readWorkspaceCache,
  readCoreCache,
  readSessionCache,
}: {
  core: DataSource;
  getPrimary: GlobalWorkspaceDataSourceService['getGlobalWorkspaceDataSource'];
  readWorkspaceCache: WorkspaceCacheService['getOrRecomputeWithHashes'];
  readCoreCache: CoreEntityCacheService['get'];
  readSessionCache: (tokenHash: string) => Promise<unknown>;
}) => {
  const settings = new Map<string, unknown>([
    ['APP_SECRET', 'lead-pool-http-fixture'],
    ['AUTH_COOKIE_SESSIONS_ENABLED', true],
    ['AUTH_COOKIE_SAME_SITE', 'lax'],
    ['AUTH_COOKIE_ALLOWED_ORIGINS', ''],
    ['SERVER_URL', 'http://lead-pool.invalid'],
    ['FRONTEND_URL', 'http://lead-pool.invalid'],
    ['NODE_ENV', 'production'],
    ['SESSION_IDLE_TIMEOUT', '1h'],
    ['COMMON_QUERY_COMPLEXITY_LIMIT', 2000],
    ['INCONNECT_RECORD_ACCESS_SOURCE_MODE', 'database'],
  ]);
  const config = {
    get: (key: string) => {
      if (!settings.has(key)) throw new Error(`Unexpected config read: ${key}`);
      return settings.get(key);
    },
  } as TwentyConfigService;
  const i18n = new I18nService();
  const metrics = {
    incrementCounterForEvent: jest.fn().mockResolvedValue(undefined),
  } satisfies Pick<MetricsService, 'incrementCounterForEvent'>;
  const exceptionHandler = new ExceptionHandlerService({
    captureExceptions: jest.fn().mockReturnValue([]),
  });
  const graphql = GraphQLModule.forRoot<YogaDriverConfig>({
    driver: YogaDriver,
    autoSchemaFile: true,
    resolverSchemaScope: 'metadata',
    path: `/${ApiPath.Metadata}`,
    graphiql: false,
    plugins: [
      useGraphQLErrorHandlerHook({
        metricsService: metrics as unknown as MetricsService,
        exceptionHandlerService: exceptionHandler,
        i18nService: i18n,
        twentyConfigService: config,
      }),
      useDisableIntrospectionAndSuggestionsForUnauthenticatedUsers(true),
      useValidateGraphqlQueryComplexity({
        maximumAllowedFields: 100,
        maximumAllowedRootResolvers: 10,
        maximumAllowedNestedFields: 10,
        checkDuplicateRootResolvers: true,
      }),
    ],
  });
  const module = await Test.createTestingModule({
    imports: [
      {
        module: LeadPoolHttpTestModule,
        imports: [DiscoveryModule, graphql],
        providers: [
          { provide: APP_FILTER, useClass: UnhandledExceptionFilter },
          LeadManagementResolver,
          LeadPoolService,
          LeadPoolAuthorityService,
          LeadPoolQueryService,
          LeadPoolStoreService,
          InconnectRecordAccessAuthorizationService,
          InconnectRecordAccessPolicySourceService,
          InconnectRecordAccessService,
          InconnectWorkspaceMemberService,
          GlobalWorkspaceOrmManager,
          WorkspaceManyOrAllFlatEntityMapsCacheService,
          CommonUpdateManyQueryRunnerService,
          ...CommonArgsProcessors,
          ProcessNestedRelationsHelper,
          ProcessNestedRelationsV2Helper,
          CommonResultGettersService,
          RecordInputTransformerService,
          RecordPositionService,
          FileUrlService,
          WorkspaceQueryHookExplorer,
          WorkspaceQueryHookStorage,
          WorkspaceQueryHookMetadataAccessor,
          WorkspaceQueryHookService,
          ActorFromAuthContextService,
          UpdatedByUpdateManyPreQueryHook,
          MiddlewareService,
          AccessTokenService,
          JwtService,
          JwtWrapperService,
          JwtAuthStrategy,
          UserSessionService,
          UserSessionCookieService,
          { provide: I18nService, useValue: i18n },
          { provide: TwentyConfigService, useValue: config },
          { provide: DataSource, useValue: core },
          { provide: ExceptionHandlerService, useValue: exceptionHandler },
          { provide: MetricsService, useValue: metrics },
          {
            provide: WorkspaceCacheService,
            useValue: {
              getOrRecomputeWithHashes: readWorkspaceCache,
              getOrRecompute: async (
                ...args: Parameters<WorkspaceCacheService['getOrRecompute']>
              ) => (await readWorkspaceCache(...args)).data,
            },
          },
          {
            provide: GlobalWorkspaceDataSourceService,
            useValue: { getGlobalWorkspaceDataSource: getPrimary },
          },
          {
            provide: WorkspaceCacheStorageService,
            useValue: { getMetadataVersion: async () => 1 },
          },
          { provide: CoreEntityCacheService, useValue: { get: readCoreCache } },
          {
            provide: CacheStorageNamespace.EngineAuthSession,
            useValue: {
              get: readSessionCache,
              del: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: getRepositoryToken(UserSessionEntity),
            useValue: { findOneBy: async () => null },
          },
          {
            provide: SigningKeyVerifyCounterService,
            useValue: { recordLegacyVerify: jest.fn() },
          },
          {
            provide: JwtKeyManagerService,
            useValue: { getValidPublicKeyPemById: refuse('signing key store') },
          },
          { provide: getRepositoryToken(AppTokenEntity), useValue: {} },
          { provide: getRepositoryToken(UserEntity), useValue: {} },
          { provide: getRepositoryToken(WorkspaceEntity), useValue: {} },
          { provide: getRepositoryToken(UserWorkspaceEntity), useValue: {} },
          {
            provide: EventLogEmitterService,
            useValue: { emit: refuse('event log') },
          },
          {
            provide: ImpersonationAuthorizationService,
            useValue: { authorize: refuse('impersonation') },
          },
          {
            provide: PermissionsService,
            useValue: {
              userHasWorkspaceSettingPermission: refuse(
                'settings permission lookup',
              ),
            },
          },
          {
            provide: ThrottlerService,
            useValue: {
              tokenBucketThrottleOrThrow: refuse('throttle storage'),
            },
          },
          { provide: FeatureFlagService, useValue: {} },
          {
            provide: WorkspaceDataSourceV2Service,
            useValue: { getDataSource: refuse('ORM V2 datasource') },
          },
        ],
      },
    ],
  }).compile();
  // Fail before init if a module or a provider gains an unreviewed lifecycle.
  const modules = [...module.get(ModulesContainer).values()];
  expect(modules.map(({ metatype }) => metatype.name).sort()).toEqual([
    'DiscoveryModule',
    'GraphQLModule',
    'GraphQLSchemaBuilderModule',
    'InternalCoreModule',
    'LeadPoolHttpTestModule',
    'RootTestModule',
  ]);
  const instances: unknown[] = modules.flatMap(
    ({ providers, controllers, injectables }) =>
      [
        ...providers.values(),
        ...controllers.values(),
        ...injectables.values(),
      ].map(({ instance }) => instance),
  );
  // Nest instantiates route middleware during init, after this inspection.
  instances.push(
    CookieSessionCsrfMiddleware.prototype,
    GraphQLHydrateRequestFromTokenMiddleware.prototype,
    WorkspaceAuthContextMiddleware.prototype,
  );
  const hooks = instances
    .flatMap((instance) => {
      if (typeof instance !== 'object' || instance === null) return [];
      return LIFECYCLE_METHODS.filter(
        (method) => typeof Reflect.get(instance, method) === 'function',
      ).map((method) => `${instance.constructor.name}.${method}`);
    })
    .sort();

  expect(hooks).toEqual([
    'GraphQLModule.onApplicationShutdown',
    'GraphQLModule.onModuleDestroy',
    'GraphQLModule.onModuleInit',
    'I18nService.onModuleInit',
    'WorkspaceQueryHookExplorer.onModuleInit',
  ]);

  return module.createNestApplication<INestApplication>({ logger: false });
};
