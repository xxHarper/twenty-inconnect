import {
  VoiceSoftphoneView,
  type VoiceStatusTone,
} from '@/inconnect-voice/components/VoiceSoftphoneView';
import { type VoiceLeadTarget } from '@/inconnect-voice/contexts/VoiceCallContext';
import { type useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import { useVoiceResultLabel } from '@/inconnect-voice/hooks/useVoiceResultLabel';
import {
  type VoiceLeadDetails,
  useVoiceLeadDetails,
} from '@/inconnect-voice/hooks/useVoiceLeadDetails';
import { objectMetadataItemFamilySelector } from '@/object-metadata/states/objectMetadataItemFamilySelector';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { useLingui } from '@lingui/react/macro';
import { type ReactNode, useLayoutEffect } from 'react';

export type VoiceSoftphonePanelProps = {
  voice: ReturnType<typeof useLeadVoiceCall>;
  minimized: boolean;
  onToggleMinimized: () => void;
  onClose: () => void;
};

type VoiceSoftphoneProps = VoiceSoftphonePanelProps & {
  target: VoiceLeadTarget;
};

type VoiceSoftphoneControlsProps = {
  panel: VoiceSoftphonePanelProps;
  details?: VoiceLeadDetails;
  recordId?: string;
  manual?: {
    identity: { name: string | null; number: string } | null;
    idleContent?: ReactNode;
    onReturnToDialer?: () => void;
  };
};

export const VoiceSoftphoneControls = ({
  panel,
  details,
  recordId,
  manual,
}: VoiceSoftphoneControlsProps) => {
  const { voice, minimized, onToggleMinimized, onClose } = panel;
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const { availability, snapshot, hangUp, toggleMute, placeCall } = voice;
  const { state, busy, canMute, muted, endedAt, failure, destination } =
    snapshot;
  const voiceLabels = useVoiceResultLabel();
  const evidence = state === 'unauthorized' ? null : voice.providerProgress;
  const provider = evidence?.progress;
  const connectedAt = evidence?.connectedAt ?? null;
  const availabilityLabels = {
    loading: t`Checking Voice availability…`,
    ready: manual ? t`Outbound Voice is ready.` : t`Available`,
    disabled: t`Outbound Voice is disabled.`,
    'not-configured': t`Twilio Voice is not configured.`,
    unavailable: t`Voice availability could not be verified for this session.`,
  };
  const callLabels = {
    idle: availabilityLabels[availability],
    'checking-microphone': t`Checking microphone access. Allow access if asked.`,
    'loading-sdk': t`Loading the Voice SDK…`,
    preparing: t`Authorizing call…`,
    connecting: t`Connecting to Twilio…`,
    ringing: t`Waiting for destination…`,
    active: t`Browser connected to Twilio`,
    reconnecting: t`Reconnecting…`,
    ending: t`Ending call…`,
    disconnected: t`Call ended`,
    'microphone-unavailable': t`Microphone access is unavailable in this browser.`,
    'microphone-denied': t`Microphone access was denied.`,
    'microphone-missing': t`No microphone is available.`,
    'microphone-failed': t`The microphone could not be opened.`,
    expired: t`The Voice session expired. Start a new call to get a new session.`,
    unauthorized: manual
      ? t`Voice authorization could not be verified for this call.`
      : t`Voice authorization could not be verified for this lead.`,
    'destination-changed': t`The authorized phone number changed. Reopen the softphone to review it.`,
    conflict: t`Another call is active or pending confirmation. Try again after it ends.`,
    timeout: t`Voice did not respond in time. The attempt was stopped.`,
    error: t`Voice could not complete the call.`,
  };
  const detailLabels = {
    loading: t`Loading lead phone…`,
    'unreadable-phone': t`A readable Phone field is unavailable for this lead.`,
    unavailable: t`The lead could not be read. Close and reopen the softphone to try again.`,
    missing: t`Add a primary phone number to this lead.`,
    invalid: t`The primary phone number is invalid. Check the number and country code.`,
  };
  const failureStages = {
    microphone: t`Microphone access`,
    sdk: t`Voice SDK setup`,
    session: t`Authorization and Voice session`,
    connection: t`Twilio connection`,
  };
  const failureStage = failure && failureStages[failure.stage];
  const failureCode = failure?.code;
  const authorizedDetails =
    availability === 'ready' &&
    state !== 'unauthorized' &&
    state !== 'destination-changed' &&
    details?.status === 'valid' &&
    (!destination || details.number === destination)
      ? details
      : null;
  const manualIdentity =
    state === 'unauthorized' || state === 'destination-changed'
      ? null
      : manual?.identity;
  const canSendDigit =
    voice.canSendDigit && Boolean(authorizedDetails || manualIdentity);
  const providerStatus =
    provider?.status === 'finished' && provider.result
      ? voiceLabels[
          provider.result === 'answered' ? 'completed' : provider.result
        ]
      : busy && provider?.status === 'answered'
        ? voiceLabels.answered
        : busy && provider?.status === 'ringing'
          ? voiceLabels.ringing
          : busy && provider?.status === 'connecting'
            ? voiceLabels.connecting
            : !busy && voice.hasProviderAttempt
              ? voiceLabels.pending
              : null;
  const status =
    availability !== 'ready' && !busy
      ? availabilityLabels[availability]
      : state === 'ending' ||
          state === 'reconnecting' ||
          state === 'unauthorized'
        ? callLabels[state]
        : (providerStatus ?? callLabels[state]);
  const providerEndedAt =
    provider?.endedAt && connectedAt !== null && provider.answeredAt
      ? connectedAt +
        Math.max(
          0,
          Date.parse(provider.endedAt) - Date.parse(provider.answeredAt),
        )
      : endedAt;

  const tone: VoiceStatusTone =
    state === 'reconnecting'
      ? 'warning'
      : state === 'unauthorized' ||
          (!busy &&
            (availability === 'unavailable' ||
              availability === 'not-configured')) ||
          (availability === 'ready' &&
            (failure || provider?.result === 'failed'))
        ? 'danger'
        : state === 'ending'
          ? 'neutral'
          : busy && provider?.status === 'answered'
            ? 'connected'
            : busy && (provider?.status === 'ringing' || state === 'ringing')
              ? 'waiting'
              : 'neutral';
  const hasTimer = connectedAt !== null || provider?.durationSeconds != null;

  return (
    <VoiceSoftphoneView
      minimized={minimized}
      mobile={isMobile}
      busy={busy}
      ending={state === 'ending'}
      muted={muted}
      canMute={canMute}
      canSendDigit={canSendDigit}
      canSwitchAudio={state === 'active'}
      callId={provider?.id}
      lead={authorizedDetails ?? manualIdentity}
      status={status}
      tone={tone}
      detailHint={
        details && details.status !== 'valid'
          ? {
              text: detailLabels[details.status],
              danger: details.status !== 'loading',
            }
          : undefined
      }
      failureLabel={
        failureStage &&
        (failureCode === undefined
          ? failureStage
          : t`${failureStage} (code ${failureCode})`)
      }
      timer={
        hasTimer
          ? {
              connectedAt,
              endedAt: providerEndedAt,
              durationSeconds: provider?.durationSeconds,
            }
          : undefined
      }
      awaitingConnectedTime={
        (provider?.status === 'answered' || provider?.result === 'answered') &&
        connectedAt === null &&
        provider.durationSeconds === null
      }
      audioSettings={voice.audioSettings}
      onToggleMinimized={onToggleMinimized}
      onClose={onClose}
      onToggleMute={toggleMute}
      onHangUp={hangUp}
      onDial={
        authorizedDetails && recordId
          ? () => void placeCall(recordId, authorizedDetails.number)
          : undefined
      }
      idleContent={manual?.idleContent}
      onReturnToDialer={manual?.onReturnToDialer}
      onDigit={voice.sendDigit}
      onSelectAudioDevice={voice.selectAudioDevice}
      onRequestMicrophoneAccess={voice.requestMicrophoneAccess}
    />
  );
};

type VoiceLeadSoftphoneProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  panel: VoiceSoftphoneProps;
};

