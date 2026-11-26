import { voiceHistoryRevisionState } from '@/inconnect-voice/hooks/useVoiceProviderProgress';
import { useVoiceResultLabel } from '@/inconnect-voice/hooks/useVoiceResultLabel';
import { formatVoiceDuration } from '@/inconnect-voice/utils/formatVoiceDuration';
import {
  getVoiceCallProgress,
  getVoiceHistory,
  type VoiceCallHistory as VoiceHistory,
} from '@/inconnect-voice/utils/voiceApi';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledHistory = styled.section`
  color: ${themeCssVariables.font.color.primary};
  display: grid;
  gap: ${themeCssVariables.spacing[4]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledSummary = styled.dl`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[6]};
  margin: 0;

  dt {
    color: ${themeCssVariables.font.color.secondary};
  }

  dd {
    font-weight: ${themeCssVariables.font.weight.semiBold};
    margin: ${themeCssVariables.spacing[1]} 0 0;
  }
`;

const StyledTableContainer = styled.div`
  overflow-x: auto;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  text-align: start;
  width: 100%;

  th,
  td {
    border-bottom: 1px solid ${themeCssVariables.border.color.light};
    padding: ${themeCssVariables.spacing[2]};
    text-align: start;
    white-space: nowrap;
  }

  th {
    color: ${themeCssVariables.font.color.secondary};
  }
`;

const StyledPagination = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const needsConfirmation = (row: VoiceHistory['rows'][number]) =>
  row.status !== 'finished' ||
  (row.result === 'answered' && row.durationSeconds === null);

export const VoiceCallHistory = ({ recordId }: { recordId: string }) => {
  const { t, i18n } = useLingui();
  const results = useVoiceResultLabel();
  const retryLabel = t`Retry`;
  const previousLabel = t`Previous`;
  const nextLabel = t`Next`;
  const refreshLabel = t`Refresh calls`;
  const [cursors, setCursors] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    data: VoiceHistory | null;
  }>();
  const revision = useAtomValue(voiceHistoryRevisionState)[recordId] ?? 0;
  const before = cursors.at(-1);
  const key = `${recordId}:${before ?? ''}:${retry}`;
  const data = response?.key === key ? response.data : undefined;

  useEffect(() => {
    const abort = new AbortController();
    const deadline = performance.now() + 8 * 60_000;
    let next: number | undefined;
    const load = async () => {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(12_000),
      ]);
      try {
        const history = await getVoiceHistory(recordId, signal, before);
        if (abort.signal.aborted) return;
        setResponse({ key, data: history });
        const pending = history.rows.filter(needsConfirmation);
        if (pending.length === 0 || performance.now() >= deadline) return;

        next = window.setTimeout(async () => {
          const recoverable = pending.find(
            (row) => row.canReconcile && row.status !== 'reserved',
          );
          if (recoverable) {
            try {
              await getVoiceCallProgress(
                recordId,
                recoverable.id,
                AbortSignal.any([abort.signal, AbortSignal.timeout(8_000)]),
                'reconcile',
              );
            } catch {
              // The next authorized history read retains the unresolved result.
            }
          }
          if (!abort.signal.aborted) void load();
        }, 5_000);
      } catch {
        if (!abort.signal.aborted) setResponse({ key, data: null });
      }
    };
    const refreshOnFocus = () => setRetry((previous) => previous + 1);
    window.addEventListener('focus', refreshOnFocus);
    void load();
    return () => {
      abort.abort();
      window.clearTimeout(next);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [before, key, recordId, revision]);

  if (data === undefined)
    return <StyledHistory role="status">{t`Loading calls…`}</StyledHistory>;
  if (data === null)
    return (
      <StyledHistory role="alert">
        <span>{t`Call history could not be loaded.`}</span>
        <div>
          <Button
            title={retryLabel}
            ariaLabel={retryLabel}
            size="small"
            onClick={() => setRetry((previous) => previous + 1)}
          />
        </div>
      </StyledHistory>
    );

  const dateFormat = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <StyledHistory aria-label={t`Call history`}>
      <StyledSummary>
        <div>
          <dt>{t`Attempts`}</dt>
          <dd>{data.attempts}</dd>
        </div>
        <div>
          <dt>{t`Answered calls`}</dt>
          <dd>{data.answered}</dd>
        </div>
        <div>
          <dt>{t`Confirmed connected time`}</dt>
          <dd>{formatVoiceDuration(Number(data.durationSeconds))}</dd>
        </div>
      </StyledSummary>
      {data.rows.length === 0 ? (
        <span>{t`No calls recorded.`}</span>
      ) : (
        <StyledTableContainer>
          <StyledTable>
            <thead>
              <tr>
                <th scope="col">{t`Date and time`}</th>
                <th scope="col">{t`Direction`}</th>
                <th scope="col">{t`Called by`}</th>
                <th scope="col">{t`Result`}</th>
                <th scope="col">{t`Duration`}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <time dateTime={row.createdAt}>
                      {dateFormat.format(new Date(row.createdAt))}
                    </time>
                  </td>
                  <td>{t`Outbound`}</td>
                  <td>{row.actorLabel || t`Workspace member`}</td>
                  <td>
                    {row.result
                      ? results[row.result]
                      : row.status === 'answered'
                        ? results.answered
                        : results.pending}
                  </td>
                  <td>
                    {row.durationSeconds !== null
                      ? formatVoiceDuration(row.durationSeconds)
                      : needsConfirmation(row)
                        ? results.pending
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </StyledTable>
        </StyledTableContainer>
      )}
      {(before || data.next) && (
        <StyledPagination>
          <Button
            title={previousLabel}
            ariaLabel={previousLabel}
            size="small"
            disabled={!before}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          />
          <Button
            title={nextLabel}
            ariaLabel={nextLabel}
            size="small"
            disabled={!data.next}
            onClick={() => {
              const next = data.next;
              if (next) setCursors((previous) => [...previous, next]);
            }}
          />
        </StyledPagination>
      )}
      {data.rows.some(needsConfirmation) && (
        <div>
          <Button
            title={refreshLabel}
            ariaLabel={refreshLabel}
            size="small"
            onClick={() => setRetry((previous) => previous + 1)}
          />
        </div>
      )}
    </StyledHistory>
  );
};
