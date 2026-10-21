import { readFileSync } from 'node:fs';

import { getCoreEntityMetadatasWithWorkspaceId } from 'src/database/commands/workspace-export/utils/get-core-entity-metadatas-with-workspace-id.util';
import {
  ATTENTION_LEDGER_UP,
  ATTENTION_LEDGER_DOWN,
  CreateInconnectMessagingAttentionLedgerFastInstanceCommand,
} from 'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1792540800000-create-inconnect-messaging-attention-ledger';
import {
  attentionEntities,
  attentionExistingEntities,
  attentionStepName,
  buildAttentionMetadata,
  normalizeAttentionSql,
  quotedAttentionColumns,
  attentionCheckExpression,
} from 'src/database/commands/upgrade-version-command/2-32/__tests__/attention-ledger-metadata.fixtures';
import { getRegisteredInstanceCommandMetadata } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { resolveEntityShapeAtUpgradeCursor } from 'src/engine/core-modules/upgrade/utils/resolve-entity-shape-at-upgrade-cursor.util';
import { ATTENTION_EXACT_TIMESTAMP } from 'src/modules/inconnect-messaging/entities/attention-exact-timestamp';
import {
  epoch,
  physicalRows,
  response,
  pending,
  timestamp,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence/__tests__/attention-persistence.fixtures';
import {
  decodeAttentionEpochRow,
  decodeAttentionEffectRow,
  decodeAttentionReceiptRow,
  decodeAttentionResponseIntentRow,
  decodeAttentionTransitionAuditRow,
} from 'src/modules/inconnect-messaging/attention-adapter/persistence';

const { dataSource, metadata } = buildAttentionMetadata();
const up = ATTENTION_LEDGER_UP.join('\n');
const down = ATTENTION_LEDGER_DOWN.join('\n');
const inboundRows = physicalRows();
const responseRows = physicalRows(response(), pending());
const cases = [
  [attentionEntities[0], epoch, decodeAttentionEpochRow],
  [attentionEntities[1], inboundRows.effect, decodeAttentionEffectRow],
  [
    attentionEntities[2],
    inboundRows.canonicalReceipt,
    decodeAttentionReceiptRow,
  ],
  [
    attentionEntities[3],
    responseRows.intent!,
    decodeAttentionResponseIntentRow,
  ],
  [
    attentionEntities[4],
    inboundRows.canonicalAudit,
    decodeAttentionTransitionAuditRow,
  ],
] as const;

describe('attention entity and DDL source contracts (no driver execution)', () => {
  it.each(cases)(
    'should preserve every C2-I-A field for %p',
    (entity, row, decode) => {
      const entityMetadata = dataSource.getMetadata(entity);
      expect(
        entityMetadata.columns
          .filter(
            ({ propertyName }) =>
              propertyName !== 'attentionCreatedTransactionId',
          )
          .map(({ propertyName }) => propertyName)
          .sort(),
      ).toEqual(Object.keys(row).sort());
      expect(decode({ ...row })).toMatchObject({ ok: true, value: row });
      expect(entityMetadata.schema).toBe('core');
      expect(
        entityMetadata.primaryColumns.map(({ propertyName }) => propertyName),
      ).toEqual(['id']);
      expect(entityMetadata.deleteDateColumn).toBeUndefined();
      expect(entityMetadata.relations).toHaveLength(0);
    },
  );

  it.each(attentionEntities)(
    'should match types, nullability, defaults and collation for %p',
    (entity) => {
      const entityMetadata = dataSource.getMetadata(entity);
      const statement = ATTENTION_LEDGER_UP.find((sql) =>
        sql.startsWith(`CREATE TABLE "core"."${entityMetadata.tableName}"`),
      )!;
      expect(statement).toBeDefined();
      const declarations = [
        ...statement.matchAll(
          /^\s+"([^"]+)" (uuid|text|varchar|integer|jsonb|timestamptz\(6\))([^\n]*)/gm,
        ),
      ];
      expect(declarations).toHaveLength(entityMetadata.columns.length);

      for (const [, name, type, suffix] of declarations) {
        const column = entityMetadata.findColumnWithPropertyName(name)!;
        expect(column.type).toBe(
          type === 'timestamptz(6)' ? 'timestamptz' : type,
        );
        expect(column.isNullable).toBe(!suffix.includes('NOT NULL'));
        if (type === 'text') expect(column.collation).toBe('C');
        if (type === 'timestamptz(6)') {
          expect(column.precision).toBe(6);
          expect(column.transformer).toBe(ATTENTION_EXACT_TIMESTAMP);
          expect(
            typeof column.default === 'function' ? column.default() : undefined,
          ).toBe(suffix.includes('DEFAULT now()') ? 'now()' : undefined);
        }
        if (name === 'id')
          expect(
            column.isGenerated && column.generationStrategy === 'uuid',
          ).toBe(true);
      }
    },
  );

  it('should have the seven business columns plus four technical markers and the status candidate key', () => {
    const additions = [
      ...up.matchAll(
        /ADD "([^"]+)" (varchar|integer|uuid|text|timestamptz\(6\))/g,
      ),
    ].map((match) => match[1]);
    expect(additions.sort()).toEqual(
      [
        'attentionCreatedTransactionId',
        'attentionCreatedTransactionId',
        'attentionCreatedTransactionId',
        'attentionUpdatedTransactionId',
        'attentionGateUpdatedAt',
        'attentionRevision',
        'attentionStatus',
        'attentionTrackingEpochId',
        'attentionTrackingEpochId',
        'attentionTrackingMode',
        'attentionWriterProtocolVersion',
      ].sort(),
    );
    expect(up).toContain('"IDX_IM_AT_STATUS_MESSAGE_WORKSPACE"');
    expect(up).not.toMatch(
      /ALTER TABLE "core"\."inconnectMessagingWebhookReceipt"/,
    );
  });

  it('should match all existing-table marker declarations and remove them symmetrically', () => {
    for (const entity of attentionExistingEntities) {
      const entityMetadata = dataSource.getMetadata(entity);
      for (const column of entityMetadata.columns.filter(({ propertyName }) =>
        /TransactionId$/.test(propertyName),
      )) {
        const statement = ATTENTION_LEDGER_UP.find(
          (sql) =>
            sql.startsWith(
              `ALTER TABLE "core"."${entityMetadata.tableName}" ADD `,
            ) && sql.includes(`ADD "${column.databaseName}" `),
        )!;
        expect(statement).toContain(
          `ADD "${column.databaseName}" text COLLATE "C"`,
        );
        expect(column.type).toBe('text');
        expect(column.collation).toBe('C');
        expect(column.isNullable).toBe(true);
        expect(column.default).toBeUndefined();
        expect([column.isSelect, column.isInsert, column.isUpdate]).toEqual([
          false,
          false,
          false,
        ]);
        expect(
          ATTENTION_LEDGER_DOWN.some(
            (sql) =>
              sql.startsWith(
                `ALTER TABLE "core"."${entityMetadata.tableName}" `,
              ) && sql.includes(`DROP COLUMN "${column.databaseName}"`),
          ),
        ).toBe(true);
      }
    }
  });

  it.each(attentionEntities)(
    'should keep the PostgreSQL-owned marker outside C2-I-A projections for %p',
    (entity) => {
      const entityMetadata = dataSource.getMetadata(entity);
      const column = entityMetadata.findColumnWithPropertyName(
        'attentionCreatedTransactionId',
      )!;
      expect(column.isNullable).toBe(false);
      expect(column.default).toBeUndefined();
      expect([column.isSelect, column.isInsert, column.isUpdate]).toEqual([
        false,
        false,
        false,
      ]);
      expect(entityMetadata.getInsertionReturningColumns()).not.toContain(
        column,
      );
      expect(
        dataSource.createQueryBuilder(entity, 'attention').getSql(),
      ).not.toContain('attentionCreatedTransactionId');
    },
  );

  it('should match every new composite FK and its deferrability to ORM metadata', () => {
    const foreignKeys = metadata.flatMap((item) => item.foreignKeys);
    const statements = ATTENTION_LEDGER_UP.filter((statement) =>
      statement.includes(' FOREIGN KEY '),
    );
    expect(foreignKeys).toHaveLength(statements.length);
    for (const foreignKey of foreignKeys) {
      const statement = statements.find((sql) =>
        sql.includes(`CONSTRAINT "${foreignKey.name}"`),
      )!;
      const match =
        /FOREIGN KEY \(([^)]+)\) REFERENCES "core"\."([^"]+)" \(([^)]+)\)/.exec(
          statement,
        )!;
      expect(quotedAttentionColumns(match[1])).toEqual(
        foreignKey.columns.map(({ databaseName }) => databaseName),
      );
      expect(match[2]).toBe(foreignKey.referencedEntityMetadata.tableName);
      expect(quotedAttentionColumns(match[3])).toEqual(
        foreignKey.referencedColumns.map(({ databaseName }) => databaseName),
      );
      expect(statement).toContain('ON DELETE NO ACTION ON UPDATE NO ACTION');
      expect(statement.includes('DEFERRABLE INITIALLY DEFERRED')).toBe(
        foreignKey.deferrable === 'INITIALLY DEFERRED',
      );
      const childColumns = foreignKey.columns.map(
        ({ propertyName }) => propertyName,
      );
      expect(
        foreignKey.entityMetadata.indices.some((index) =>
          childColumns.every(
            (name, position) => index.columns[position]?.propertyName === name,
          ),
        ),
      ).toBe(true);
      const parentColumns = foreignKey.referencedColumns.map(
        ({ propertyName }) => propertyName,
      );
      expect(
        foreignKey.referencedEntityMetadata.indices.some(
          (index) =>
            index.isUnique &&
            index.columns.map(({ propertyName }) => propertyName).join() ===
              parentColumns.join(),
        ),
      ).toBe(true);
    }
    expect(foreignKeys.filter(({ deferrable }) => deferrable)).toHaveLength(4);
  });

  it('should match all new indexes, immediate candidate keys and partial predicates', () => {
    const indexes = metadata
      .flatMap((item) => item.indices)
      .filter(({ name }) => name.startsWith('IDX_IM_AT_'));
    const statements = ATTENTION_LEDGER_UP.filter(
      (sql) => sql.startsWith('CREATE ') && sql.includes(' INDEX '),
    );
    expect(statements).toHaveLength(indexes.length);
    for (const index of indexes) {
      const statement = statements.find((sql) =>
        sql.includes(`INDEX "${index.name}"`),
      )!;
      const columns = / ON "core"\."[^"]+" \(([^)]+)\)/.exec(statement)!;
      expect(quotedAttentionColumns(columns[1])).toEqual(
        index.columns.map(({ databaseName }) => databaseName),
      );
      expect(statement.startsWith('CREATE UNIQUE INDEX')).toBe(index.isUnique);
      expect(statement).not.toContain('DEFERRABLE');
      expect(statement.split(' WHERE ')[1]).toBe(index.where);
    }
    expect(up).toContain(`WHERE "lifecycle" <> 'CLOSED'`);
  });

  it('should match all new ORM CHECK expressions to the independently stored DDL', () => {
    for (const check of metadata
      .flatMap((item) => item.checks)
      .filter(({ name }) => name.startsWith('CHK_IM_AT_'))) {
      expect(typeof check.expression).toBe('string');
      expect(
        normalizeAttentionSql(attentionCheckExpression(up, check.name)),
      ).toBe(normalizeAttentionSql(check.expression as string));
    }
  });

  it('should create all tables and candidate keys before FKs, and reverse only owned objects', () => {
    const firstForeignKey = ATTENTION_LEDGER_UP.findIndex((sql) =>
      sql.includes(' FOREIGN KEY '),
    );
    const lastIndex = Math.max(
      ...ATTENTION_LEDGER_UP.map((sql, index) =>
        sql.startsWith('CREATE ') && sql.includes(' INDEX ') ? index : -1,
      ),
    );
    expect(firstForeignKey).toBeGreaterThan(lastIndex);
    expect(
      ATTENTION_LEDGER_UP.filter((sql) => sql.startsWith('CREATE TABLE')),
    ).toHaveLength(5);
    expect(
      ATTENTION_LEDGER_DOWN.filter((sql) => sql.startsWith('DROP TABLE')),
    ).toHaveLength(5);
    expect(down.indexOf('DROP TRIGGER')).toBeLessThan(
      down.indexOf('DROP FUNCTION'),
    );
    expect(down.indexOf('DROP CONSTRAINT "FK_IM_AT_')).toBeLessThan(
      down.indexOf('DROP TABLE'),
    );
    expect(down).not.toMatch(
      /CASCADE|DELETE FROM|\bTRUNCATE\b|DROP COLUMN "pendingAt"|DROP TABLE "core"\."inconnectMessaging(?:Conversation|Message|Configuration|ProviderStatusEvent)"/,
    );
    expect(
      ATTENTION_LEDGER_UP.every(
        (statement) => !/^(INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(statement),
      ),
    ).toBe(true);
    for (const identifier of [
      ...up.matchAll(/(?:CONSTRAINT|INDEX|TRIGGER) "([^"]+)"/g),
    ]) {
      expect(Buffer.byteLength(identifier[1], 'utf8')).toBeLessThanOrEqual(63);
    }
  });

  it('should expose registered source without running either command method', () => {
    expect(
      getRegisteredInstanceCommandMetadata(
        CreateInconnectMessagingAttentionLedgerFastInstanceCommand,
      ),
    ).toEqual({
      version: '2.32.0',
      timestamp: 1792540800000,
      type: 'fast',
    });
    const source = readFileSync(
      'src/database/commands/upgrade-version-command/2-32/2-32-instance-command-fast-1792540800000-create-inconnect-messaging-attention-ledger.ts',
      'utf8',
    );
    expect(source).toContain('for (const statement of ATTENTION_LEDGER_UP)');
    expect(source).toContain('for (const statement of ATTENTION_LEDGER_DOWN)');
    expect(source.match(/await queryRunner.query\(statement\)/g)).toHaveLength(
      2,
    );
    expect(dataSource.isInitialized).toBe(false);
  });

  it('should preserve revisions as text and reject lossy timestamp hydration', () => {
    for (const entityMetadata of metadata) {
      for (const column of entityMetadata.columns.filter(({ propertyName }) =>
        ['bootstrapRevision', 'coveredRevision', 'attentionRevision'].includes(
          propertyName,
        ),
      )) {
        expect(column.type).toBe('text');
        expect(column.transformer).toBeUndefined();
      }
    }
    expect(ATTENTION_EXACT_TIMESTAMP.from(timestamp)).toBe(timestamp);
    expect(ATTENTION_EXACT_TIMESTAMP.to(timestamp)).toBe(timestamp);
    expect(ATTENTION_EXACT_TIMESTAMP.from(null)).toBeNull();
    for (const value of [
      new Date('2026-10-21T12:34:56.123Z'),
      123,
      'infinity',
      '2026-10-21T12:34:56.1234567Z',
    ]) {
      expect(() => ATTENTION_EXACT_TIMESTAMP.from(value)).toThrow(
        'exact PostgreSQL text',
      );
      expect(() => ATTENTION_EXACT_TIMESTAMP.to(value)).toThrow(
        'exact PostgreSQL text',
      );
    }
  });

  it('should hide new tables and columns at the pre-command upgrade cursor', () => {
    for (const entity of [...attentionEntities, ...attentionExistingEntities]) {
      const entityMetadata = dataSource.getMetadata(entity);
      const shape = resolveEntityShapeAtUpgradeCursor({
        entityClass: entity,
        currentTableName: entityMetadata.tableName,
        currentColumns: entityMetadata.columns.map(
          ({ propertyName, databaseName }) => ({ propertyName, databaseName }),
        ),
        isStepApplied: () => false,
      });
      if (attentionEntities.some((item) => item === entity)) {
        expect(shape.isAvailable).toBe(false);
        expect(shape.hiddenPropertyNames.has('workspaceId')).toBe(true);
      } else {
        expect(shape.isAvailable).toBe(true);
        expect([...shape.hiddenPropertyNames].sort()).toEqual(
          entityMetadata.columns
            .filter(({ propertyName }) => propertyName.startsWith('attention'))
            .map(({ propertyName }) => propertyName)
            .sort(),
        );
      }
      const after = resolveEntityShapeAtUpgradeCursor({
        entityClass: entity,
        currentTableName: entityMetadata.tableName,
        currentColumns: entityMetadata.columns.map(
          ({ propertyName, databaseName }) => ({ propertyName, databaseName }),
        ),
        isStepApplied: (step) => step === attentionStepName,
      });
      expect(after.isAvailable).toBe(true);
      expect(after.hiddenPropertyNames.size).toBe(0);
    }

    const { dataSource: exportDataSource, metadata: exportMetadata } =
      buildAttentionMetadata();
    for (const entityMetadata of exportMetadata) {
      const shape = resolveEntityShapeAtUpgradeCursor({
        entityClass: entityMetadata.target as Function,
        currentTableName: entityMetadata.tableName,
        currentColumns: entityMetadata.columns.map(
          ({ propertyName, databaseName }) => ({ propertyName, databaseName }),
        ),
        isStepApplied: () => false,
      });
      entityMetadata.columns = entityMetadata.columns.filter(
        ({ propertyName }) => !shape.hiddenPropertyNames.has(propertyName),
      );
    }
    const exportedTargets = getCoreEntityMetadatasWithWorkspaceId(
      exportDataSource,
    ).map(({ target }) => target);
    for (const entity of attentionEntities) {
      expect(exportedTargets).not.toContain(entity);
    }
    expect(exportDataSource.isInitialized).toBe(false);
  });

  it('should keep ordinary legacy ORM queries free of new columns even without the upgrade adapter', () => {
    for (const entity of attentionExistingEntities) {
      const entityMetadata = dataSource.getMetadata(entity);
      const dormant = entityMetadata.columns.filter(({ propertyName }) =>
        propertyName.startsWith('attention'),
      );
      for (const column of dormant) {
        expect([column.isSelect, column.isInsert, column.isUpdate]).toEqual([
          false,
          false,
          false,
        ]);
        expect(column.default).toBeUndefined();
        expect(entityMetadata.getInsertionReturningColumns()).not.toContain(
          column,
        );
      }
      const select = dataSource.createQueryBuilder(entity, 'legacy').getSql();
      const insert = dataSource
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values({ workspaceId: epoch.workspaceId })
        .getSql();
      expect(select).not.toContain('attention');
      expect(insert).not.toContain('attention');
    }
    expect(up).toContain(
      `"attentionTrackingMode" varchar NOT NULL DEFAULT 'DISABLED'`,
    );
    const module = readFileSync(
      'src/modules/inconnect-messaging/inconnect-messaging.module.ts',
      'utf8',
    );
    expect(module).not.toMatch(/Attention|attention-/);
    const datasource = readFileSync(
      'src/database/typeorm/core/core.datasource.ts',
      'utf8',
    );
    expect(datasource).toContain(
      'modules/inconnect-messaging/**/*.entity{.ts,.js}',
    );
    expect(datasource).toContain('synchronize: false');
    expect(datasource).toContain('migrationsRun: false');
  });
});
