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
  path: 'status' | 'session',
  signal: AbortSignal,
  recordId?: string,
): Promise<unknown> => {
  const token = getIsCookieAuthActive()
    ? undefined
    : getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/auth/inconnect-voice/${path}`,
    {
      method: path === 'status' ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(path === 'session' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: path === 'session' ? JSON.stringify({ recordId }) : undefined,
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
) => sessionSchema.parse(await requestVoice('session', signal, recordId));
