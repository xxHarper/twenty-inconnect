import {
  initialProbeState,
  parseProbeEvent,
  reduceProbeEvent,
  unverifiedProbeState,
  type ProbeState,
  type ProbeEvent,
} from 'test/development/inconnect-lead-physical/probe-only/probe-lifecycle';
import {
  planProbeOnly,
  type ProbeRequest,
} from 'test/development/inconnect-lead-physical/probe-only/probe-plan';

export type ProbePort = {
  currentBootId: () => Promise<string>;
  record: (entry: {
    request: ProbeRequest;
    state: ProbeState;
    event?: ProbeEvent;
  }) => Promise<void>;
  launch: (plan: ReturnType<typeof planProbeOnly>) => Promise<{
    events: AsyncIterable<unknown>;
    requestCancel: () => Promise<void>;
    confirmAcquisition: () => Promise<void>;
    exit: Promise<{ code: number | null; signal: string | null }>;
  }>;
};

// Test seam with explicit IO; never supplies native defaults or execution grants.
export const runProbeWithPort = async (
  input: unknown,
  inherited: Record<string, string | undefined>,
  port: ProbePort,
  cancellation?: AbortSignal,
): Promise<ProbeState> => {
  const plan = planProbeOnly(input, inherited);
  let state = initialProbeState();
  let cancel: (() => void) | undefined;
  let controlFailed = false;
  let cancellationTask: Promise<void> | undefined;
  try {
    if ((await port.currentBootId()) !== plan.request.bootId)
      throw new Error('Reboot');
    await port.record({ request: plan.request, state });
    if (cancellation?.aborted) throw new Error('Cancelled before launch');
    const child = await port.launch(plan);
    cancel = () => {
      cancellationTask ??= Promise.resolve()
        .then(() => child.requestCancel())
        .catch(() => {
          controlFailed = true;
        });
    };
    cancellation?.addEventListener('abort', cancel, { once: true });
    if (cancellation?.aborted) cancel();
    for await (const inputEvent of child.events) {
      const event = parseProbeEvent(inputEvent);
      if ((await port.currentBootId()) !== plan.request.bootId || controlFailed)
        throw new Error('Evidence continuity lost');
      state = reduceProbeEvent(plan.request, state, event);
      await port.record({ request: plan.request, state, event });
      if (event.kind === 'ACQUIRED') {
        if (!event.before || cancellation?.aborted)
          throw new Error('Acquisition evidence or control unavailable');
        await child.confirmAcquisition();
      }
    }
    const exit = await child.exit;
    await cancellationTask;
    if (
      (await port.currentBootId()) !== plan.request.bootId ||
      exit.signal !== null ||
      exit.code !== 0 ||
      state.phase !== 'CLOSED' ||
      controlFailed
    )
      state = unverifiedProbeState(state);
  } catch {
    state = unverifiedProbeState(state);
  } finally {
    if (cancel) cancellation?.removeEventListener('abort', cancel);
  }
  // Best effort only; missing durable evidence never becomes PASS or cleanup authority.
  try {
    await port.record({ request: plan.request, state });
  } catch {
    state = unverifiedProbeState(state);
  }
  return state;
};
