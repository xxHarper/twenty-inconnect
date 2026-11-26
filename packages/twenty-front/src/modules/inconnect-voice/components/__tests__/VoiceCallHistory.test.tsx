import { VoiceCallHistory } from '@/inconnect-voice/components/VoiceCallHistory';
import { voiceHistoryRevisionState } from '@/inconnect-voice/hooks/useVoiceProviderProgress';
import {
  getVoiceHistory,
  type VoiceCallHistory as HistoryData,
} from '@/inconnect-voice/utils/voiceApi';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

jest.mock('@/inconnect-voice/utils/voiceApi', () => ({
  getVoiceHistory: jest.fn(),
  getVoiceCallProgress: jest.fn(),
}));

const recordId = '00000000-0000-4000-8000-000000000001';
const callId = '00000000-0000-4000-8000-000000000002';
const history: HistoryData = {
  attempts: 31,
  answered: 9,
  durationSeconds: '120',
  next: callId,
  rows: [
    {
      id: callId,
      actorLabel: 'Voice Operator',
      direction: 'outbound',
      status: 'finished',
      result: 'answered',
      durationSeconds: 27,
      createdAt: '2026-11-24T18:00:00.000Z',
      answeredAt: null,
      endedAt: null,
      canReconcile: true,
    },
  ],
};

describe('Voice call history', () => {
  const renderHistory = () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <I18nProvider i18n={i18n}>
          <VoiceCallHistory recordId={recordId} />
        </I18nProvider>
      </Provider>,
    );
    return store;
  };

  beforeEach(() => jest.resetAllMocks());

  it('labels an answered inbound call and shows the confirmed duration', async () => {
    jest.mocked(getVoiceHistory).mockResolvedValue({
      ...history,
      rows: [{ ...history.rows[0], direction: 'inbound', durationSeconds: 16 }],
    });
    renderHistory();
    expect(await screen.findByText('Incoming call answered')).toBeVisible();
    expect(screen.getByText('00:00:16')).toBeVisible();
    expect(screen.queryByText('Destination answered')).not.toBeInTheDocument();
  });

  it('keeps full-history totals during pagination and refreshes when the softphone confirms a call', async () => {
    jest
      .mocked(getVoiceHistory)
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce({
        ...history,
        next: null,
        rows: [{ ...history.rows[0], actorLabel: 'Previous operator' }],
      })
      .mockResolvedValueOnce({
        ...history,
        next: null,
        durationSeconds: '150',
        rows: [
          {
            ...history.rows[0],
            actorLabel: 'Previous operator',
            durationSeconds: 30,
          },
        ],
      });

    const store = renderHistory();
    expect(screen.getByRole('status')).toHaveTextContent('Loading calls');
    expect(await screen.findByText('Voice Operator')).toBeVisible();
    expect(screen.getByText('31')).toBeVisible();
    expect(screen.getByText('00:02:00')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Previous operator')).toBeVisible();
    expect(getVoiceHistory).toHaveBeenLastCalledWith(
      recordId,
      expect.any(AbortSignal),
      callId,
    );
    expect(screen.getByText('31')).toBeVisible();
    act(() => store.set(voiceHistoryRevisionState, { [recordId]: 1 }));
    expect(await screen.findByText('00:02:30')).toBeVisible();
  });

  it('shows an error, retries, and displays an authorized empty history', async () => {
    jest
      .mocked(getVoiceHistory)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({
        attempts: 0,
        answered: 0,
        durationSeconds: '0',
        rows: [],
        next: null,
      });
    renderHistory();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Call history could not be loaded',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No calls recorded.')).toBeVisible();
  });
});
