import { VoiceAudioSettings } from '@/inconnect-voice/components/VoiceAudioSettings';
import { VoiceCallTimer } from '@/inconnect-voice/components/VoiceCallTimer';
import { VoiceKeypad } from '@/inconnect-voice/components/VoiceKeypad';
import {
  StyledAction,
  StyledActionLabel,
  StyledActions,
  StyledAvatar,
  StyledDrawer,
  StyledHeader,
  StyledHeaderGroup,
  StyledIdentity,
  StyledIncomingAction,
  StyledIncomingActionIcon,
  StyledName,
  StyledNumber,
  StyledPanel,
  StyledStatus,
  StyledStatusDot,
  StyledSummary,
  StyledTimer,
  StyledTimerLabel,
} from '@/inconnect-voice/components/VoiceSoftphoneView.styles';
import { type VoiceAudio } from '@/inconnect-voice/utils/createVoiceAudio';
import { type VoiceAudioSettings as AudioSettings } from '@/inconnect-voice/utils/voiceAudioPreferences';
import { InputHint } from '@/ui/input/components/InputHint';
import { useLingui } from '@lingui/react/macro';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';
import {
  IconChevronDown,
  IconChevronUp,
  IconHeadphones,
  IconPhone,
  IconX,
  useIcons,
} from 'twenty-ui/icon';
import { Button, IconButton } from 'twenty-ui/input';
import { AppTooltip } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export type VoiceStatusTone =
  | 'neutral'
  | 'waiting'
  | 'connected'
  | 'warning'
  | 'danger';

type VoiceSoftphoneViewProps = {
  minimized: boolean;
  mobile: boolean;
  busy: boolean;
  ending: boolean;
  muted: boolean;
  canMute: boolean;
  canSendDigit: boolean;
  canSwitchAudio: boolean;
  callId?: string;
  lead?: { name?: string | null; number: string } | null;
  status: string;
  tone: VoiceStatusTone;
  detailHint?: { text: string; danger: boolean };
  failureLabel?: string | null;
  timer?: ComponentProps<typeof VoiceCallTimer>;
  awaitingConnectedTime: boolean;
  audioSettings: AudioSettings;
  onToggleMinimized: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  onHangUp: () => void;
  onDial?: () => void;
  inboundActions?: { onAccept: () => void; onDecline: () => void };
  inbound?: boolean;
  terminal?: 'ended' | 'completed';
  idleContent?: ReactNode;
  onReturnToDialer?: () => void;
  onReturnToRecents?: () => void;
  onDigit: Extract<
    ComponentProps<typeof VoiceKeypad>,
    { mode?: 'dtmf' }
  >['onDigit'];
  onSelectAudioDevice: VoiceAudio['select'];
  onRequestMicrophoneAccess: VoiceAudio['checkMicrophone'];
};

