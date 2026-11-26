import { useDateTimeFormat } from '@/localization/hooks/useDateTimeFormat';
import { InputHint } from '@/ui/input/components/InputHint';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import {
  IconArrowUpRight,
  IconCheck,
  IconClock,
  IconMinus,
  IconPhone,
  IconX,
} from 'twenty-ui/icon';
import { Button, IconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useVoiceResultLabel } from '@/inconnect-voice/hooks/useVoiceResultLabel';
import { formatVoiceDuration } from '@/inconnect-voice/utils/formatVoiceDuration';
import {
  getVoiceRecents,
  type VoiceRecents as RecentsPage,
} from '@/inconnect-voice/utils/voiceApi';

const StyledDate = styled.h3`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin: 0;
  padding: ${themeCssVariables.spacing[1]} 0;
`;

const StyledList = styled.ul`
  display: grid;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const StyledCall = styled.li`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: ${themeCssVariables.spacing[1.5]} 0;
`;

const StyledDetails = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[0.5]};
  min-width: 0;
  overflow-wrap: anywhere;

  strong {
    font-size: ${themeCssVariables.font.size.sm};
  }

  span,
  small {
    color: ${themeCssVariables.font.color.secondary};
    font-size: ${themeCssVariables.font.size.xs};
    font-variant-numeric: tabular-nums;
  }
`;

const StyledOutcome = styled.span`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: inline-flex;
  gap: ${themeCssVariables.spacing[0.5]};

  &[data-tone='answered'] {
    color: ${themeCssVariables.color.green11};
  }
  &[data-tone='no-answer'],
  &[data-tone='failed'] {
    color: ${themeCssVariables.color.red11};
  }
  &[data-tone='busy'] {
    color: ${themeCssVariables.color.orange11};
  }
`;

const StyledPagination = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

export const VoiceRecents = ({
  onRedial,
}: {
  onRedial: (destination: string) => void;
}) => {
  const { t, i18n } = useLingui();
  const redialLabel = t`Redial`;
  const { timeZone } = useDateTimeFormat();
  const labels = useVoiceResultLabel();
  const [cursors, setCursors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    data: RecentsPage | null;
  }>();
  const before = cursors.at(-1);
  const key = `${before ?? ''}:${revision}`;
  const data = response?.key === key ? response.data : undefined;

  useEffect(() => {
    const abort = new AbortController();
    void getVoiceRecents(
      AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]),
      before,
    )
      .then((page) => {
        if (!abort.signal.aborted) setResponse({ key, data: page });
      })
      .catch(() => {
        if (!abort.signal.aborted) setResponse({ key, data: null });
      });
    const refreshOnFocus = () => setRevision((previous) => previous + 1);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      abort.abort();
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [before, key]);

  if (data === undefined)
    return <InputHint role="status">{t`Loading calls…`}</InputHint>;
  if (data === null)
    return (
      <>
        <InputHint
          danger
          role="alert"
        >{t`Call history could not be loaded.`}</InputHint>
        <Button
          title={t`Retry`}
          ariaLabel={t`Retry`}
          onClick={() => setRevision((previous) => previous + 1)}
        />
      </>
    );

  const dateFormat = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
    timeZone,
  });
  const timeFormat = new Intl.DateTimeFormat(i18n.locale, {
    timeStyle: 'short',
    timeZone,
  });
  const groups = new Map<string, RecentsPage['rows']>();
  for (const row of data.rows) {
    const date = dateFormat.format(new Date(row.createdAt));
    const group = groups.get(date);
    if (group) group.push(row);
    else groups.set(date, [row]);
  }
  const next = data.next;
  return (
    <>
      {data.rows.length === 0 && <InputHint>{t`No calls recorded.`}</InputHint>}
      {Array.from(groups, ([date, rows]) => (
        <section key={date} aria-label={date}>
          <StyledDate>{date}</StyledDate>
          <StyledList>
            {rows.map((row) => {
              const result =
                row.result ??
                (row.status === 'reserved' || row.status === 'finished'
                  ? 'pending'
                  : row.status);
              const OutcomeIcon = {
                answered: IconCheck,
                'no-answer': IconX,
                failed: IconX,
                busy: IconMinus,
                canceled: IconMinus,
                completed: IconCheck,
                pending: IconClock,
                ringing: IconClock,
                connecting: IconClock,
              }[result];
              const redialDestinationLabel = `${redialLabel} ${row.destination}`;

              return (
                <StyledCall key={row.id}>
                  <StyledOutcome
                    data-tone={result}
                    role="img"
                    aria-label={t`Outbound`}
                  >
                    <IconArrowUpRight size={12} aria-hidden />
                    <OutcomeIcon size={14} aria-hidden />
                  </StyledOutcome>
                  <StyledDetails>
                    <strong title={row.name ?? undefined}>
                      {row.name ||
                        (row.recordId ? t`Lead` : t`No associated Lead`)}
                    </strong>
                    <span>{row.destination}</span>
                    <small>
                      <time dateTime={row.createdAt}>
                        {timeFormat.format(new Date(row.createdAt))}
                      </time>
                      {' · '}
                      {labels[result]}
                      {row.durationSeconds !== null &&
                        ` · ${formatVoiceDuration(row.durationSeconds)}`}
                    </small>
                  </StyledDetails>
                  <span title={redialDestinationLabel}>
                    <IconButton
                      Icon={IconPhone}
                      ariaLabel={redialDestinationLabel}
                      size="small"
                      variant="tertiary"
                      onClick={() => onRedial(row.destination)}
                    />
                  </span>
                </StyledCall>
              );
            })}
          </StyledList>
        </section>
      ))}
      {(before || next) && (
        <StyledPagination>
          <Button
            title={t`Previous`}
            ariaLabel={t`Previous`}
            size="small"
            disabled={!before}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          />
          <Button
            title={t`Next`}
            ariaLabel={t`Next`}
            size="small"
            disabled={!next}
            onClick={() => {
              if (next) setCursors((previous) => [...previous, next]);
            }}
          />
        </StyledPagination>
      )}
    </>
  );
};
