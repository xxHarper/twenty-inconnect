import { getVoiceHistoryObject } from '@/inconnect-voice/utils/voiceApi';
import { useEffect, useState } from 'react';

export const useVoiceHistoryAccess = (
  recordId: string | undefined,
  objectId: string | undefined,
) => {
  const [authorized, setAuthorized] = useState<{
    recordId: string;
    objectId: string;
  } | null>(null);

  useEffect(() => {
    if (!recordId || !objectId) return;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]);

    void getVoiceHistoryObject(recordId, signal).then(
      (configuredObjectId) => {
        if (!signal.aborted)
          setAuthorized(
            configuredObjectId === objectId ? { recordId, objectId } : null,
          );
      },
      () => {
        if (!abort.signal.aborted) setAuthorized(null);
      },
    );
    return () => abort.abort();
  }, [objectId, recordId]);

  return (
    authorized !== null &&
    authorized.recordId === recordId &&
    authorized.objectId === objectId
  );
};
