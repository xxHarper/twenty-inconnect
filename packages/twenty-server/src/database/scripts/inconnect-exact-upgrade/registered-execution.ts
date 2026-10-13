import { requireExecutionSafety } from 'src/database/scripts/inconnect-exact-upgrade/execution-safety';
import {
  type Request,
  type Snapshot,
} from 'src/database/scripts/inconnect-exact-upgrade/guards';
import { type InstanceCommandRunnerService } from 'src/engine/core-modules/upgrade/services/instance-command-runner.service';

// The opt-in core writer contract is implemented but has only unit evidence.
// Maintenance isolation, independent restore review and physical acceptance
// still block preparation of pools, Redis clients, metadata or services.
export const executeRegistered = async (
  _request: Request,
  _environment: Record<string, string | undefined>,
  _snapshot: Snapshot,
  _recheck: (ownBackendPid: number) => Promise<void>,
): Promise<
  Awaited<ReturnType<InstanceCommandRunnerService['runFastInstanceCommand']>>
> => {
  requireExecutionSafety();
  throw new Error('No verified execution adapter exists');
};
