import {
  type PhysicalIndex,
  validateIndexes,
  validateSchema,
  type Column,
  type Constraint,
} from 'src/database/scripts/inconnect-exact-upgrade/schema';

const baseColumns: Column[] = [
  { name: 'workspaceId', type: 'uuid', nullable: false, default: null },
  {
    name: 'anchorObjectMetadataId',
    type: 'uuid',
    nullable: false,
    default: null,
  },
  { name: 'revision', type: 'bigint', nullable: false, default: "'0'::bigint" },
  {
    name: 'createdAt',
    type: 'timestamp with time zone',
    nullable: false,
    default: 'now()',
  },
  {
    name: 'updatedAt',
    type: 'timestamp with time zone',
    nullable: false,
    default: 'now()',
  },
  {
    name: 'workStateTrackingBaselineAt',
    type: 'timestamp with time zone',
    nullable: false,
    default: 'CURRENT_TIMESTAMP',
  },
];
const baseConstraints: Constraint[] = [
  {
    name: 'CHK_INCONNECT_MSG_CONFIG_REVISION',
    kind: 'c',
    definition: 'CHECK ((revision >= 0))',
    validated: true,
    deferrable: false,
  },
  {
    name: 'FK_INCONNECT_MSG_CONFIG_ANCHOR',
    kind: 'f',
    definition:
      'FOREIGN KEY ("anchorObjectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT',
    validated: true,
    deferrable: false,
  },
  {
    name: 'FK_INCONNECT_MSG_CONFIG_WORKSPACE',
    kind: 'f',
    definition:
      'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id) ON DELETE CASCADE',
    validated: true,
    deferrable: false,
  },
  {
    name: 'PK_INCONNECT_MSG_CONFIG',
    kind: 'p',
    definition: 'PRIMARY KEY ("workspaceId")',
    validated: true,
    deferrable: false,
  },
];
const index = (
  table: string,
  name: string,
  columns: string[],
  primary = false,
): PhysicalIndex => ({
  table,
  name,
  columns,
  primary,
  unique: true,
  valid: true,
  ready: true,
  immediate: true,
  expression: false,
  partial: false,
  includes: false,
});
const makeIndexes = () => [
  index(
    'inconnectMessagingConfiguration',
    'PK_INCONNECT_MSG_CONFIG',
    ['workspaceId'],
    true,
  ),
  index(
    'inconnectMessagingConfiguration',
    'IDX_INCONNECT_MSG_CONFIG_WORKSPACE_ANCHOR_UNIQUE',
    ['workspaceId', 'anchorObjectMetadataId'],
  ),
  index('objectMetadata', 'composite-object-key', ['id', 'workspaceId']),
  index('role', 'composite-role-key', ['id', 'workspaceId']),
  index('userWorkspace', 'user-workspace-primary', ['id'], true),
];

describe('physical PRE schema and referenced uniqueness guards', () => {
  it('should accept the audited PRE configuration and independent UNIQUE indexes', () => {
    expect(validateSchema(baseColumns, baseConstraints, 0)).toBe(true);
    expect(validateIndexes(makeIndexes())).toBe(true);
  });

  it('should reject a partial upgrade, extra column or changed baseline default', () => {
    expect(
      validateSchema(
        [
          ...baseColumns,
          {
            name: 'autoCreateEnabled',
            type: 'boolean',
            nullable: false,
            default: 'false',
          },
        ],
        baseConstraints,
        0,
      ),
    ).toBe(false);
    expect(validateSchema(baseColumns.slice(0, -1), baseConstraints, 0)).toBe(
      false,
    );
    expect(
      validateSchema(
        baseColumns.map((column) =>
          column.name === 'revision' ? { ...column, default: '1' } : column,
        ),
        baseConstraints,
        0,
      ),
    ).toBe(false);
  });

  it('should reject missing, changed, unvalidated or deferrable constraints', () => {
    expect(validateSchema(baseColumns, baseConstraints.slice(1), 0)).toBe(
      false,
    );
    expect(
      validateSchema(
        baseColumns,
        baseConstraints.map((constraint) => ({
          ...constraint,
          deferrable: true,
        })),
        0,
      ),
    ).toBe(false);
    expect(
      validateSchema(
        baseColumns,
        baseConstraints.map((constraint) => ({
          ...constraint,
          validated: false,
        })),
        0,
      ),
    ).toBe(false);
    expect(
      validateSchema(
        baseColumns,
        baseConstraints.map((constraint) =>
          constraint.kind === 'c'
            ? {
                ...constraint,
                definition: 'CHECK (revision >= 0 OR revision IS NULL)',
              }
            : constraint,
        ),
        0,
      ),
    ).toBe(false);
  });

  it.each(['unique', 'valid', 'ready', 'immediate'] as const)(
    'should reject a reference index whose %s property is false',
    (property) => {
      const indexes = makeIndexes();
      indexes[2][property] = false;
      expect(validateIndexes(indexes)).toBe(false);
    },
  );

  it.each(['partial', 'expression', 'includes'] as const)(
    'should reject a reference index with %s',
    (property) => {
      const indexes = makeIndexes();
      indexes[2][property] = true;
      expect(validateIndexes(indexes)).toBe(false);
    },
  );

  it('should reject an extra configuration index or wrong composite columns', () => {
    expect(
      validateIndexes([
        ...makeIndexes(),
        index('inconnectMessagingConfiguration', 'unexpected', ['workspaceId']),
      ]),
    ).toBe(false);
    const indexes = makeIndexes();
    indexes[3].columns = ['id'];
    expect(validateIndexes(indexes)).toBe(false);
  });
});
