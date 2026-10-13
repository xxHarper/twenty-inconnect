import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';

export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};
export type Constraint = {
  name: string;
  kind: string;
  definition: string;
  validated: boolean;
  deferrable: boolean;
};
export type PhysicalIndex = {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
  valid: boolean;
  ready: boolean;
  primary: boolean;
  immediate: boolean;
  expression: boolean;
  partial: boolean;
  includes: boolean;
};

export const validateIndexes = (indexes: PhysicalIndex[]): boolean => {
  const usable = (index: PhysicalIndex): boolean =>
    index.unique &&
    index.valid &&
    index.ready &&
    index.immediate &&
    !index.expression &&
    !index.partial &&
    !index.includes;
  const configuration = indexes.filter(
    ({ table }) => table === 'inconnectMessagingConfiguration',
  );

  if (configuration.length !== 2 || !configuration.every(usable)) return false;
  if (
    !configuration.some(
      (index) =>
        index.name === 'PK_INCONNECT_MSG_CONFIG' &&
        index.primary &&
        JSON.stringify(index.columns) === JSON.stringify(['workspaceId']),
    )
  )
    return false;
  if (
    !configuration.some(
      (index) =>
        index.name === 'IDX_INCONNECT_MSG_CONFIG_WORKSPACE_ANCHOR_UNIQUE' &&
        !index.primary &&
        JSON.stringify(index.columns) ===
          JSON.stringify(['workspaceId', 'anchorObjectMetadataId']),
    )
  )
    return false;
  return (
    ['objectMetadata', 'role'].every((table) =>
      indexes.some(
        (index) =>
          index.table === table &&
          usable(index) &&
          JSON.stringify(index.columns) ===
            JSON.stringify(['id', 'workspaceId']),
      ),
    ) &&
    indexes.some(
      (index) =>
        index.table === 'userWorkspace' &&
        index.primary &&
        usable(index) &&
        JSON.stringify(index.columns) === JSON.stringify(['id']),
    )
  );
};

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
const autoColumns: Column[] = [
  {
    name: 'autoCreateEnabled',
    type: 'boolean',
    nullable: false,
    default: 'false',
  },
  ...[
    'autoCreateAnchorObjectMetadataId',
    'autoCreateOwnerStrategy',
    'autoCreateOwnerRoleId',
    'autoCreateLabelPolicy',
  ].map((name) => ({
    name,
    type: name.endsWith('Id') ? 'uuid' : 'character varying',
    nullable: true,
    default: null,
  })),
];
const baseConstraints = {
  CHK_INCONNECT_MSG_CONFIG_REVISION: 'CHECK (revision >= 0)',
  FK_INCONNECT_MSG_CONFIG_ANCHOR:
    'FOREIGN KEY ("anchorObjectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT',
  FK_INCONNECT_MSG_CONFIG_WORKSPACE:
    'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id) ON DELETE CASCADE',
  PK_INCONNECT_MSG_CONFIG: 'PRIMARY KEY ("workspaceId")',
};
const autoConstraints = {
  CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_TUPLE: `CHECK ((autoCreateEnabled = false AND autoCreateAnchorObjectMetadataId IS NULL AND autoCreateOwnerStrategy IS NULL AND autoCreateOwnerRoleId IS NULL AND autoCreateLabelPolicy IS NULL) OR (autoCreateAnchorObjectMetadataId IS NOT NULL AND autoCreateOwnerStrategy IS NOT NULL AND autoCreateOwnerRoleId IS NOT NULL AND autoCreateLabelPolicy IS NOT NULL))`,
  CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_LABEL_POLICY:
    "CHECK (autoCreateLabelPolicy IS NULL OR autoCreateLabelPolicy = 'OMIT')",
  CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_OWNER_STRATEGY:
    "CHECK (autoCreateOwnerStrategy IS NULL OR autoCreateOwnerStrategy = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE')",
  FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ANCHOR:
    'FOREIGN KEY ("autoCreateAnchorObjectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT',
  FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ROLE:
    'FOREIGN KEY ("autoCreateOwnerRoleId", "workspaceId") REFERENCES core.role(id, "workspaceId") ON DELETE RESTRICT',
};

