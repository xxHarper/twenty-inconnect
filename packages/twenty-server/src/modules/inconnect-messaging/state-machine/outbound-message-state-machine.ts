import { type InconnectMessagingOutboundState } from 'src/modules/inconnect-messaging/types/inconnect-messaging-domain.type';

export type InconnectMessagingStateTransitionTrigger =
  | 'DISPATCH_STARTED'
  | 'SAFE_RETRY_PRE_SUBMIT'
  | 'PROVIDER_CALLBACK';

export type InconnectMessagingStateTransitionResult =
  | { kind: 'APPLIED'; state: InconnectMessagingOutboundState }
  | {
      kind: 'IGNORED';
      reason: 'DUPLICATE' | 'LOWER_PROGRESS_CALLBACK';
      state: InconnectMessagingOutboundState;
    }
  | {
      kind: 'REJECTED';
      reason: 'INVALID_TRANSITION' | 'TERMINAL_STATE';
      state: InconnectMessagingOutboundState;
    };

type Transition = {
  from: InconnectMessagingOutboundState;
  to: InconnectMessagingOutboundState;
  trigger: InconnectMessagingStateTransitionTrigger;
};

export const INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS: readonly Transition[] =
  [
    { from: 'QUEUED', to: 'SENDING', trigger: 'DISPATCH_STARTED' },
    { from: 'SENDING', to: 'QUEUED', trigger: 'SAFE_RETRY_PRE_SUBMIT' },
    { from: 'SENDING', to: 'SENT', trigger: 'PROVIDER_CALLBACK' },
    { from: 'SENDING', to: 'FAILED', trigger: 'PROVIDER_CALLBACK' },
    { from: 'SENDING', to: 'UNKNOWN', trigger: 'PROVIDER_CALLBACK' },
    { from: 'SENT', to: 'DELIVERED', trigger: 'PROVIDER_CALLBACK' },
    { from: 'SENT', to: 'READ', trigger: 'PROVIDER_CALLBACK' },
    { from: 'DELIVERED', to: 'READ', trigger: 'PROVIDER_CALLBACK' },
    { from: 'UNKNOWN', to: 'SENT', trigger: 'PROVIDER_CALLBACK' },
    { from: 'UNKNOWN', to: 'DELIVERED', trigger: 'PROVIDER_CALLBACK' },
    { from: 'UNKNOWN', to: 'READ', trigger: 'PROVIDER_CALLBACK' },
    { from: 'UNKNOWN', to: 'FAILED', trigger: 'PROVIDER_CALLBACK' },
  ];

const OUTBOUND_PROGRESS: Partial<
  Record<InconnectMessagingOutboundState, number>
> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };

const isLowerProgressProviderCallback = (
  currentState: InconnectMessagingOutboundState,
  targetState: InconnectMessagingOutboundState,
): boolean => {
  const currentProgress = OUTBOUND_PROGRESS[currentState];
  const targetProgress = OUTBOUND_PROGRESS[targetState];

  if (
    ['SENT', 'DELIVERED', 'READ'].includes(currentState) &&
    ['FAILED', 'UNKNOWN'].includes(targetState)
  ) {
    return true;
  }

  return (
    currentProgress !== undefined &&
    targetProgress !== undefined &&
    targetProgress < currentProgress
  );
};

export const resolveInconnectMessagingOutboundStateTransition = ({
  currentState,
  targetState,
  trigger,
}: {
  currentState: InconnectMessagingOutboundState;
  targetState: InconnectMessagingOutboundState;
  trigger: InconnectMessagingStateTransitionTrigger;
}): InconnectMessagingStateTransitionResult => {
  if (currentState === targetState) {
    return { kind: 'IGNORED', reason: 'DUPLICATE', state: currentState };
  }

  if (
    INCONNECT_MESSAGING_VALID_OUTBOUND_TRANSITIONS.some(
      (transition) =>
        transition.from === currentState &&
        transition.to === targetState &&
        transition.trigger === trigger,
    )
  ) {
    return { kind: 'APPLIED', state: targetState };
  }

  if (
    trigger === 'PROVIDER_CALLBACK' &&
    isLowerProgressProviderCallback(currentState, targetState)
  ) {
    return {
      kind: 'IGNORED',
      reason: 'LOWER_PROGRESS_CALLBACK',
      state: currentState,
    };
  }

  if (currentState === 'READ' || currentState === 'FAILED') {
    return { kind: 'REJECTED', reason: 'TERMINAL_STATE', state: currentState };
  }

  return {
    kind: 'REJECTED',
    reason: 'INVALID_TRANSITION',
    state: currentState,
  };
};
