import { type DataSource } from 'typeorm';

import { disposableDataSourceOptions } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/datasource-options';
import { requirePhysicalExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/isolation';
import { validateHarnessEnvironment } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/target-contract';

// No runtime service/metadata import is reachable while PG0 is blocked.
// No AppModule, Nest lifecycle, broad command registry or production config.
export const createPhysicalRunner = async (
  contract: unknown,
  password: string,
  environment: Record<string, string | undefined>,
) => {
  requirePhysicalExecutionSafety();
  validateHarnessEnvironment(process.env);
  validateHarnessEnvironment(environment);
  const { DataSource: PostgreSqlDataSource, getMetadataArgsStorage } =
    await import('typeorm');
  const { InstanceCommandRunnerService } =
    await import('src/engine/core-modules/upgrade/services/instance-command-runner.service');
  const { UpgradeMigrationService } =
    await import('src/engine/core-modules/upgrade/services/upgrade-migration.service');
  const { WorkspaceVersionService } =
    await import('src/engine/workspace-manager/workspace-version/services/workspace-version.service');
  const { UpgradeMigrationEntity } =
    await import('src/engine/core-modules/upgrade/upgrade-migration.entity');
  const { WorkspaceEntity } =
    await import('src/engine/core-modules/workspace/workspace.entity');
  type TwentyConfigService =
    import('src/engine/core-modules/twenty-config/twenty-config.service').TwentyConfigService;
  type UpgradeStatusService =
    import('src/engine/core-modules/upgrade/services/upgrade-status.service').UpgradeStatusService;
  // WorkspaceEntity's relation closure is required by TypeORM metadata building.
  // PG1 must pin/review this graph; no synchronize means no unrelated tables are created.
  const entities = getMetadataArgsStorage().tables.map(({ target }) => target);
  const dataSource: DataSource = new PostgreSqlDataSource(
    disposableDataSourceOptions(contract, password, environment, entities),
  );
  const cacheInvalidations: string[] = [];
  try {
    await dataSource.initialize();
    const tracking = new UpgradeMigrationService(
      dataSource.getRepository(UpgradeMigrationEntity),
    );
    const workspaces = new WorkspaceVersionService(
      dataSource.getRepository(WorkspaceEntity),
    );
    const runner = new InstanceCommandRunnerService(
      dataSource,
      {
        get: (key: string) => {
          if (key !== 'APP_VERSION')
            throw new Error('Unexpected configuration access');
          return '2.32.0';
        },
      } as unknown as TwentyConfigService,
      tracking,
      workspaces,
      {
        invalidateInstanceAndAllWorkspacesStatus: async () => {
          cacheInvalidations.push('mock-cache-invalidation');
        },
      } as unknown as UpgradeStatusService,
    );
    return {
      dataSource,
      runner,
      cacheInvalidations,
      dispose: async () => {
        if (dataSource.isInitialized) await dataSource.destroy();
      },
    };
  } catch (error) {
    if (dataSource.isInitialized) {
      try {
        await dataSource.destroy();
      } catch (cleanupError) {
        throw Object.assign(new Error('Physical setup and cleanup failed'), {
          cause: error,
          operationError: error,
          cleanupError,
        });
      }
    }
    throw error;
  }
};
