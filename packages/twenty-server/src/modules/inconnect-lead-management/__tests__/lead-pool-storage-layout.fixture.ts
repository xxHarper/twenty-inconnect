export const completeLayout = () => ({
  schema: 'core',
  table: 'inconnectLeadPoolOperation',
  kind: 'r',
  rowSecurity: false,
  columns: [
    'id',
    'workspaceId',
    'actorUserId',
    'actorWorkspaceMemberId',
    'intentionId',
    'requestHash',
    'state',
    'createdAt',
    'updatedAt',
  ].map((name) => ({
    name,
    type:
      name === 'state'
        ? 'jsonb'
        : name === 'requestHash'
          ? 'text'
          : name.endsWith('At')
            ? 'timestamptz'
            : 'uuid',
    notNull: true,
    defaultExpression: name.endsWith('At') ? 'now()' : null,
    generated: '',
    identity: '',
  })),
  constraints: [
    {
      kind: 'p',
      columns: ['id'],
      deferrable: false,
      validated: true,
      indexValid: true,
      definition: 'PRIMARY KEY (id)',
    },
    {
      kind: 'u',
      columns: ['workspaceId', 'actorUserId', 'intentionId'],
      deferrable: false,
      validated: true,
      indexValid: true,
      definition: 'UNIQUE ("workspaceId", "actorUserId", "intentionId")',
    },
    {
      kind: 'c',
      columns: ['requestHash'],
      deferrable: false,
      validated: true,
      indexValid: null,
      definition: 'CHECK ((length("requestHash") = 64))',
    },
    {
      kind: 'c',
      columns: ['state'],
      deferrable: false,
      validated: true,
      indexValid: null,
      definition: "CHECK ((jsonb_typeof(state) = 'object'::text))",
    },
    {
      kind: 'f',
      columns: ['workspaceId'],
      deferrable: false,
      validated: true,
      indexValid: false,
      definition:
        'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id) ON DELETE RESTRICT',
    },
    {
      kind: 'f',
      columns: ['actorUserId'],
      deferrable: false,
      validated: true,
      indexValid: false,
      definition:
        'FOREIGN KEY ("actorUserId") REFERENCES core."user"(id) ON DELETE RESTRICT',
    },
  ],
});
