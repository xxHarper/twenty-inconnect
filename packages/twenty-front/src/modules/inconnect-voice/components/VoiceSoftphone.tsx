import { VoiceCallTimer } from '@/inconnect-voice/components/VoiceCallTimer';
import { type VoiceLeadTarget } from '@/inconnect-voice/contexts/VoiceCallContext';
import { type useLeadVoiceCall } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import {
  type VoiceLeadDetails,
  useVoiceLeadDetails,
} from '@/inconnect-voice/hooks/useVoiceLeadDetails';
import { objectMetadataItemFamilySelector } from '@/object-metadata/states/objectMetadataItemFamilySelector';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { InputHint } from '@/ui/input/components/InputHint';
import { RootStackingContextZIndices } from '@/ui/layout/constants/RootStackingContextZIndices';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useLayoutEffect } from 'react';
import {
  IconChevronDown,
  IconChevronUp,
  IconPhone,
  IconX,
} from 'twenty-ui/icon';
import { Button, IconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledPanel = styled.aside`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  bottom: ${themeCssVariables.spacing[4]};
  box-shadow: ${themeCssVariables.boxShadow.strong};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  max-width: calc(100% - 32px);
  padding: ${themeCssVariables.spacing[3]};
  position: fixed;
  right: ${themeCssVariables.spacing[4]};
  width: 320px;
  z-index: ${RootStackingContextZIndices.VoiceSoftphone};

  &[data-minimized='true'] {
    width: fit-content;
  }

  &[data-mobile='true'] {
    bottom: calc(64px + env(safe-area-inset-bottom));
  }

  @media print {
    display: none;
  }
`;

const StyledHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;

const StyledDetails = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  overflow-wrap: anywhere;
`;

const StyledTimer = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-variant-numeric: tabular-nums;
`;

type VoiceSoftphoneProps = {
  voice: ReturnType<typeof useLeadVoiceCall>;
  target: VoiceLeadTarget;
  minimized: boolean;
  onToggleMinimized: () => void;
  onClose: () => void;
};

type VoiceSoftphoneControlsProps = {
  panel: VoiceSoftphoneProps;
  details?: VoiceLeadDetails;
};

const VoiceSoftphoneControls = ({
  panel,
  details,
}: VoiceSoftphoneControlsProps) => {
  const { voice, target, minimized, onToggleMinimized, onClose } = panel;
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const { availability, snapshot, hangUp, toggleMute, placeCall } = voice;
  const {
    state,
    busy,
    canMute,
    muted,
    connectedAt,
    endedAt,
    failure,
    destination,
  } = snapshot;
  const title = t`Softphone`;
  const muteLabel = muted ? t`Unmute` : t`Mute`;
  const hangUpLabel = t`Hang up`;
  const dialLabel = t`Place call`;
  const availabilityLabels = {
    loading: t`Checking Voice availability…`,
    ready: t`Available`,
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
    ringing: t`Ringing…`,
    active: t`Browser connected to Twilio`,
    reconnecting: t`Reconnecting…`,
    ending: t`Ending call…`,
    disconnected: t`Call ended`,
    'microphone-unavailable': t`Microphone access is unavailable in this browser.`,
    'microphone-denied': t`Microphone access was denied.`,
    expired: t`The Voice session expired. Start a new call to get a new session.`,
    unauthorized: t`Voice authorization could not be verified for this lead.`,
    'destination-changed': t`The authorized phone number changed. Reopen the softphone to review it.`,
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
  const status =
    availability !== 'ready' && !busy
      ? availabilityLabels[availability]
      : callLabels[state];

  return (
    <StyledPanel
      aria-label={title}
      data-mobile={isMobile}
      data-minimized={minimized}
    >
      <StyledHeader>
        {!minimized && <strong>{title}</strong>}
        {minimized && <InputHint role="status">{status}</InputHint>}
        <StyledActions>
          {(busy || minimized) && (
            <IconButton
              variant="tertiary"
              size="small"
              ariaLabel={
                minimized ? t`Expand softphone` : t`Minimize softphone`
              }
              Icon={minimized ? IconChevronUp : IconChevronDown}
              onClick={onToggleMinimized}
            />
          )}
          {!busy && (
            <IconButton
              variant="tertiary"
              size="small"
              ariaLabel={t`Close softphone`}
              Icon={IconX}
              onClick={onClose}
            />
          )}
        </StyledActions>
      </StyledHeader>
      {!minimized && (
        <>
          {authorizedDetails && (
            <StyledDetails>
              {authorizedDetails.name && (
                <strong>{authorizedDetails.name}</strong>
              )}
              <span>
                {t`Destination`} {authorizedDetails.number}
              </span>
            </StyledDetails>
          )}
          <InputHint role="status">{status}</InputHint>
          {details && details.status !== 'valid' && (
            <InputHint danger={details.status !== 'loading'}>
              {detailLabels[details.status]}
            </InputHint>
          )}
          {failureStage && (
            <InputHint>
              {failureCode === undefined
                ? failureStage
                : t`${failureStage} (code ${failureCode})`}
            </InputHint>
          )}
        </>
      )}
      {connectedAt !== null && (
        <StyledTimer>
          <VoiceCallTimer
            key={connectedAt}
            connectedAt={connectedAt}
            endedAt={endedAt}
          />
        </StyledTimer>
      )}
      <StyledActions>
        {busy ? (
          <>
            <Button
              size="small"
              title={muteLabel}
              ariaLabel={muteLabel}
              variant="secondary"
              disabled={!canMute}
              onClick={toggleMute}
            />
            <Button
              size="small"
              title={hangUpLabel}
              ariaLabel={hangUpLabel}
              accent="danger"
              disabled={state === 'ending'}
              onClick={hangUp}
            />
          </>
        ) : (
          !minimized && (
            <Button
              size="small"
              title={dialLabel}
              ariaLabel={dialLabel}
              Icon={IconPhone}
              disabled={!authorizedDetails}
              onClick={() => {
                if (authorizedDetails)
                  void placeCall(target.recordId, authorizedDetails.number);
              }}
            />
          )
        )}
      </StyledActions>
    </StyledPanel>
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

  return <VoiceSoftphoneControls panel={panel} details={details} />;
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
