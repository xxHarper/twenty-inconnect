import { type DataSource, type SelectQueryBuilder } from 'typeorm';

import { WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { WorkspaceQueryRunnerCoreQueryBuilderService } from 'src/engine/twenty-orm/query-runner/workspace-query-runner-core-query-builder.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';

class KnownCoreEntity {}
class UnknownCoreEntity {}

const buildHarness = () => {
  const primaryWorkspaceDataSource = {};
  const manager = Object.create(
    WorkspaceEntityManager.prototype,
  ) as WorkspaceEntityManager;
  const queryRunner = {
    connection: primaryWorkspaceDataSource,
    isReleased: false,
    isTransactionActive: true,
    manager,
  } as WorkspaceQueryRunner;

  Object.defineProperty(manager, 'queryRunner', {
    configurable: true,
    value: queryRunner,
  });

  const queryBuilder = {
    connection: undefined,
    queryRunner: undefined,
  } as unknown as SelectQueryBuilder<KnownCoreEntity>;
  const coreDataSource = {
    createEntityManager: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
    getMetadata: jest.fn((target) => {
      if (target !== KnownCoreEntity) {
        throw new Error('metadata missing');
      }

      return { target };
    }),
  } as unknown as DataSource;

  Object.assign(queryBuilder, {
    connection: coreDataSource,
    queryRunner,
  });

  const globalWorkspaceDataSourceService = {
    getGlobalWorkspaceDataSource: jest.fn(() => primaryWorkspaceDataSource),
  } as unknown as GlobalWorkspaceDataSourceService;
  const service = new WorkspaceQueryRunnerCoreQueryBuilderService(
    coreDataSource,
    globalWorkspaceDataSourceService,
  );

  return {
    coreDataSource,
    manager,
    primaryWorkspaceDataSource,
    queryBuilder,
    queryRunner,
    service,
  };
};

describe('WorkspaceQueryRunnerCoreQueryBuilderService', () => {
  it('returns a Core QueryBuilder bound to the exact runner without replacing its manager', () => {
    const harness = buildHarness();
    const originalManager = harness.queryRunner.manager;

    const result = harness.service.createCoreQueryBuilder({
      queryRunner: harness.queryRunner,
      target: KnownCoreEntity,
      alias: 'knownCore',
    });

    expect(result).toBe(harness.queryBuilder);
    expect(
      (result as unknown as { queryRunner?: WorkspaceQueryRunner }).queryRunner,
    ).toBe(harness.queryRunner);
    expect(harness.queryRunner.manager).toBe(originalManager);
    expect(harness.queryRunner.manager).toBeInstanceOf(WorkspaceEntityManager);
    expect(harness.queryRunner.manager.queryRunner).toBe(harness.queryRunner);
    expect(harness.coreDataSource.createEntityManager).not.toHaveBeenCalled();
  });

  it('rejects an inactive transaction', () => {
    const harness = buildHarness();

    Object.assign(harness.queryRunner, { isTransactionActive: false });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('active WorkspaceQueryRunner transaction');
  });

  it('rejects a released runner', () => {
    const harness = buildHarness();

    Object.assign(harness.queryRunner, { isReleased: true });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('active WorkspaceQueryRunner transaction');
  });

  it('rejects a runner from another datasource', () => {
    const harness = buildHarness();

    Object.assign(harness.queryRunner, { connection: {} });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('primary WorkspaceQueryRunner');
  });

  it('rejects a non-WorkspaceEntityManager', () => {
    const harness = buildHarness();

    Object.assign(harness.queryRunner, { manager: {} });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('original WorkspaceEntityManager');
  });

  it('rejects a manager bound to another runner', () => {
    const harness = buildHarness();

    Object.defineProperty(harness.manager, 'queryRunner', {
      configurable: true,
      value: {},
    });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('original WorkspaceEntityManager');
  });

  it('rejects an unknown Core target', () => {
    const harness = buildHarness();

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: UnknownCoreEntity,
        alias: 'unknownCore',
      }),
    ).toThrow('registered Core entity target');
  });

  it('rejects string table targets', () => {
    const harness = buildHarness();

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: 'core.someTable',
        alias: 'someTable',
      }),
    ).toThrow('registered Core entity target and alias');
  });

  it('fails closed if builder creation changes the installed manager', () => {
    const harness = buildHarness();

    jest
      .mocked(harness.coreDataSource.createQueryBuilder)
      .mockImplementationOnce(() => {
        Object.assign(harness.queryRunner, { manager: {} });

        return harness.queryBuilder;
      });

    expect(() =>
      harness.service.createCoreQueryBuilder({
        queryRunner: harness.queryRunner,
        target: KnownCoreEntity,
        alias: 'knownCore',
      }),
    ).toThrow('did not preserve');
  });
});
