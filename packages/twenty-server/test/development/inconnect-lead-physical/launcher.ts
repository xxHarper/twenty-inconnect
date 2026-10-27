// Library-only launcher facade: importing it never inspects argv/env or runs a CLI.
export {
  buildServiceCandidates,
  buildSupervisorCandidate,
  inspectLauncherRequest,
  requirePhysicalExecution,
} from 'test/development/inconnect-lead-physical/supervisor';
