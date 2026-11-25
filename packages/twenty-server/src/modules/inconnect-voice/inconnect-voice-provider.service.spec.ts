import Twilio from 'twilio';

import { type InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import { type InconnectVoiceConfig } from 'src/modules/inconnect-voice/inconnect-voice-config';
import { InconnectVoiceProviderService } from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

jest.mock('twilio', () => jest.fn());

const id = '00000000-0000-4000-8000-000000000005';
const parentSid = `CA${'a'.repeat(32)}`;
const childSid = `CA${'b'.repeat(32)}`;
const config = {
  accountSid: `AC${'a'.repeat(32)}`,
  apiKeySid: 'key',
  apiKeySecret: 'secret',
} as InconnectVoiceConfig;
const evidence = {
  sid: childSid,
  parentCallSid: parentSid,
  accountSid: config.accountSid,
  direction: 'outbound-dial',
  status: 'completed',
  endTime: new Date('2026-11-24T19:00:00.000Z'),
  duration: '27',
};

describe('Voice reconciliation by existing provider identity', () => {
  const recordProgress = jest.fn();
  const fetch = jest.fn();
  const list = jest.fn();
  const calls = Object.assign(
    jest.fn(() => ({ fetch })),
    { list },
  );
  const provider = new InconnectVoiceProviderService({
    recordProgress,
  } as unknown as InconnectVoiceCallStore);

  beforeEach(() => {
    jest.resetAllMocks();
    calls.mockReturnValue({ fetch });
    jest
      .mocked(Twilio)
      .mockReturnValue({ calls } as unknown as ReturnType<typeof Twilio>);
  });

  it('recovers the completed destination leg beneath the exact parent', async () => {
    list.mockResolvedValueOnce([evidence]);
    await provider.reconcile(config, { id, parentSid, childSid: null });
    expect(list).toHaveBeenCalledWith({
      parentCallSid: parentSid,
      limit: 2,
      pageSize: 2,
    });
    expect(recordProgress).toHaveBeenCalledWith(
      config,
      { id, parentSid, childSid },
      expect.objectContaining({
        result: 'answered',
        durationSeconds: 27,
        answeredAt: null,
        endedAt: evidence.endTime,
      }),
    );
  });

  it('keeps ambiguous, missing, or mismatched provider results pending', async () => {
    list.mockResolvedValueOnce([evidence, evidence]).mockResolvedValueOnce([]);
    await provider.reconcile(config, { id, parentSid, childSid: null });
    await provider.reconcile(config, { id, parentSid, childSid: null });
    fetch.mockResolvedValueOnce({ ...evidence, parentCallSid: childSid });
    await provider.reconcile(config, { id, parentSid, childSid });
    expect(calls).toHaveBeenCalledWith(childSid);
    expect(recordProgress).not.toHaveBeenCalled();
  });
});
