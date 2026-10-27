import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { FieldMetadataType, type LeadPoolFilter } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InconnectRecordAccessAuthorizationService } from 'src/engine/core-modules/inconnect-record-access/services/inconnect-record-access-authorization.service';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';
import { type LeadPoolAuthority } from 'src/modules/inconnect-lead-management/manual-pool/lead-pool-authority.service';

export type AuthorizedPoolRow = {
  id: string;
  ownerId: string | null;
  updatedAt: string;
  label: string | null;
};

@Injectable()
export class LeadPoolQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly recordAccess: InconnectRecordAccessAuthorizationService,
  ) {}

  async build(
    authContext: WorkspaceAuthContext,
    authority: LeadPoolAuthority,
    filter: LeadPoolFilter,
    runner?: WorkspaceQueryRunner,
  ) {
    const column = (name: string) => `pool.${escapeIdentifier(name)}`;
    const query = this.dataSource
      .createQueryBuilder(runner)
      .select('pool."id"', 'id')
      .addSelect(column(authority.ownerColumn), 'ownerId')
      .addSelect('pool."updatedAt"::text', 'updatedAt')
      .addSelect(column(authority.labelField.name), 'label')
      .from(
        `${authority.schema}.${computeObjectTargetTable(authority.context.flatObjectMetadata)}`,
        'pool',
      )
      .where('pool."deletedAt" IS NULL');
    // Standard object/field permissions are resolved before building this query.
    // Record Access stays in SQL for counts, sorting, paging and exact selection.
    const scope = await this.recordAccess.applyReadScopeToQueryBuilder({
      authContext,
      workspaceId: authContext.workspace.id,
      objectMetadataId: authority.context.flatObjectMetadata.id,
      queryBuilder: query,
      tableAlias: 'pool',
    });
    if (scope.kind === 'denied' || scope.kind === 'system-bypass')
      throw new BadRequestException('Lead selection unavailable');
    if (filter.ownerId)
      query.andWhere(`${column(authority.ownerColumn)} = :poolOwner`, {
        poolOwner: filter.ownerId,
      });
    if (filter.search)
      query.andWhere(`${column(authority.labelField.name)} ILIKE :poolSearch`, {
        poolSearch: `%${filter.search.replace(/[\\%_]/g, '\\$&')}%`,
      });
    for (const [index, condition] of (filter.conditions ?? []).entries()) {
      const field = authority.fields.find(
        (candidate) => candidate.id === condition.fieldId,
      );
      const publicField = authority.publicFields.find(
        (candidate) => candidate.id === condition.fieldId,
      );
      if (!field || !publicField)
        throw new BadRequestException('Unsupported or inaccessible filter');
      const temporal =
        field.type === FieldMetadataType.DATE ||
        field.type === FieldMetadataType.DATE_TIME;
      if (
        (condition.operator === 'BEFORE' || condition.operator === 'AFTER') &&
        !temporal
      )
        throw new BadRequestException('Invalid filter operator');
      let value: string | boolean = condition.value;
      if (field.type === FieldMetadataType.BOOLEAN) {
        if (!['true', 'false'].includes(condition.value))
          throw new BadRequestException('Invalid boolean filter');
        value = condition.value === 'true';
      }
      if (
        field.type === FieldMetadataType.SELECT &&
        !publicField.options.some((option) => option.value === value)
      )
        throw new BadRequestException('Invalid select option');
      if (
        temporal &&
        (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(condition.value) ||
          !Number.isFinite(Date.parse(condition.value)))
      )
        throw new BadRequestException('Invalid date filter');
      const operator = { EQ: '=', NEQ: '<>', BEFORE: '<', AFTER: '>' }[
        condition.operator
      ];
      query.andWhere(`${column(field.name)} ${operator} :poolFilter${index}`, {
        [`poolFilter${index}`]: value,
      });
    }
    if (filter.orderFieldId) {
      const field = authority.fields.find(
        (candidate) => candidate.id === filter.orderFieldId,
      );
      if (
        !field ||
        !authority.publicFields.some((candidate) => candidate.id === field.id)
      )
        throw new BadRequestException('Unsupported ordering');
      query.orderBy(
        column(field.name),
        filter.direction ?? 'ASC',
        'NULLS LAST',
      );
    }
    query.addOrderBy('pool."id"', 'ASC');
    return query;
  }

  async count(
    query: Awaited<ReturnType<LeadPoolQueryService['build']>>,
  ): Promise<number> {
    const row = await query
      .clone()
      .select('COUNT(1)', 'count')
      .orderBy()
      .getRawOne<{ count: string }>();
    const count = Number(row?.count);
    if (
      !row ||
      typeof row.count !== 'string' ||
      !/^\d+$/.test(row.count) ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new Error('Invalid authorized count');
    return count;
  }

  async selected(
    authContext: WorkspaceAuthContext,
    authority: LeadPoolAuthority,
    filter: LeadPoolFilter,
    ids: string[],
    runner?: WorkspaceQueryRunner,
  ): Promise<AuthorizedPoolRow[]> {
    if (ids.length === 0) return [];
    const query = await this.build(authContext, authority, filter, runner);
    query.andWhere('pool."id" IN (:...poolIds)', { poolIds: ids });
    if (runner) query.setLock('pessimistic_write');
    return query.getRawMany<AuthorizedPoolRow>();
  }
}
