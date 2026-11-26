import { useIsLogged } from '@/auth/hooks/useIsLogged';
import { currentUserState } from '@/auth/states/currentUserState';
import { currentUserWorkspaceState } from '@/auth/states/currentUserWorkspaceState';
import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { isPendingServerSignOutState } from '@/auth/states/isPendingServerSignOutState';
import { VoiceSoftphone } from '@/inconnect-voice/components/VoiceSoftphone';
import { VoiceGlobalSoftphone } from '@/inconnect-voice/components/VoiceGlobalSoftphone';
import {
  VoiceCallContext,
  VoicePhoneContext,
  type VoiceLeadTarget,
} from '@/inconnect-voice/contexts/VoiceCallContext';
import { useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { type PropsWithChildren, useState } from 'react';

type AuthenticatedVoiceCallProviderProps = PropsWithChildren<{
  audioScope: string;
}>;

const AuthenticatedVoiceCallProvider = ({
  audioScope,
  children,
}: AuthenticatedVoiceCallProviderProps) => {
  const [selection, setSelection] = useState<{
    target: VoiceLeadTarget | null;
    revision: number;
  } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const voice = useLeadVoiceCall(selection !== null, audioScope);

  const open = (target: VoiceLeadTarget | null) => {
    setMinimized(false);
    if (!voice.resetCall()) return;
    setSelection((previous) => ({
      target,
      revision: (previous?.revision ?? 0) + 1,
    }));
  };

  const close = () => {
    if (voice.resetCall()) setSelection(null);
  };
  const panel = {
    voice,
    minimized,
    onToggleMinimized: () => setMinimized((previous) => !previous),
    onClose: close,
  };

  return (
    <VoiceCallContext.Provider value={open}>
      <VoicePhoneContext.Provider value={() => open(null)}>
        {children}
      </VoicePhoneContext.Provider>
      {selection?.target && (
        <VoiceSoftphone
          key={selection.revision}
          target={selection.target}
          voice={voice}
          minimized={minimized}
          onToggleMinimized={panel.onToggleMinimized}
          onClose={close}
        />
      )}
      {selection && !selection.target && (
        <VoiceGlobalSoftphone key={selection.revision} panel={panel} />
      )}
    </VoiceCallContext.Provider>
  );
};

type VoiceCallProviderProps = PropsWithChildren;

export const VoiceCallProvider = ({ children }: VoiceCallProviderProps) => {
  const isLogged = useIsLogged();
  const isPendingServerSignOut = useAtomStateValue(isPendingServerSignOutState);
  const currentUser = useAtomStateValue(currentUserState);
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const currentUserWorkspace = useAtomStateValue(currentUserWorkspaceState);

  if (
    !isLogged ||
    isPendingServerSignOut ||
    !currentUser?.id ||
    !currentWorkspace?.id ||
    !currentWorkspaceMember?.id ||
    !currentUserWorkspace ||
    currentUserWorkspace.isImpersonating
  ) {
    return <>{children}</>;
  }

  return (
    <AuthenticatedVoiceCallProvider
      key={`${currentWorkspace.id}:${currentUser.id}:${currentWorkspaceMember.id}`}
      audioScope={`${currentWorkspace.id}:${currentUser.id}`}
    >
      {children}
    </AuthenticatedVoiceCallProvider>
  );
};