const VoiceLeadName = ({ name }: { name: string }) => {
  const id = `voice-lead-${useId().replace(/:/g, '')}`;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const showTooltipIfClipped = (element: HTMLElement) =>
    setTooltipVisible(element.scrollWidth > element.clientWidth);

  return (
    <>
      {/* The focusable name exposes the complete text when the panel truncates it. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <StyledName
        id={id}
        tabIndex={0}
        aria-describedby={tooltipVisible ? `${id}-tooltip` : undefined}
        onFocus={(event) => showTooltipIfClipped(event.currentTarget)}
        onBlur={() => setTooltipVisible(false)}
        onMouseEnter={(event) => showTooltipIfClipped(event.currentTarget)}
        onMouseLeave={(event) => {
          if (document.activeElement !== event.currentTarget)
            setTooltipVisible(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && tooltipVisible) {
            event.stopPropagation();
            setTooltipVisible(false);
          }
        }}
      >
        {name}
      </StyledName>
      {tooltipVisible && (
        <AppTooltip anchorSelect={`#${id}`} isOpen positionStrategy="fixed">
          <span id={`${id}-tooltip`} role="tooltip">
            {name}
          </span>
        </AppTooltip>
      )}
    </>
  );
};

export const VoiceSoftphoneView = ({
  minimized,
  mobile,
  busy,
  ending,
  muted,
  canMute,
  canSendDigit,
  canSwitchAudio,
  callId,
  lead,
  status,
  tone,
  detailHint,
  failureLabel,
  timer,
  awaitingConnectedTime,
  audioSettings,
  onToggleMinimized,
  onClose,
  onToggleMute,
  onHangUp,
  onDial,
  inboundActions,
  inbound,
  terminal,
  idleContent,
  onReturnToDialer,
  onReturnToRecents,
  onDigit,
  onSelectAudioDevice,
  onRequestMicrophoneAccess,
}: VoiceSoftphoneViewProps) => {
  const { t } = useLingui();
  const { getIcon } = useIcons();
  const MicrophoneIcon = getIcon(
    muted ? 'IconMicrophoneOff' : 'IconMicrophone',
  );
  const KeypadIcon = getIcon('IconDialpad');
  const HangUpIcon = getIcon('IconPhoneOff', 'IconPhone');
  const IncomingIcon = getIcon('IconPhoneIncoming', 'IconPhone');
  const CompletedIcon = getIcon('IconCircleCheck', 'IconCheck');
  const RecentsIcon = getIcon('IconHistory');
  const [openControl, setOpenControl] = useState<
    { kind: 'audio' } | { kind: 'keypad'; callId: string } | null
  >(null);
  const drawerId = useId();
  const title = t`Softphone`;
  const muteLabel = muted ? t`Unmute` : t`Mute`;
  const keypadLabel = t`Keypad`;
  const audioLabel = t`Audio`;
  const hangUpLabel = t`Hang up`;
  const dialLabel = t`Place call`;
  const showKeypad =
    openControl?.kind === 'keypad' && busy && openControl.callId === callId;
  const showAudio = !terminal && openControl?.kind === 'audio';
  const completed = terminal === 'completed';
  const displayNumber =
    lead && inbound
      ? (parsePhoneNumberFromString(lead.number, {
          extract: false,
        })?.formatInternational() ?? lead.number)
      : lead?.number;
  const hasIdleContent = Boolean(idleContent);
  const initials = lead?.name
    ?.trim()
    .split(/\s+/u, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase())
    .join('');

  return (
    <StyledPanel
      aria-label={title}
      data-mobile={mobile}
      data-minimized={minimized}
    >
      <StyledHeader>
        <StyledHeaderGroup>
          <IconPhone size={themeCssVariables.icon.size.md} aria-hidden />
          <strong>{title}</strong>
        </StyledHeaderGroup>
        <StyledHeaderGroup>
          {(busy || minimized || hasIdleContent || onReturnToDialer) && (
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
        </StyledHeaderGroup>
      </StyledHeader>
      <StyledSummary data-global-idle={hasIdleContent}>
        {lead && (
          <StyledIdentity>
            {!minimized && initials && (
              <StyledAvatar aria-hidden>{initials}</StyledAvatar>
            )}
            {lead.name && <VoiceLeadName name={lead.name} />}
            {(!minimized || !lead.name) && (
              <StyledNumber dir="ltr" data-inbound={inbound}>
                {displayNumber}
              </StyledNumber>
            )}
          </StyledIdentity>
        )}
        <StyledStatus role="status" data-completed={completed}>
          {inboundActions ? (
            <IncomingIcon size={themeCssVariables.icon.size.md} aria-hidden />
          ) : completed ? (
            <CompletedIcon size={themeCssVariables.icon.size.md} aria-hidden />
          ) : (
            <StyledStatusDot aria-hidden data-tone={tone} />
          )}
          <span>{status}</span>
        </StyledStatus>
        {timer && (
          <StyledTimer data-completed={completed}>
            {completed && (
              <StyledTimerLabel>{t`Connected time`}</StyledTimerLabel>
            )}
            <VoiceCallTimer
              key={callId}
              connectedAt={timer.connectedAt}
              endedAt={timer.endedAt}
              durationSeconds={timer.durationSeconds}
            />
          </StyledTimer>
        )}
        {awaitingConnectedTime && (
          <InputHint>{t`Connected time pending confirmation`}</InputHint>
        )}
        {!minimized && detailHint && (
          <InputHint danger={detailHint.danger}>{detailHint.text}</InputHint>
        )}
        {!minimized && failureLabel && <InputHint>{failureLabel}</InputHint>}
      </StyledSummary>
      {inboundActions && (
        <StyledActions role="group" aria-label={t`Incoming call controls`}>
          <StyledIncomingAction
            type="button"
            onClick={inboundActions.onDecline}
          >
            <StyledIncomingActionIcon data-intent="decline">
              <HangUpIcon size={themeCssVariables.icon.size.lg} aria-hidden />
            </StyledIncomingActionIcon>
            <span>{t`Decline`}</span>
          </StyledIncomingAction>
          <StyledIncomingAction type="button" onClick={inboundActions.onAccept}>
            <StyledIncomingActionIcon data-intent="accept">
              <IconPhone size={themeCssVariables.icon.size.lg} aria-hidden />
            </StyledIncomingActionIcon>
            <span>{t`Accept`}</span>
          </StyledIncomingAction>
        </StyledActions>
      )}
      {terminal && !minimized && (onReturnToDialer || onReturnToRecents) && (
        <StyledActions role="group" aria-label={t`Phone views`}>
          {onReturnToDialer && (
            <StyledAction type="button" onClick={onReturnToDialer}>
              <KeypadIcon size={themeCssVariables.icon.size.md} aria-hidden />
              <span>{t`Back to keypad`}</span>
            </StyledAction>
          )}
          {onReturnToRecents && (
            <StyledAction type="button" onClick={onReturnToRecents}>
              <RecentsIcon size={themeCssVariables.icon.size.md} aria-hidden />
              <span>{t`Back to recents`}</span>
            </StyledAction>
          )}
        </StyledActions>
      )}
      {!inboundActions &&
        !terminal &&
        (busy || (!minimized && !hasIdleContent)) && (
          <StyledActions
            role="group"
            aria-label={t`Call controls`}
            data-expanded-call={busy && !minimized}
          >
            {busy && (
              <StyledAction
                type="button"
                title={muteLabel}
                aria-label={muteLabel}
                disabled={!canMute}
                onClick={onToggleMute}
              >
                <MicrophoneIcon
                  size={themeCssVariables.icon.size.lg}
                  aria-hidden
                />
                <StyledActionLabel>{muteLabel}</StyledActionLabel>
              </StyledAction>
            )}
            {busy && !minimized && (
              <StyledAction
                type="button"
                title={keypadLabel}
                aria-label={keypadLabel}
                aria-pressed={showKeypad}
                aria-controls={showKeypad ? drawerId : undefined}
                disabled={!showKeypad && !canSendDigit}
                onClick={() =>
                  setOpenControl(
                    !showKeypad && callId ? { kind: 'keypad', callId } : null,
                  )
                }
              >
                <KeypadIcon size={themeCssVariables.icon.size.lg} aria-hidden />
                <StyledActionLabel>{keypadLabel}</StyledActionLabel>
              </StyledAction>
            )}
            {!minimized && (
              <StyledAction
                type="button"
                title={audioLabel}
                aria-label={audioLabel}
                aria-pressed={showAudio}
                aria-controls={showAudio ? drawerId : undefined}
                onClick={() =>
                  setOpenControl(showAudio ? null : { kind: 'audio' })
                }
              >
                <IconHeadphones
                  size={themeCssVariables.icon.size.lg}
                  aria-hidden
                />
                <StyledActionLabel>{audioLabel}</StyledActionLabel>
              </StyledAction>
            )}
            {busy ? (
              <StyledAction
                className="hang-up"
                type="button"
                title={hangUpLabel}
                aria-label={hangUpLabel}
                disabled={ending}
                onClick={onHangUp}
              >
                <HangUpIcon size={themeCssVariables.icon.size.lg} aria-hidden />
                <StyledActionLabel>{hangUpLabel}</StyledActionLabel>
              </StyledAction>
            ) : onReturnToDialer ? (
              <Button
                type="button"
                title={t`Back to keypad`}
                ariaLabel={t`Back to keypad`}
                onClick={onReturnToDialer}
              />
            ) : (
              !hasIdleContent && (
                <Button
                  type="button"
                  fullWidth
                  justify="center"
                  title={dialLabel}
                  ariaLabel={dialLabel}
                  Icon={IconPhone}
                  disabled={!onDial}
                  onClick={onDial}
                />
              )
            )}
          </StyledActions>
        )}
      {!busy && !minimized && idleContent}
      {!minimized && !hasIdleContent && (showKeypad || showAudio) && (
        <StyledDrawer id={drawerId}>
          {showKeypad && (
            <VoiceKeypad enabled={canSendDigit} onDigit={onDigit} />
          )}
          {showAudio && (
            <VoiceAudioSettings
              settings={audioSettings}
              busy={busy}
              canSwitch={canSwitchAudio}
              onSelect={onSelectAudioDevice}
              onRequestAccess={onRequestMicrophoneAccess}
            />
          )}
        </StyledDrawer>
      )}
    </StyledPanel>
  );
};