const VoiceLeadSoftphone = ({
  objectMetadataItem,
  panel,
}: VoiceLeadSoftphoneProps) => {
  const details = useVoiceLeadDetails(
    objectMetadataItem,
    panel.target.recordId,
  );
  const { snapshot, revokeAuthorization } = panel.voice;
  const lostAccess =
    details.status !== 'loading' &&
    (details.status !== 'valid' ||
      (snapshot.destination !== null &&
        details.number !== snapshot.destination));

  useLayoutEffect(() => {
    if (snapshot.busy && lostAccess) revokeAuthorization();
  }, [lostAccess, revokeAuthorization, snapshot.busy]);

  return (
    <VoiceSoftphoneControls
      panel={panel}
      details={details}
      recordId={panel.target.recordId}
    />
  );
};

export const VoiceSoftphone = (props: VoiceSoftphoneProps) => {
  const { target, voice } = props;
  const objectMetadataItem = useAtomFamilySelectorValue(
    objectMetadataItemFamilySelector,
    {
      objectName: target.objectNameSingular,
      objectNameType: 'singular',
    },
  );
  const metadataAvailable = objectMetadataItem?.id === target.objectMetadataId;
  const { revokeAuthorization } = voice;

  useLayoutEffect(() => {
    if (!metadataAvailable) revokeAuthorization();
  }, [metadataAvailable, revokeAuthorization]);

  if (!metadataAvailable || voice.availability !== 'ready') {
    return (
      <VoiceSoftphoneControls
        panel={props}
        details={!metadataAvailable ? { status: 'unavailable' } : undefined}
      />
    );
  }

  return (
    <VoiceLeadSoftphone panel={props} objectMetadataItem={objectMetadataItem} />
  );
};
