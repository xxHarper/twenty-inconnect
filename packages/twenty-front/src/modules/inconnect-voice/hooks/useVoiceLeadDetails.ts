import { VOICE_AUTHORIZATION_CHECK_MS } from '@/inconnect-voice/hooks/useLeadVoiceCall';
import { resolveLeadVoiceDestination } from '@/inconnect-voice/utils/resolveLeadVoiceDestination';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useFindOneRecordQuery } from '@/object-record/hooks/useFindOneRecordQuery';
import { useEffect, useMemo, useState } from 'react';
import { FieldMetadataType } from '~/generated-metadata/graphql';

export type VoiceLeadDetails =
  | {
      status:
        | 'loading'
        | 'unreadable-phone'
        | 'unavailable'
        | 'missing'
        | 'invalid';
    }
  | { status: 'valid'; number: string; name: string | null };

type LeadPhoneQueryResult = Record<
  string,
  ({ id: string } & Record<string, unknown>) | null
>;

export const useVoiceLeadDetails = (
  objectMetadataItem: EnrichedObjectMetadataItem,
  recordId: string,
) => {
  const client = useApolloCoreClient();
  const phoneFields = objectMetadataItem.fields.filter(
    (field) => field.isActive && field.type === FieldMetadataType.PHONES,
  );
  const phoneField =
    phoneFields.find(({ name }) => name === 'phone') ??
    (phoneFields.length === 1 ? phoneFields[0] : undefined);
  const phone = objectMetadataItem.readableFields.find(
    ({ id }) => id === phoneField?.id,
  )?.name;
  const label = objectMetadataItem.readableFields.find(
    (field) =>
      field.id === objectMetadataItem.labelIdentifierFieldMetadataId &&
      field.isActive &&
      field.type === FieldMetadataType.TEXT,
  )?.name;
  const recordGqlFields = useMemo(
    () => ({
      id: true as const,
      ...(phone && { [phone]: true as const }),
      ...(label && { [label]: true as const }),
    }),
    [phone, label],
  );
  const objectName = objectMetadataItem.nameSingular;
  const { findOneRecordQuery } = useFindOneRecordQuery({
    objectNameSingular: objectName,
    recordGqlFields,
  });
  const [read, setRead] = useState<{
    query: typeof findOneRecordQuery;
    details: VoiceLeadDetails;
  } | null>(null);

  useEffect(() => {
    if (!phone) return;

    const lifetime = new AbortController();
    let nextRead: number | undefined;
    const readLead = async () => {
      const request = new AbortController();
      const cancelRequest = () => request.abort();
      lifetime.signal.addEventListener('abort', cancelRequest, { once: true });
      const timeout = window.setTimeout(
        cancelRequest,
        VOICE_AUTHORIZATION_CHECK_MS,
      );
      let details: VoiceLeadDetails;
      try {
        const { data } = await client.query<LeadPhoneQueryResult>({
          query: findOneRecordQuery,
          variables: { objectRecordId: recordId },
          fetchPolicy: 'no-cache',
          context: {
            queryDeduplication: false,
            fetchOptions: { signal: request.signal },
          },
        });
        const record = data?.[objectName];
        const destination =
          record?.id === recordId
            ? resolveLeadVoiceDestination(record[phone])
            : null;
        const name = record && label ? record[label] : null;
        details =
          destination?.status === 'valid'
            ? {
                ...destination,
                name: typeof name === 'string' ? name.trim() || null : null,
              }
            : { status: destination?.status ?? 'unavailable' };
      } catch {
        details = { status: 'unavailable' };
      } finally {
        window.clearTimeout(timeout);
        lifetime.signal.removeEventListener('abort', cancelRequest);
      }
      if (lifetime.signal.aborted) return;
      setRead({
        query: findOneRecordQuery,
        details: request.signal.aborted ? { status: 'unavailable' } : details,
      });
      nextRead = window.setTimeout(
        () => void readLead(),
        VOICE_AUTHORIZATION_CHECK_MS,
      );
    };
    void readLead();

    return () => {
      lifetime.abort();
      window.clearTimeout(nextRead);
    };
  }, [client, findOneRecordQuery, label, objectName, phone, recordId]);

  if (!phone) return { status: 'unreadable-phone' } satisfies VoiceLeadDetails;
  return read?.query === findOneRecordQuery
    ? read.details
    : ({ status: 'loading' } satisfies VoiceLeadDetails);
};
