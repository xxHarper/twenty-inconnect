import {
  mergeVoiceProgress,
  readTwilioProgress,
  type VoiceProgress,
} from 'src/modules/inconnect-voice/inconnect-voice-lifecycle';

const evidence = (status: string, eventTime?: string, duration?: string) => {
  const progress = readTwilioProgress({ status, eventTime, duration });
  if (!progress) throw new Error('Expected a supported fixture');
  return progress;
};

const started: VoiceProgress = {
  status: 'connecting',
  result: null,
  answeredAt: null,
  endedAt: null,
  durationSeconds: null,
};
const answer = 'Tue, 24 Nov 2026 18:56:31 +0000';
const end = 'Tue, 24 Nov 2026 18:56:39 +0000';

describe('Voice destination evidence', () => {
  it('accepts late answer evidence while preserving a completed state and exact duration', () => {
    const completed = mergeVoiceProgress(
      started,
      evidence('completed', end, '8'),
    );
    expect(completed.answeredAt).toBeNull();
    const answeredLate = mergeVoiceProgress(
      completed,
      evidence('in-progress', answer),
    );
    expect(answeredLate).toEqual({
      status: 'finished',
      result: 'answered',
      answeredAt: new Date(answer),
      endedAt: new Date(end),
      durationSeconds: 8,
    });
    expect(
      mergeVoiceProgress(answeredLate, evidence('ringing', answer)),
    ).toEqual(answeredLate);
    expect(
      mergeVoiceProgress(answeredLate, evidence('completed', end, '8')),
    ).toEqual(answeredLate);
    expect(mergeVoiceProgress(answeredLate, evidence('failed', end))).toEqual(
      answeredLate,
    );
  });

  it.each(['busy', 'failed', 'canceled', 'no-answer'])(
    'does not turn %s into a connected call',
    (status) => {
      const finished = mergeVoiceProgress(started, evidence(status, end, '42'));
      expect(
        mergeVoiceProgress(finished, evidence('in-progress', answer)),
      ).toEqual({
        status: 'finished',
        result: status,
        answeredAt: null,
        endedAt: new Date(end),
        durationSeconds: null,
      });
    },
  );

  it('fills missing terminal details through reconciliation without deriving an answer time', () => {
    const finished = mergeVoiceProgress(started, evidence('completed'));
    expect(
      mergeVoiceProgress(finished, evidence('completed', end, '0')),
    ).toEqual({
      status: 'finished',
      result: 'answered',
      answeredAt: null,
      endedAt: new Date(end),
      durationSeconds: 0,
    });
    expect(
      readTwilioProgress({ status: 'unknown', eventTime: end }),
    ).toBeNull();
  });
});
