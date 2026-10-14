import {
  PHYSICAL_CASES,
  selectPhysicalCommandIdentity,
} from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/step-plan';
import { requirePhysicalExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/physical-harness/isolation';

// Preview is static, including when hostile application configuration is set.
// No evidence files, dotenv, process probing, DB or Redis calls are made here.
export const previewPhysicalHarness = (arguments_: readonly string[]) => {
  if (arguments_.includes('--execute')) requirePhysicalExecutionSafety();
  if (
    arguments_.length !== 3 ||
    arguments_[0] !== '--preview' ||
    arguments_[1] !== '--command'
  ) {
    throw new Error(
      'Only --preview --command <exact registered identity> is supported in PG0',
    );
  }
  return {
    phase: 'PG0',
    physicalExecution: 'BLOCKED',
    command: selectPhysicalCommandIdentity(arguments_[2]),
    databaseCalls: 0,
    redisCalls: 0,
    cases: PHYSICAL_CASES,
  } as const;
};
