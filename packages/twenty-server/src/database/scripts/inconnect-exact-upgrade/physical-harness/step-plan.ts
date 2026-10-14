import { z } from 'zod';

import {
  APPROVED_COMMANDS,
  requireCondition,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import {
  type Column,
  type Constraint,
  type PhysicalIndex,
  validateIndexes,
  validateSchema,
} from 'src/database/scripts/inconnect-exact-upgrade/schema';

export const physicalCommandSchema = z.enum(APPROVED_COMMANDS);
export type PhysicalCommand = z.infer<typeof physicalCommandSchema>;

export const selectPhysicalCommandIdentity = (
  input: unknown,
): PhysicalCommand => {
  const parsed = physicalCommandSchema.safeParse(input);
  requireCondition(
    parsed.success,
    'Exactly one approved registered command required',
  );
  if (!parsed.success) throw new Error('Invalid command');
  return parsed.data;
};

const trackingSchema = z.array(
  z.strictObject({
    name: physicalCommandSchema,
    status: z.enum(['completed', 'failed']),
    attempt: z.number().int().positive(),
    workspaceId: z.string().uuid().nullable(),
    isInitial: z.literal(false),
  }),
);

export type PhysicalSnapshot = {
  columns: Column[];
  constraints: Constraint[];
  indexes: PhysicalIndex[];
  tracking: unknown;
  provisionedWorkspaceIds: string[];
  disabledConfiguration: boolean;
};

// The inspector must obtain this state from PostgreSQL after independently
// verifying its read session. A JSON receipt alone is never write authority.
export const validatePhysicalStage = (
  stage: 0 | 1 | 2,
  snapshot: PhysicalSnapshot,
): void => {
  requireCondition([0, 1, 2].includes(stage), 'Unknown physical schema stage');
  const parsed = trackingSchema.safeParse(snapshot.tracking);
  requireCondition(parsed.success, 'Unexpected or unrelated tracking rows');
  if (!parsed.success) throw new Error('Invalid tracking');
  const workspaceIds = z
    .array(z.string().uuid())
    .parse(snapshot.provisionedWorkspaceIds);
  requireCondition(
    new Set(workspaceIds).size === workspaceIds.length &&
      validateSchema(snapshot.columns, snapshot.constraints, stage) &&
      validateIndexes(snapshot.indexes) &&
      snapshot.disabledConfiguration,
    'Physical PRE/POST schema, indexes, defaults or workspace identity mismatch',
  );
  const expectedNames = APPROVED_COMMANDS.slice(0, stage);
  requireCondition(
    parsed.data.length === expectedNames.length * (workspaceIds.length + 1) &&
      expectedNames.every((name) =>
        [null, ...workspaceIds].every(
          (workspaceId) =>
            parsed.data.filter(
              (row) =>
                row.name === name &&
                row.workspaceId === workspaceId &&
                row.status === 'completed' &&
                row.attempt === 1,
            ).length === 1,
        ),
      ),
    'Exact completed instance/workspace tracking required before advancing',
  );
};

export const preparePhysicalStep = (
  command: unknown,
  snapshot: PhysicalSnapshot,
): { command: PhysicalCommand; beforeStage: 0 | 1; afterStage: 1 | 2 } => {
  const identity = selectPhysicalCommandIdentity(command);
  const beforeStage = identity === APPROVED_COMMANDS[0] ? 0 : 1;
  validatePhysicalStage(beforeStage, snapshot);
  return {
    command: identity,
    beforeStage,
    afterStage: beforeStage === 0 ? 1 : 2,
  };
};

export const PHYSICAL_CASES = Object.freeze([
  ['A', '5698 real DDL and COMPLETED tracking'],
  ['B', 'POST-5698 columns, checks and workspace-isolated FKs'],
  ['C', '5700 real DDL and COMPLETED tracking'],
  ['D', 'POST-5700 nullable column and restrictive FK'],
  ['E', 'One registered command per invocation'],
  ['F', 'Injected failure before COMMIT rolls back DDL'],
  ['G', 'No successful tracking after rollback'],
  ['H', 'Verified B writes FAILED only after acknowledged rollback'],
  ['I', 'One-slot pool releases A before B acquisition/reuse'],
  ['J', 'Identity mismatch stops before writes'],
  ['K', 'Connection loss/replacement fails closed'],
  ['L', 'B acquisition times out within bounded pool timeout'],
  ['M', 'Cleanup failures preserve original errors'],
  ['N', 'Ambiguous COMMIT remains UNKNOWN without FAILED tracking'],
  ['O', 'Instance and provisioned-workspace tracking parity'],
  ['P', 'No unrelated migrations or commands'],
  ['Q', 'No implicit CREATE EXTENSION at initialization'],
  ['R', 'Default TCP and socket connectivity excluded by OS isolation'],
  ['S', 'No mutations outside the disposable cluster'],
] as const);
