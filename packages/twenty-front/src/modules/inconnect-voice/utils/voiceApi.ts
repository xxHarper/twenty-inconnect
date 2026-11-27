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
    .enum(['answered', 'no-answer', 'busy', 'canceled', 'failed', 'declined'])
    .nullable(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
});
const callSchema = progressSchema.extend({ observedAt: z.number() });
const lookupSchema = z.object({
  destination: z.string().regex(/^\+[1-9]\d{1,14}$/),
  candidates: z.array(
    z.object({ recordId: z.string().uuid(), name: z.string().nullable() }),
  ),
  next: z.string().uuid().nullable(),
  canCall: z.boolean(),
  canCallUnlinked: z.boolean(),
});
const recentsSchema = z.object({
  next: z.string().uuid().nullable(),
  rows: z.array(
    progressSchema.extend({
      createdAt: z.string(),
      direction: z.enum(['outbound', 'inbound']),
      destination: z.string().regex(/^\+[1-9]\d{1,14}$/),
      name: z.string().nullable(),
      recordId: z.string().uuid().nullable(),
    }),
  ),
});
const historySchema = z.object({
  attempts: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  durationSeconds: z.string().regex(/^\d+$/),
  next: z.string().uuid().nullable(),
  rows: z.array(
    progressSchema.extend({
      createdAt: z.string(),
      actorLabel: z.string(),
      direction: z.enum(['outbound', 'inbound']),
      canReconcile: z.boolean(),
    }),
  ),
});

const inboundOfferSchema = callSchema.extend({
  recordId: z.string().uuid().nullable(),
  number: z.string().regex(/^\+[1-9]\d{1,14}$/),
  name: z.string().nullable(),
});
export type VoiceInboundOffer = z.infer<typeof inboundOfferSchema>;

export type VoiceProviderProgress = z.infer<typeof progressSchema>;
export type VoiceCallHistory = z.infer<typeof historySchema>;
export type VoiceLookup = z.infer<typeof lookupSchema>;
export type VoiceRecents = z.infer<typeof recentsSchema>;

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
  options?: { method: 'POST'; body?: object },
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
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
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
  inboundSessionId?: string,
) =>
  sessionSchema.parse(
    await requestVoice('session', signal, {
      method: 'POST',
      body: { recordId, inboundSessionId },
    }),
  );

export const getVoicePhoneAccess = async (signal: AbortSignal) =>
  z
    .object({ available: z.literal(true) })
    .parse(await requestVoice('phone-access', signal)).available;

export const lookupVoiceNumber = async (
  number: string,
  signal: AbortSignal,
  after?: string,
) =>
  lookupSchema.parse(
    await requestVoice('lookup', signal, {
      method: 'POST',
      body: { number, after },
    }),
  );

export const createManualVoiceSession = async (
  number: string,
  recordId: string | null,
  signal: AbortSignal,
  inboundSessionId?: string,
) =>
  sessionSchema.parse(
    await requestVoice('manual-session', signal, {
      method: 'POST',
      body: { number, recordId, inboundSessionId },
    }),
  );

export const getVoiceRecents = async (signal: AbortSignal, before?: string) =>
  recentsSchema.parse(
    await requestVoice(
      `recents${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      signal,
    ),
  );

const inboundPreferenceSchema = z.enum(['available', 'unavailable', 'offline']);
export type VoiceInboundPreference = z.infer<typeof inboundPreferenceSchema>;
const inboundAccessSchema = z.object({
  available: z.literal(true),
  preference: inboundPreferenceSchema.optional(),
  registered: z.boolean().optional(),
  effective: z
    .enum(['available', 'ringing', 'busy', 'unavailable', 'offline'])
    .optional(),
});

export const getVoiceInboundAccess = async (signal: AbortSignal) =>
  inboundAccessSchema.parse(await requestVoice('inbound-access', signal));

export const setVoiceInboundPreference = async (
  preference: VoiceInboundPreference,
  signal: AbortSignal,
) =>
  inboundAccessSchema.parse(
    await requestVoice('inbound-preference', signal, {
      method: 'POST',
      body: { preference },
    }),
  );

export const startVoiceInboundSession = async (signal: AbortSignal) =>
  z
    .object({ id: z.string().uuid(), token: z.string().min(1) })
    .parse(await requestVoice('inbound-session', signal, { method: 'POST' }));

export const updateVoiceInboundSession = async (
  id: string,
  state: 'registered' | 'offline' | 'stop',
  refresh: boolean,
  signal: AbortSignal,
) =>
  z.object({ token: z.string().min(1).optional() }).parse(
    await requestVoice('inbound-session/update', signal, {
      method: 'POST',
      body: { id, state, refresh },
    }),
  );

export const getVoiceInboundOffer = async (
  id: string,
  sessionId: string,
  signal: AbortSignal,
  action?: 'accept' | 'decline' | 'reconcile',
) =>
  inboundOfferSchema.parse(
    await requestVoice(`inbound-offer/${encodeURIComponent(id)}`, signal, {
      method: 'POST',
      body: { sessionId, action },
    }),
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

export const getManualVoiceCallProgress = async (
  recordId: string | null,
  callId: string,
  signal: AbortSignal,
  action?: 'cancel' | 'reconcile',
) =>
  callSchema.parse(
    await requestVoice(
      `manual-call/${encodeURIComponent(callId)}${action ? `/${action}` : ''}${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ''}`,
      signal,
      action ? { method: 'POST' } : undefined,
    ),
  );
