import {
  INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS,
  resolveInconnectMessagingOutboundStateTransition,
  type InconnectMessagingStateTransitionTrigger,
} from 'src/modules/inconnect-messaging/state-machine/outbound-message-state-machine';
import {
  INCONNECT_MESSAGING_OUTBOUND_STATES,
  type InconnectMessagingOutboundState,
} from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

const TRANSITION_TRIGGERS: InconnectMessagingStateTransitionTrigger[] = [
  'DISPATCH_STARTED',
  'SAFE_RETRY_PRE_SUBMIT',
  'PROVIDER_CALLBACK',
];

describe('INCONNECT Messaging outbound message state machine', () => {
  it.each(INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS)(
    'applies $from -> $to for $trigger',
    ({ from, to, trigger }) => {
      expect(
        resolveInconnectMessagingOutboundStateTransition({
          currentState: from,
          targetState: to,
          trigger,
        }),
      ).toEqual({ kind: 'APPLIED', state: to });
    },
  );

  it('rejects every non-authorized non-callback transition', () => {
    const invalidTransitions = INCONNECT_MESSAGING_OUTBOUND_STATES.flatMap(
      (currentState) =>
        INCONNECT_MESSAGING_OUTBOUND_STATES.flatMap((targetState) =>
          TRANSITION_TRIGGERS.filter(
            (trigger) =>
              trigger !== 'PROVIDER_CALLBACK' &&
              currentState !== targetState &&
              !INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS.some(
                (transition) =>
                  transition.from === currentState &&
                  transition.to === targetState &&
                  transition.trigger === trigger,
              ),
          ).map((trigger) => ({ currentState, targetState, trigger })),
        ),
    );

    for (const transition of invalidTransitions) {
      expect(
        resolveInconnectMessagingOutboundStateTransition(transition).kind,
      ).toBe('REJECTED');
    }
  });

  it('never applies a transition absent from the authoritative table', () => {
    for (const currentState of INCONNECT_MESSAGING_OUTBOUND_STATES) {
      for (const targetState of INCONNECT_MESSAGING_OUTBOUND_STATES) {
        for (const trigger of TRANSITION_TRIGGERS) {
          const isDeclared =
            INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS.some(
              (transition) =>
                transition.from === currentState &&
                transition.to === targetState &&
                transition.trigger === trigger,
            );
          const result = resolveInconnectMessagingOutboundStateTransition({
            currentState,
            targetState,
            trigger,
          });

          expect(result.kind === 'APPLIED').toBe(isDeclared);
        }
      }
    }
  });

  it.each(INCONNECT_MESSAGING_OUTBOUND_STATES)(
    'ignores a duplicate %s callback',
    (state) => {
      expect(
        resolveInconnectMessagingOutboundStateTransition({
          currentState: state,
          targetState: state,
          trigger: 'PROVIDER_CALLBACK',
        }),
      ).toEqual({ kind: 'IGNORED', reason: 'DUPLICATE', state });
    },
  );

  it.each([
    ['DELIVERED', 'SENT'],
    ['READ', 'SENT'],
    ['READ', 'DELIVERED'],
    ['SENT', 'UNKNOWN'],
    ['DELIVERED', 'FAILED'],
    ['READ', 'FAILED'],
  ] as [InconnectMessagingOutboundState, InconnectMessagingOutboundState][])(
    'ignores lower or late callback %s -> %s',
    (currentState, targetState) => {
      expect(
        resolveInconnectMessagingOutboundStateTransition({
          currentState,
          targetState,
          trigger: 'PROVIDER_CALLBACK',
        }),
      ).toEqual({
        kind: 'IGNORED',
        reason: 'LOWER_PROGRESS_CALLBACK',
        state: currentState,
      });
    },
  );

  it.each(['SENT', 'DELIVERED', 'READ', 'FAILED'] as const)(
    'resolves UNKNOWN to %s',
    (targetState) => {
      expect(
        resolveInconnectMessagingOutboundStateTransition({
          currentState: 'UNKNOWN',
          targetState,
          trigger: 'PROVIDER_CALLBACK',
        }),
      ).toEqual({ kind: 'APPLIED', state: targetState });
    },
  );

  it.each([
    ['FAILED', 'SENT'],
    ['FAILED', 'QUEUED'],
    ['READ', 'QUEUED'],
  ] as [InconnectMessagingOutboundState, InconnectMessagingOutboundState][])(
    'does not reopen terminal state %s as %s',
    (currentState, targetState) => {
      expect(
        resolveInconnectMessagingOutboundStateTransition({
          currentState,
          targetState,
          trigger: 'DISPATCH_STARTED',
        }),
      ).toEqual({
        kind: 'REJECTED',
        reason: 'TERMINAL_STATE',
        state: currentState,
      });
    },
  );
});
