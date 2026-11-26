import Twilio from 'twilio';

import { type InconnectVoiceCallStore } from 'src/modules/inconnect-voice/inconnect-voice-call.store';
import {
  getVoiceInboundConfig,
  type VoiceInboundConfig,
  type InconnectVoiceConfig,
} from 'src/modules/inconnect-voice/inconnect-voice-config';
import { type InconnectVoiceInboundStore } from 'src/modules/inconnect-voice/inconnect-voice-inbound.store';
import { InconnectVoiceProviderService } from 'src/modules/inconnect-voice/inconnect-voice-provider.service';

jest.mock('twilio', () => jest.fn());
jest.mock('src/modules/inconnect-voice/inconnect-voice-config', () => ({
  ...jest.requireActual('src/modules/inconnect-voice/inconnect-voice-config'),
  getVoiceInboundConfig: jest.fn(),
}));

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
  const settle = jest.fn();
  const calls = Object.assign(
    jest.fn(() => ({ fetch })),
    { list },
  );
  const provider = new InconnectVoiceProviderService(
    {
      recordProgress,
    } as unknown as InconnectVoiceCallStore,
    { settle } as unknown as InconnectVoiceInboundStore,
  );

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

  const inboundConfig: VoiceInboundConfig = {
    ...config,
    receiver: '+12015550125',
    source: '+525512345678',
    defaultCountry: 'MX',
    inboundEnabled: true,
    inboundUrl: 'https://example.org',
  };
  const inbound = { id, parentSid, childSid, direction: 'inbound' as const };
  const root = {
    sid: parentSid,
    accountSid: config.accountSid,
    parentCallSid: null,
    to: inboundConfig.receiver,
    from: inboundConfig.source,
    direction: 'inbound',
    status: 'completed',
    duration: '28',
    endTime: evidence.endTime,
  };

  it('uses a terminal caller and correlated browser duration when the caller hangs up first', async () => {
    jest.mocked(getVoiceInboundConfig).mockReturnValue(inboundConfig);
    fetch.mockResolvedValueOnce(root).mockResolvedValueOnce(evidence);
    await provider.reconcile(inboundConfig, inbound);
    expect(settle).toHaveBeenCalledWith(
      inboundConfig,
      inbound,
      expect.objectContaining({
        result: 'answered',
        durationSeconds: 27,
        endedAt: evidence.endTime,
      }),
      false,
    );
  });

  it('does not release an active caller even when the browser terminal event arrives earlier', async () => {
    jest.mocked(getVoiceInboundConfig).mockReturnValue(inboundConfig);
    fetch.mockResolvedValueOnce({ ...root, status: 'in-progress' });
    await provider.reconcile(inboundConfig, inbound);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
  });

  it('uses terminal caller evidence without inventing duration for a missing or mismatched browser leg', async () => {
    jest.mocked(getVoiceInboundConfig).mockReturnValue(inboundConfig);
    fetch
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce({ ...evidence, parentCallSid: childSid });
    await provider.reconcile(inboundConfig, inbound);
    expect(settle).toHaveBeenCalledWith(
      inboundConfig,
      { ...inbound, childSid: null },
      expect.objectContaining({
        result: 'answered',
        durationSeconds: null,
      }),
      false,
    );
  });

  it('correlates caller no-answer and browser cancellation before bridge', async () => {
    jest.mocked(getVoiceInboundConfig).mockReturnValue(inboundConfig);
    fetch
      .mockResolvedValueOnce({ ...root, status: 'no-answer' })
      .mockResolvedValueOnce({ ...evidence, status: 'canceled' });
    await provider.reconcile(inboundConfig, inbound);
    expect(settle).toHaveBeenCalledWith(
      inboundConfig,
      inbound,
      expect.objectContaining({
        result: 'canceled',
        durationSeconds: null,
      }),
      false,
    );
  });
});
