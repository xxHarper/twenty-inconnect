import { APPROVED_COMMANDS } from 'src/database/scripts/inconnect-exact-upgrade/guards';
import {
  type PhysicalSnapshot,
  PHYSICAL_CASES,
  preparePhysicalStep,
  selectPhysicalCommandIdentity,
  validatePhysicalStage,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/step-plan';
import {
  type Constraint,
  type PhysicalIndex,
} from 'src/database/scripts/inconnect-exact-upgrade/schema';

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const constraint = (
  name: string,
  kind: string,
  definition: string,
): Constraint => ({
  name,
  kind,
  definition,
  validated: true,
  deferrable: false,
});
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

// Synthetic catalog observations for pure guards, not PostgreSQL acceptance.
const snapshot = (stage: 0 | 1 | 2): PhysicalSnapshot => ({
  columns: [
    { name: 'workspaceId', type: 'uuid', nullable: false, default: null },
    {
      name: 'anchorObjectMetadataId',
      type: 'uuid',
      nullable: false,
      default: null,
    },
    {
      name: 'revision',
      type: 'bigint',
      nullable: false,
      default: "'0'::bigint",
    },
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
    ...(stage === 0
      ? []
      : [
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
        ]),
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
  ],
  constraints: [
    constraint(
      'CHK_INCONNECT_MSG_CONFIG_REVISION',
      'c',
      'CHECK (revision >= 0)',
    ),
    constraint(
      'FK_INCONNECT_MSG_CONFIG_ANCHOR',
      'f',
      'FOREIGN KEY ("anchorObjectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT',
    ),
    constraint(
      'FK_INCONNECT_MSG_CONFIG_WORKSPACE',
      'f',
      'FOREIGN KEY ("workspaceId") REFERENCES core.workspace(id) ON DELETE CASCADE',
    ),
    constraint('PK_INCONNECT_MSG_CONFIG', 'p', 'PRIMARY KEY ("workspaceId")'),
    ...(stage === 0
      ? []
      : [
          constraint(
            'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_TUPLE',
            'c',
            'CHECK ((autoCreateEnabled = false AND autoCreateAnchorObjectMetadataId IS NULL AND autoCreateOwnerStrategy IS NULL AND autoCreateOwnerRoleId IS NULL AND autoCreateLabelPolicy IS NULL) OR (autoCreateAnchorObjectMetadataId IS NOT NULL AND autoCreateOwnerStrategy IS NOT NULL AND autoCreateOwnerRoleId IS NOT NULL AND autoCreateLabelPolicy IS NOT NULL))',
          ),
          constraint(
            'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_LABEL_POLICY',
            'c',
            "CHECK (autoCreateLabelPolicy IS NULL OR autoCreateLabelPolicy = 'OMIT')",
          ),
          constraint(
            'CHK_INCONNECT_MSG_CONFIG_AUTO_CREATE_OWNER_STRATEGY',
            'c',
            "CHECK (autoCreateOwnerStrategy IS NULL OR autoCreateOwnerStrategy = 'UNIQUE_ACTIVE_MEMBER_OF_ROLE')",
          ),
          constraint(
            'FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ANCHOR',
            'f',
            'FOREIGN KEY ("autoCreateAnchorObjectMetadataId", "workspaceId") REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT',
          ),
          constraint(
            'FK_INCONNECT_MSG_CONFIG_AUTO_CREATE_ROLE',
            'f',
            'FOREIGN KEY ("autoCreateOwnerRoleId", "workspaceId") REFERENCES core.role(id, "workspaceId") ON DELETE RESTRICT',
          ),
        ]),
    ...(stage === 2
      ? [
          constraint(
            'FK_INCONNECT_MSG_CONFIG_AUTOMATION_USER_WORKSPACE',
            'f',
            'FOREIGN KEY ("automationUserWorkspaceId") REFERENCES core."userWorkspace"(id) ON DELETE RESTRICT',
          ),
        ]
      : []),
  ],
  indexes: [
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
    index('objectMetadata', 'object-key', ['id', 'workspaceId']),
    index('role', 'role-key', ['id', 'workspaceId']),
    index('userWorkspace', 'user-workspace-key', ['id'], true),
  ],
  tracking: APPROVED_COMMANDS.slice(0, stage).flatMap((name) =>
    [null, WORKSPACE_ID].map((workspaceId) => ({
      name,
      workspaceId,
      status: 'completed',
      attempt: 1,
      isInitial: false,
    })),
  ),
  provisionedWorkspaceIds: [WORKSPACE_ID],
  disabledConfiguration: true,
});

describe('exact one-command ordering with physical catalog evidence', () => {
  it('should require PRE-5698, then POST-5698 before permitting a 5700 plan', () => {
    expect(preparePhysicalStep(APPROVED_COMMANDS[0], snapshot(0))).toEqual({
      command: APPROVED_COMMANDS[0],
      beforeStage: 0,
      afterStage: 1,
    });
    expect(() =>
      preparePhysicalStep(APPROVED_COMMANDS[1], snapshot(0)),
    ).toThrow();
    validatePhysicalStage(1, snapshot(1));
    expect(preparePhysicalStep(APPROVED_COMMANDS[1], snapshot(1))).toEqual({
      command: APPROVED_COMMANDS[1],
      beforeStage: 1,
      afterStage: 2,
    });
    validatePhysicalStage(2, snapshot(2));
    expect(() =>
      preparePhysicalStep(APPROVED_COMMANDS[0], snapshot(1)),
    ).toThrow();
  });
  it.each(
    [
      '5698',
      '*',
      '',
      'unrelated',
      APPROVED_COMMANDS.join(','),
      [...APPROVED_COMMANDS],
    ].map((command) => ({ command })),
  )('should reject arbitrary selection %j', ({ command }) => {
    expect(() => selectPhysicalCommandIdentity(command)).toThrow();
  });
  it.each([
    { tracking: [] },
    {
      tracking: [
        {
          name: APPROVED_COMMANDS[0],
          workspaceId: null,
          status: 'failed',
          attempt: 1,
          isInitial: false,
        },
      ],
    },
    { provisionedWorkspaceIds: [WORKSPACE_ID, WORKSPACE_ID] },
    { disabledConfiguration: false },
    { columns: snapshot(1).columns.slice(0, -1) },
    { constraints: snapshot(1).constraints.slice(0, -1) },
    { indexes: [] },
  ])('should reject incomplete POST-5698 evidence %j', (patch) => {
    expect(() =>
      preparePhysicalStep(APPROVED_COMMANDS[1], { ...snapshot(1), ...patch }),
    ).toThrow();
  });
  it('should reject duplicate, unrelated or fabricated initial success tracking', () => {
    const state = snapshot(1);
    const rows = state.tracking as Array<Record<string, unknown>>;
    for (const tracking of [
      [...rows, rows[0]],
      rows.map((row) => ({ ...row, name: 'unrelated' })),
      rows.map((row) => ({ ...row, isInitial: true })),
    ]) {
      expect(() => validatePhysicalStage(1, { ...state, tracking })).toThrow();
    }
  });
  it('should retain every planned PG1 case without executing a case', () => {
    expect(PHYSICAL_CASES.map(([id]) => id).join('')).toBe(
      'ABCDEFGHIJKLMNOPQRS',
    );
  });
});
