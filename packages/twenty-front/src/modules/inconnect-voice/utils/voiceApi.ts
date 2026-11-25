import { getIsCookieAuthActive } from '@/apollo/utils/getIsCookieAuthActive';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { z } from 'zod';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

const statusSchema = z.object({
  status: z.enum(['not-configured', 'disabled', 'ready']),
});
const sessionSchema = z.object({
  token: z.string().min(1),
  intentId: z.string().uuid(),
  intentExpiresAt: z.number().int(),
  destination: z.string().regex(/^\+[1-9]\d{1,14}$/),
});
const progressSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['reserved', 'connecting', 'ringing', 'answered', 'finished']),
  result: z
    .enum(['answered', 'no-answer', 'busy', 'canceled', 'failed'])
    .nullable(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
});
const callSchema = progressSchema.extend({ observedAt: z.number() });
const historySchema = z.object({
  attempts: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  durationSeconds: z.string().regex(/^\d+$/),
  next: z.string().uuid().nullable(),
  rows: z.array(
    progressSchema.extend({
      createdAt: z.string(),
      actorLabel: z.string(),
      direction: z.literal('outbound'),
      canReconcile: z.boolean(),
    }),
  ),
});

export type VoiceProviderProgress = z.infer<typeof progressSchema>;
export type VoiceCallHistory = z.infer<typeof historySchema>;

export type VoiceAvailability =
  | z.infer<typeof statusSchema>['status']
  | 'loading'
  | 'unavailable';

export class VoiceApiError extends Error {
  constructor(readonly status: number) {
    super('Voice request failed');
  }
}

const requestVoice = async (
  path: string,
  signal: AbortSignal,
  options?: { method: 'POST'; recordId?: string },
): Promise<unknown> => {
  const token = getIsCookieAuthActive()
    ? undefined
    : getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/auth/inconnect-voice/${path}`,
    {
      method: options?.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.recordId ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options?.recordId
        ? JSON.stringify({ recordId: options.recordId })
        : undefined,
    },
  );

  if (!response.ok) throw new VoiceApiError(response.status);

  return response.json();
};

export const getVoiceStatus = async (signal: AbortSignal) =>
  statusSchema.parse(await requestVoice('status', signal)).status;

export const createVoiceSession = async (
  recordId: string,
  signal: AbortSignal,
) =>
  sessionSchema.parse(
    await requestVoice('session', signal, { method: 'POST', recordId }),
  );

export const getVoiceHistoryObject = async (
  recordId: string,
  signal: AbortSignal,
) =>
  z
    .object({ objectMetadataId: z.string().uuid() })
    .parse(
      await requestVoice(
        `history-access/${encodeURIComponent(recordId)}`,
        signal,
      ),
    ).objectMetadataId;

export const getVoiceHistory = async (
  recordId: string,
  signal: AbortSignal,
  before?: string,
) =>
  historySchema.parse(
    await requestVoice(
      `history/${encodeURIComponent(recordId)}${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      signal,
    ),
  );

export const getVoiceCallProgress = async (
  recordId: string,
  callId: string,
  signal: AbortSignal,
  action?: 'cancel' | 'reconcile',
) =>
  callSchema.parse(
    await requestVoice(
      `history/${encodeURIComponent(recordId)}/call/${encodeURIComponent(callId)}${action ? `/${action}` : ''}`,
      signal,
      action ? { method: 'POST' } : undefined,
    ),
  );
