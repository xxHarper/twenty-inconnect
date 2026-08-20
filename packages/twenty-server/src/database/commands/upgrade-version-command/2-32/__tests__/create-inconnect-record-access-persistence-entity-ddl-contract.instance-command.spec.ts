import { DataSource, getMetadataArgsStorage, type QueryRunner } from 'typeorm';

import { CreateInconnectRecordAccessPersistenceFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1786740000000-create-inconnect-record-access-persistence';
import { InconnectRecordAccessConfigurationEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-configuration.entity';
import { InconnectRecordAccessManagedObjectEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-managed-object.entity';
import { InconnectRecordAccessPolicyEntity } from 'src/engine/core-modules/inconnect-record-access/entities/inconnect-record-access-policy.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

type PrimaryKeyContract = {
  columns: string[];
  constraintName: string | undefined;
  tablePath: string;
};

type ForeignKeyContract = {
  columns: string[];
  constraintName: string;
  onDelete: string | undefined;
  referencedColumns: string[];
  referencedTablePath: string;
  tablePath: string;
};

type IndexContract = {
  columns: string[];
  indexName: string;
  isUnique: boolean;
  tablePath: string;
  where: string | null;
};

const parseQuotedColumns = (value: string): string[] =>
  [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

const sortByConstraintName = <
  TContract extends { constraintName: string | undefined },
>(
  contracts: TContract[],
): TContract[] =>
  contracts.sort((left, right) =>
    (left.constraintName ?? '').localeCompare(right.constraintName ?? ''),
  );

const sortByIndexName = <TContract extends { indexName: string }>(
  contracts: TContract[],
): TContract[] =>
  contracts.sort((left, right) =>
    left.indexName.localeCompare(right.indexName),
  );

describe('INCONNECT persisted record-access Entity and DDL contract', () => {
  it('keeps real TypeORM PK, FK, and index metadata aligned with the instance command', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command =
      new CreateInconnectRecordAccessPersistenceFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls.map((call) => call[0] as string);
    const entityTargets = [
      ...new Set(getMetadataArgsStorage().tables.map(({ target }) => target)),
    ];
    const dataSource = new DataSource({
      type: 'postgres',
      database: 'metadata-only',
      entities: entityTargets,
      schema: 'core',
    });

    await (
      dataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const managedTablePaths = new Set([
      'core.inconnectRecordAccessConfiguration',
      'core.inconnectRecordAccessManagedObject',
      'core.inconnectRecordAccessPolicy',
    ]);

    const ddlPrimaryKeys = statements.flatMap(
      (statement): PrimaryKeyContract[] => {
        const match = statement.match(
          /^CREATE TABLE "([^"]+)"\."([^"]+)".*CONSTRAINT "([^"]+)" PRIMARY KEY \(([^)]+)\)\)$/,
        );

        return match === null ||
          !managedTablePaths.has(`${match[1]}.${match[2]}`)
          ? []
          : [
              {
                columns: parseQuotedColumns(match[4]),
                constraintName: match[3],
                tablePath: `${match[1]}.${match[2]}`,
              },
            ];
      },
    );
    const entityPrimaryKeys = [
      InconnectRecordAccessConfigurationEntity,
      InconnectRecordAccessManagedObjectEntity,
      InconnectRecordAccessPolicyEntity,
    ].map((entity): PrimaryKeyContract => {
      const metadata = dataSource.getMetadata(entity);

      return {
        columns: metadata.primaryColumns.map(
          ({ databaseName }) => databaseName,
        ),
        constraintName: metadata.primaryColumns[0]?.primaryKeyConstraintName,
        tablePath: metadata.tablePath,
      };
    });

    expect(sortByConstraintName(entityPrimaryKeys)).toEqual(
      sortByConstraintName(ddlPrimaryKeys),
    );

    const ddlForeignKeys = statements.flatMap(
      (statement): ForeignKeyContract[] => {
        const match = statement.match(
          /^ALTER TABLE "([^"]+)"\."([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "([^"]+)"\."([^"]+)"\(([^)]+)\) ON DELETE ([A-Z ]+) ON UPDATE [A-Z ]+$/,
        );

        return match === null ||
          !managedTablePaths.has(`${match[1]}.${match[2]}`)
          ? []
          : [
              {
                columns: parseQuotedColumns(match[4]),
                constraintName: match[3],
                onDelete: match[8],
                referencedColumns: parseQuotedColumns(match[7]),
                referencedTablePath: `${match[5]}.${match[6]}`,
                tablePath: `${match[1]}.${match[2]}`,
              },
            ];
      },
    );
    const entityForeignKeys = [
      InconnectRecordAccessConfigurationEntity,
      InconnectRecordAccessManagedObjectEntity,
      InconnectRecordAccessPolicyEntity,
    ].flatMap((entity): ForeignKeyContract[] => {
      const metadata = dataSource.getMetadata(entity);

      return metadata.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.columnNames,
        constraintName: foreignKey.name,
        onDelete: foreignKey.onDelete,
        referencedColumns: foreignKey.referencedColumnNames,
        referencedTablePath: foreignKey.referencedTablePath,
        tablePath: metadata.tablePath,
      }));
    });

    expect(sortByConstraintName(entityForeignKeys)).toEqual(
      sortByConstraintName(ddlForeignKeys),
    );

    const ddlIndexes = statements.flatMap((statement): IndexContract[] => {
      const match = statement.match(
        /^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\."([^"]+)" \(([^)]+)\)(?: WHERE (.+))?$/,
      );

      return match === null
        ? []
        : [
            {
              columns: parseQuotedColumns(match[5]),
              indexName: match[2],
              isUnique: match[1] !== undefined,
              tablePath: `${match[3]}.${match[4]}`,
              where: match[6] ?? null,
            },
          ];
    });
    const indexEntityMetadata = [
      dataSource.getMetadata(InconnectRecordAccessManagedObjectEntity),
      dataSource.getMetadata(InconnectRecordAccessPolicyEntity),
      dataSource.getMetadata(RoleEntity),
      dataSource.getMetadata(ObjectMetadataEntity),
      dataSource.getMetadata(FieldMetadataEntity),
    ];
    const ddlIndexNames = new Set(ddlIndexes.map(({ indexName }) => indexName));
    const entityIndexes = indexEntityMetadata.flatMap(
      (metadata): IndexContract[] =>
        metadata.indices
          .filter(({ name }) => ddlIndexNames.has(name))
          .map((index) => ({
            columns: index.columns.map(({ databaseName }) => databaseName),
            indexName: index.name,
            isUnique: index.isUnique,
            tablePath: metadata.tablePath,
            where: index.where ?? null,
          })),
    );

    expect(sortByIndexName(entityIndexes)).toEqual(sortByIndexName(ddlIndexes));
  });
});
