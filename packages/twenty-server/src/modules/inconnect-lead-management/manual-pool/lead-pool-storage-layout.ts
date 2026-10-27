import { z } from 'zod';

const layoutSchema = z.object({
  schema: z.literal('core'),
  table: z.literal('inconnectLeadPoolOperation'),
  kind: z.literal('r'),
  rowSecurity: z.literal(false),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      notNull: z.boolean(),
      defaultExpression: z.string().nullable(),
      generated: z.string(),
      identity: z.string(),
    }),
  ),
  constraints: z.array(
    z.object({
      kind: z.string(),
      columns: z.array(z.string()),
      deferrable: z.boolean(),
      validated: z.boolean(),
      indexValid: z.boolean().nullable(),
      definition: z.string(),
    }),
  ),
});

// No version marker exists in the proposed installation. Verify the structure
// actually used by INSERT, UPDATE, identity lookup and timestamp audit instead.
export const isLeadPoolStorageLayoutReady = (raw: unknown): boolean => {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return false;
  const { columns, constraints } = parsed.data;
  const required = {
    id: 'uuid',
    workspaceId: 'uuid',
    actorUserId: 'uuid',
    actorWorkspaceMemberId: 'uuid',
    intentionId: 'uuid',
    requestHash: 'text',
    state: 'jsonb',
    createdAt: 'timestamptz',
    updatedAt: 'timestamptz',
  };
  for (const [name, type] of Object.entries(required)) {
    const matches = columns.filter((column) => column.name === name);
    if (matches.length !== 1) return false;
    const column = matches[0];
    if (
      column.type !== type ||
      !column.notNull ||
      column.generated ||
      column.identity
    )
      return false;
    if (
      (name === 'createdAt' || name === 'updatedAt') &&
      column.defaultExpression !== 'now()'
    )
      return false;
  }
  if (
    columns.some(
      (column) =>
        !(column.name in required) &&
        column.notNull &&
        column.defaultExpression === null &&
        !column.generated &&
        !column.identity,
    )
  )
    return false;
  const expectedConstraints: {
    kind: string;
    columns: string[];
    definition?: string;
  }[] = [
    { kind: 'p', columns: ['id'] },
    { kind: 'u', columns: ['workspaceId', 'actorUserId', 'intentionId'] },
    {
      kind: 'c',
      columns: ['requestHash'],
      definition: 'CHECKlengthrequestHash=64',
    },
    {
      kind: 'c',
      columns: ['state'],
      definition: "CHECKjsonb_typeofstate='object'::text",
    },
    {
      kind: 'f',
      columns: ['workspaceId'],
      definition:
        'FOREIGNKEYworkspaceIdREFERENCEScore.workspaceidONDELETERESTRICT',
    },
    {
      kind: 'f',
      columns: ['actorUserId'],
      definition: 'FOREIGNKEYactorUserIdREFERENCEScore.useridONDELETERESTRICT',
    },
  ];
  const matches = (
    constraint: (typeof constraints)[number],
    expected: (typeof expectedConstraints)[number],
  ) => {
    if (
      constraint.kind !== expected.kind ||
      constraint.deferrable ||
      !constraint.validated ||
      JSON.stringify(constraint.columns) !== JSON.stringify(expected.columns)
    )
      return false;
    if (expected.kind === 'p' || expected.kind === 'u')
      return constraint.indexValid === true;
    // Preserve SQL literal contents: 'o bject' must never normalize to 'object'.
    const definition = constraint.definition.replace(
      /'(?:[^']|'')*'|[\s"()]/g,
      (token) => (token.startsWith("'") ? token : ''),
    );
    return definition === expected.definition;
  };
  // This table has a closed constraint contract. Additional recognized duplicates
  // are harmless; any unknown restriction may reject a legitimate operation.
  // Ordinary auxiliary indexes are not constraints and do not enter this list.
  return (
    expectedConstraints.every((expected) =>
      constraints.some((constraint) => matches(constraint, expected)),
    ) &&
    constraints.every((constraint) =>
      expectedConstraints.some((expected) => matches(constraint, expected)),
    )
  );
};
