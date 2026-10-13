import { requireCondition } from 'src/database/scripts/inconnect-exact-upgrade/guards';

// No caller-provided flag, manifest or process observation can satisfy this gate.
// Remove it only after physical acceptance of the core API and independently
// enforced maintenance/restore contracts described in the guide.
export const requireExecutionSafety = (): void => {
  requireCondition(
    false,
    'Execution BLOCKED: physical writer/failure-tracking acceptance, maintenance isolation and independent restore review are UNKNOWN',
  );
};

export const requireIndependentRestoreReview = (): void => {
  requireCondition(
    false,
    'Independent restore provenance/review is UNKNOWN; a manifest and restore log cannot authorize execution',
  );
};
