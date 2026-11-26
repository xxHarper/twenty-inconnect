import { VoiceAudioSettings } from '@/inconnect-voice/components/VoiceAudioSettings';
import { VoiceKeypad } from '@/inconnect-voice/components/VoiceKeypad';
import { VoiceRecents } from '@/inconnect-voice/components/VoiceRecents';
import {
  VoiceSoftphoneControls,
  type VoicePhoneTab,
  type VoiceSoftphonePanelProps,
} from '@/inconnect-voice/components/VoiceSoftphone';
import { useVoiceDialLookup } from '@/inconnect-voice/hooks/useVoiceDialLookup';
import { InputHint } from '@/ui/input/components/InputHint';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { IconEraser, IconHeadphones, IconPhone } from 'twenty-ui/icon';
import { Button, SegmentedControl } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledDialer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
  min-width: 0;
`;

const StyledTabs = styled.div`
  flex: 0 0 auto;
  padding: 0 ${themeCssVariables.spacing[3]};
`;

const StyledBody = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
  min-width: 0;
  overflow: hidden auto;
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};
`;

const StyledPhoneInput = styled.input`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font: inherit;
  font-size: clamp(20px, 7vw, 24px);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  padding: ${themeCssVariables.spacing[2]};
  text-align: center;
  width: 100%;

  &::placeholder {
    color: ${themeCssVariables.font.color.tertiary};
    font-size: ${themeCssVariables.font.size.md};
  }

  &[aria-invalid='true'] {
    border-color: ${themeCssVariables.color.red9};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: -2px;
  }
`;

const StyledResolution = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
  text-align: center;
`;

const StyledCandidates = styled.fieldset`
  border: 0;
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  margin: 0;
  min-width: 0;
  padding: 0;
  text-align: left;

  label {
    align-items: baseline;
    display: flex;
    gap: ${themeCssVariables.spacing[1]};
  }

  legend {
    color: ${themeCssVariables.font.color.secondary};
    padding: 0 0 ${themeCssVariables.spacing[1]};
  }
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  text-align: center;
`;

const StyledControls = styled.div`
  align-items: center;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  justify-items: center;
`;

const StyledControl = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.rounded};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: inline-flex;
  height: 36px;
  justify-content: center;
  padding: 0;
  width: 36px;

  &[aria-pressed='true'],
  &:hover:not(:disabled) {
    background: ${themeCssVariables.background.tertiary};
    color: ${themeCssVariables.font.color.primary};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.border.color.blue};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }

  &[data-dial] {
    height: 44px;
    width: 44px;
  }

  &[data-dial]:not(:disabled) {
    background: ${themeCssVariables.color.green9};
    border-color: transparent;
    color: ${themeCssVariables.color.gray1};

    &:hover {
      background: ${themeCssVariables.color.green10};
    }
  }
`;

type VoiceGlobalSoftphoneProps = {
  panel: VoiceSoftphonePanelProps;
  initialTab?: VoicePhoneTab;
};

