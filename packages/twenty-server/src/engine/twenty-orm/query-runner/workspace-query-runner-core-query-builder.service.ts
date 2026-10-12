import { Injectable } from '@nestjs/common';

import {
  DataSource,
  type EntityTarget,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';

import { WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';

type CreateCoreQueryBuilderInput<TEntity extends ObjectLiteral> = {
  queryRunner: WorkspaceQueryRunner;
  target: EntityTarget<TEntity>;
  alias: string;
};

@Injectable()
export class WorkspaceQueryRunnerCoreQueryBuilderService {
  constructor(
    private readonly coreDataSource: DataSource,
    private readonly globalWorkspaceDataSourceService: GlobalWorkspaceDataSourceService,
  ) {}

  createCoreQueryBuilder<TEntity extends ObjectLiteral>({
    queryRunner,
    target,
    alias,
  }: CreateCoreQueryBuilderInput<TEntity>): SelectQueryBuilder<TEntity> {
    const originalManager = queryRunner.manager;
    const primaryWorkspaceDataSource =
      this.globalWorkspaceDataSourceService.getGlobalWorkspaceDataSource();

    if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
      throw new Error(
        'Core QueryBuilder access requires an active WorkspaceQueryRunner transaction',
      );
    }

    if (
      queryRunner.connection !== primaryWorkspaceDataSource ||
      !(originalManager instanceof WorkspaceEntityManager) ||
      originalManager.queryRunner !== queryRunner
    ) {
      throw new Error(
        'Core QueryBuilder access requires the primary WorkspaceQueryRunner with its original WorkspaceEntityManager',
      );
    }

    if (typeof target === 'string' || alias.trim().length === 0) {
      throw new Error(
        'Core QueryBuilder access requires a registered Core entity target and alias',
      );
    }

    try {
      this.coreDataSource.getMetadata(target);
    } catch {
      throw new Error(
        'Core QueryBuilder access requires a registered Core entity target',
      );
    }

    const queryBuilder = this.coreDataSource.createQueryBuilder(
      target,
      alias,
      queryRunner,
    );
    const boundQueryRunner = (
      queryBuilder as unknown as { queryRunner?: WorkspaceQueryRunner }
    ).queryRunner;

    if (
      queryBuilder.connection !== this.coreDataSource ||
      boundQueryRunner !== queryRunner ||
      queryRunner.manager !== originalManager ||
      !(queryRunner.manager instanceof WorkspaceEntityManager) ||
      queryRunner.manager.queryRunner !== queryRunner
    ) {
      throw new Error(
        'Core QueryBuilder creation did not preserve the WorkspaceQueryRunner manager contract',
      );
    }

    return queryBuilder;
  }
}