// Parse the small CHECK grammar to retain AND/OR grouping despite PostgreSQL's
// extra parentheses and text casts. Unknown tokens fail closed.
export const canonicalCheck = (definition: string): string => {
  const input = definition.replace(/^CHECK\s*/i, '').replace(/::text/g, '');
  const tokens =
    input.match(
      /"[A-Za-z][A-Za-z0-9]*"|'[A-Z_]+'|[A-Za-z][A-Za-z0-9]*|>=|=|0|\(|\)/g,
    ) ?? [];

  requireCondition(
    tokens.join('') === input.replace(/\s/g, ''),
    'Unsupported CHECK expression',
  );
  let cursor = 0;
  const parseAtom = (): unknown => {
    if (tokens[cursor] === '(') {
      cursor++;
      const value = parseOr();
      requireCondition(tokens[cursor++] === ')', 'Invalid CHECK grouping');
      return value;
    }
    const value = tokens[cursor++];

    requireCondition(
      Boolean(value) && !['AND', 'OR', ')'].includes(value),
      'Invalid CHECK atom',
    );
    return value.replace(/"/g, '');
  };
  const parseComparison = (): unknown => {
    const left = parseAtom();
    const operation = tokens[cursor];

    if (operation === '=' || operation === '>=') {
      cursor++;
      return [operation, left, parseAtom()];
    }
    if (operation === 'IS') {
      cursor++;
      const negate = tokens[cursor] === 'NOT';
      if (negate) cursor++;
      requireCondition(tokens[cursor++] === 'NULL', 'Invalid null predicate');
      return [negate ? 'IS NOT NULL' : 'IS NULL', left];
    }
    return left;
  };
  const parseAnd = (): unknown => {
    let value = parseComparison();
    while (tokens[cursor] === 'AND') {
      cursor++;
      value = ['AND', value, parseComparison()];
    }
    return value;
  };
  const parseOr = (): unknown => {
    let value = parseAnd();
    while (tokens[cursor] === 'OR') {
      cursor++;
      value = ['OR', value, parseAnd()];
    }
    return value;
  };
  const result = parseOr();

  requireCondition(cursor === tokens.length, 'Trailing CHECK tokens');
  return JSON.stringify(result);
};

export const validateSchema = (
  columns: Column[],
  constraints: Constraint[],
  stage: 0 | 1 | 2,
): boolean => {
  const expectedColumns = [
    ...baseColumns,
    ...(stage > 0 ? autoColumns : []),
    ...(stage === 2
      ? [
          {
            name: 'automationUserWorkspaceId',
            type: 'uuid',
            nullable: true,
            default: null,
          },
        ]
      : []),
  ];
  const expectedConstraints: Record<string, string> = {
    ...baseConstraints,
    ...(stage > 0 ? autoConstraints : {}),
    ...(stage === 2
      ? {
          FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE:
            'FOREIGN KEY ("automationUserWorkspaceId") REFERENCES core."userWorkspace"(id) ON DELETE RESTRICT',
        }
      : {}),
  };
  if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) return false;
  // PG18 NOT NULL constraints are covered by the complete column comparison.
  const structural = constraints.filter(({ kind }) => kind !== 'n');

  if (structural.length !== Object.keys(expectedConstraints).length)
    return false;
  if (new Set(structural.map(({ name }) => name)).size !== structural.length)
    return false;
  return structural.every(
    ({ name, kind, definition, validated, deferrable }) => {
      const expected = expectedConstraints[name];

      if (!expected || !validated || deferrable) return false;
      return kind === 'c'
        ? canonicalCheck(definition) === canonicalCheck(expected)
        : definition === expected;
    },
  );
};