export const VoiceGlobalSoftphone = ({
  panel,
  initialTab = 'keypad',
}: VoiceGlobalSoftphoneProps) => {
  const { t } = useLingui();
  const { voice } = panel;
  const [tab, setTab] = useState(initialTab);
  const [audioOpen, setAudioOpen] = useState(false);
  const [identity, setIdentity] = useState<{
    name: string | null;
    number: string;
  } | null>(null);
  const { number, lookup, editNumber, select, loadMore } = useVoiceDialLookup();
  const candidateGroup = useId();
  const hintId = useId();
  const audioId = useId();
  const numberFieldRef = useRef<HTMLInputElement>(null);
  const [redialRevision, setRedialRevision] = useState(0);

  useLayoutEffect(() => {
    if (redialRevision) numberFieldRef.current?.focus();
  }, [redialRevision]);

  const returnToDialer = (nextTab: VoicePhoneTab) => {
    if (!voice.resetCall()) return;
    setIdentity(null);
    setAudioOpen(false);
    editNumber('');
    setTab(nextTab);
  };

  const result = lookup.status === 'found' ? lookup : null;
  const selected = result?.data.candidates.find(
    ({ recordId }) => recordId === result.recordId,
  );
  const canPlace = Boolean(
    tab === 'keypad' &&
    result &&
    voice.availability === 'ready' &&
    (selected
      ? result.data.canCall
      : !result.data.candidates.length &&
        !result.data.next &&
        result.data.canCallUnlinked),
  );
  const finishedOrCalling = voice.snapshot.state !== 'idle';
  const inboundState = voice.inbound.state;
  const inboundOnline = inboundState === 'online';
  const receiving = inboundOnline || inboundState === 'connecting';
  const receiveCallsLabel = receiving
    ? t`Stop receiving calls`
    : t`Receive calls`;
  const keypadLabel = t`Keypad`;
  const recentsLabel = t`Recents`;
  const callLabel = t`Place call`;
  const audioLabel = t`Audio`;
  const clearLabel = t`Clear number`;
  const retry = lookup.status === 'failed' || lookup.status === 'throttled';
  const resolutionMessages = {
    idle: '',
    loading: t`Looking for matching Leads…`,
    invalid: t`Enter a complete, valid phone number.`,
    failed: t`Matching Leads could not be verified.`,
    throttled: t`Wait a moment before trying again.`,
  };
  const blockedDestination =
    result && voice.availability === 'ready' && !result.data.canCall;
  const blockedUnlinked =
    result &&
    voice.availability === 'ready' &&
    result.data.canCall &&
    !result.data.candidates.length &&
    !result.data.canCallUnlinked;
  const needsSelection =
    result && result.data.candidates.length > 0 && !selected;
  const callHint =
    tab === 'recents'
      ? t`Open Keypad to place a call.`
      : blockedDestination
        ? t`This destination is unavailable for calling.`
        : blockedUnlinked
          ? t`Calling without a Lead is unavailable.`
          : needsSelection
            ? t`Select a Lead to continue.`
            : undefined;

  const placeCall = () => {
    if (!canPlace || !result) return;
    setAudioOpen(false);
    setIdentity({
      name: selected?.name ?? (selected ? t`Lead` : t`Unknown contact`),
      number: result.data.destination,
    });
    void voice.placeCall(
      selected?.recordId ?? null,
      result.data.destination,
      true,
    );
  };

  return (
    <VoiceSoftphoneControls
      panel={panel}
      manual={{
        identity: finishedOrCalling ? identity : null,
        onReturnToDialer: finishedOrCalling
          ? () => returnToDialer('keypad')
          : undefined,
        onReturnToRecents: finishedOrCalling
          ? () => returnToDialer('recents')
          : undefined,
        idleContent: !finishedOrCalling && (
          <StyledDialer>
            <StyledTabs>
              <SegmentedControl
                role="tablist"
                ariaLabel={t`Phone views`}
                width="100%"
                options={[
                  { value: 'keypad', label: keypadLabel },
                  { value: 'recents', label: recentsLabel },
                ]}
                value={tab}
                onChange={setTab}
              />
            </StyledTabs>
            <StyledBody
              role="tabpanel"
              aria-label={tab === 'recents' ? recentsLabel : keypadLabel}
            >
              {tab === 'recents' ? (
                <VoiceRecents
                  onRedial={(destination) => {
                    setRedialRevision((previous) => previous + 1);
                    editNumber(destination, true);
                    setAudioOpen(false);
                    setTab('keypad');
                  }}
                />
              ) : (
                <>
                  <StyledPhoneInput
                    ref={numberFieldRef}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={64}
                    aria-label={t`Phone number`}
                    placeholder={t`Phone number`}
                    aria-invalid={lookup.status === 'invalid'}
                    aria-describedby={hintId}
                    value={number}
                    onChange={(event) => editNumber(event.currentTarget.value)}
                  />
                  <StyledResolution id={hintId}>
                    {lookup.status !== 'found' &&
                      resolutionMessages[lookup.status] && (
                        <InputHint
                          danger={lookup.status === 'invalid' || retry}
                          role={retry ? 'alert' : 'status'}
                        >
                          {resolutionMessages[lookup.status]}
                        </InputHint>
                      )}
                    {retry && (
                      <Button
                        title={t`Retry lookup`}
                        ariaLabel={t`Retry lookup`}
                        size="small"
                        variant="secondary"
                        onClick={() => editNumber(number, true)}
                      />
                    )}
                    {result &&
                      (result.data.candidates.length === 0 ? (
                        <InputHint role="status">{t`No associated Lead`}</InputHint>
                      ) : result.data.candidates.length === 1 &&
                        selected &&
                        !result.data.next ? (
                        <strong role="status">
                          {selected.name || t`Lead`}
                        </strong>
                      ) : (
                        <StyledCandidates>
                          <legend>{t`Matching Leads`}</legend>
                          {result.data.candidates.map(({ recordId, name }) => (
                            <label key={recordId}>
                              <input
                                type="radio"
                                name={candidateGroup}
                                checked={result.recordId === recordId}
                                onChange={() => select(recordId)}
                              />
                              <span>
                                {name || t`Lead`}
                                {(!name ||
                                  result.data.candidates.filter(
                                    (candidate) => candidate.name === name,
                                  ).length > 1) &&
                                  ` · ${recordId}`}
                              </span>
                            </label>
                          ))}
                          {result.data.next && (
                            <Button
                              title={t`More matching Leads`}
                              variant="secondary"
                              size="small"
                              onClick={loadMore}
                            />
                          )}
                        </StyledCandidates>
                      ))}
                  </StyledResolution>
                  {audioOpen ? (
                    <div id={audioId}>
                      <VoiceAudioSettings
                        settings={voice.audioSettings}
                        busy={false}
                        canSwitch={false}
                        onSelect={voice.selectAudioDevice}
                        onRequestAccess={voice.requestMicrophoneAccess}
                      />
                    </div>
                  ) : (
                    <VoiceKeypad
                      mode="dial"
                      enabled
                      onDigit={(digit) => {
                        if (digit === '⌫') editNumber(number.slice(0, -1));
                        else if (
                          number.length < 64 &&
                          (digit !== '+' || !number)
                        )
                          editNumber(number + digit);
                      }}
                    />
                  )}
                </>
              )}
            </StyledBody>
            <StyledFooter>
              {callHint && <InputHint>{callHint}</InputHint>}
              <StyledControls>
                <StyledControl
                  type="button"
                  title={audioLabel}
                  aria-label={audioLabel}
                  aria-pressed={tab === 'keypad' && audioOpen}
                  aria-controls={
                    tab === 'keypad' && audioOpen ? audioId : undefined
                  }
                  onClick={() => {
                    setAudioOpen(tab === 'recents' || !audioOpen);
                    setTab('keypad');
                  }}
                >
                  <IconHeadphones
                    size={themeCssVariables.icon.size.md}
                    aria-hidden
                  />
                </StyledControl>
                <span title={callLabel}>
                  <StyledControl
                    type="button"
                    aria-label={callLabel}
                    data-dial
                    disabled={!canPlace}
                    onClick={placeCall}
                  >
                    <IconPhone
                      size={themeCssVariables.icon.size.lg}
                      aria-hidden
                    />
                  </StyledControl>
                </span>
                <span title={clearLabel}>
                  <StyledControl
                    type="button"
                    aria-label={clearLabel}
                    disabled={tab !== 'keypad' || !number}
                    onClick={() => editNumber('')}
                  >
                    <IconEraser
                      size={themeCssVariables.icon.size.md}
                      aria-hidden
                    />
                  </StyledControl>
                </span>
              </StyledControls>
              {voice.inbound.available && (
                <>
                  <Button
                    title={receiveCallsLabel}
                    ariaLabel={receiveCallsLabel}
                    onClick={
                      receiving
                        ? voice.inbound.stop
                        : () => void voice.inbound.start()
                    }
                    size="small"
                  />
                  <InputHint>
                    {inboundOnline
                      ? t`Ready to receive calls`
                      : inboundState === 'connecting'
                        ? t`Connecting incoming calls…`
                        : inboundState === 'unavailable'
                          ? t`Incoming calls unavailable. Try again.`
                          : t`Incoming calls offline`}
                  </InputHint>
                </>
              )}
            </StyledFooter>
          </StyledDialer>
        ),
      }}
    />
  );
};
