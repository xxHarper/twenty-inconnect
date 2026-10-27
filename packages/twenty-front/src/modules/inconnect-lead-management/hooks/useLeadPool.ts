import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient } from '@apollo/client/react';
import { useRef, useState } from 'react';
import {
  type LeadPoolFilter,
  type LeadPoolMode,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';

import {
  LEAD_POOL_CANCEL,
  LEAD_POOL_EXECUTE,
  LEAD_POOL_OPERATION,
  LEAD_POOL_PREVIEW,
  LEAD_POOL_RECORDS,
} from '@/inconnect-lead-management/graphql/leadPoolOperations';

export const useLeadPool = (objectId: string) => {
  const client = useApolloClient();
  const [page, setPage] = useState<LeadPoolPage | null>(null);
  const [filter, setFilter] = useState<LeadPoolFilter>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [operation, setOperation] = useState<LeadPoolOperation | null>(null);
  const [intention, setIntention] = useState<LeadPoolPreviewInput | null>(null);
  const [knownOperationId, setKnownOperationId] = useState<string | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(
    null,
  );
  // Serialize requests before React renders busy; this lock never drives UI.
  // oxlint-disable-next-line twenty/no-state-useref
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The component is keyed by origin. Requests cannot cross into another origin.
  const guard = async (
    callback: () => Promise<void>,
    clearOnFailure = true,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await callback();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'La solicitud no pudo completarse.',
      );
      // A transport error can follow a commit. Keep the intention/operation for explicit recovery.
      if (clearOnFailure) {
        setPage(null);
        setOperation(null);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const load = async (
    nextFilter: LeadPoolFilter,
    offset = 0,
    keepSelection = false,
    selectFirst = false,
  ) =>
    guard(async () => {
      if (intention || pendingOperationId || operation) return;
      setPage(null);
      if (!keepSelection) setSelection([]);
      setIntention(null);
      const { data } = await client.query({
        query: LEAD_POOL_RECORDS,
        variables: {
          input: { objectId, filter: nextFilter, offset, first: 50 },
        },
        fetchPolicy: 'network-only',
      });
      if (!data) throw new Error('No se recibió una selección autorizada.');
      setFilter(nextFilter);
      setPage(data.inconnectLeadPoolRecords);
      if (selectFirst)
        setSelection(
          data.inconnectLeadPoolRecords.records.map((record) => record.id),
        );
    });
  const preview = async (
    mode: LeadPoolMode,
    recipientIds: string[],
    quotas: LeadPoolPreviewInput['quotas'],
    batchSize: number,
  ) =>
    guard(async () => {
      if (pendingOperationId || operation) return;
      const input = intention ?? {
        intentionId: crypto.randomUUID(),
        objectId,
        recordIds: selection,
        recipientIds,
        mode,
        quotas,
        batchSize,
        filter,
      };
      setIntention(input);
      let response;
      try {
        response = await client.mutate({
          mutation: LEAD_POOL_PREVIEW,
          variables: { input },
        });
      } catch (failure) {
        const rejected =
          CombinedGraphQLErrors.is(failure) && failure.errors.length === 1
            ? failure.errors[0].extensions?.leadPoolPreview
            : undefined;
        if (
          rejected &&
          typeof rejected === 'object' &&
          'outcome' in rejected &&
          rejected.outcome === 'REJECTED' &&
          'reason' in rejected &&
          (rejected.reason === 'VALIDATION' ||
            rejected.reason === 'PERMISSION') &&
          'intentionId' in rejected &&
          rejected.intentionId === input.intentionId
        ) {
          setIntention(null);
          setError(
            rejected.reason === 'PERMISSION'
              ? 'El backend rechazó los permisos sin crear una operación. Consulta de nuevo o cambia la selección autorizada.'
              : 'El backend rechazó el preview sin crear una operación. Corrige el formulario o consulta de nuevo.',
          );
          return;
        }
        throw failure;
      }
      const { data } = response;
      if (!data) throw new Error('No se recibió la vista previa.');
      setKnownOperationId(data.previewInconnectLeadPool.id);
      setIntention(null);
      setOperation(data.previewInconnectLeadPool);
    });
  const advance = async () =>
    guard(async () => {
      if (!operation || !operation.canExecute || pendingOperationId) return;
      setPendingOperationId(operation.id);
      const { data } = await client.mutate({
        mutation: LEAD_POOL_EXECUTE,
        variables: {
          input: {
            operationId: operation.id,
            expectedVersion: operation.version,
          },
        },
      });
      if (!data)
        throw new Error(
          'Resultado incierto. Consulta la operación antes de continuar.',
        );
      setOperation(data.executeInconnectLeadPool);
      setPendingOperationId(null);
      setPage(null);
    });
  const recover = async (operationId: string) =>
    guard(async () => {
      const { data } = await client.query({
        query: LEAD_POOL_OPERATION,
        variables: { input: { operationId } },
        fetchPolicy: 'network-only',
      });
      if (
        !data ||
        data.inconnectLeadPoolOperation.objectId !== objectId ||
        data.inconnectLeadPoolOperation.id !== operationId.toLowerCase()
      )
        throw new Error(
          'La operación no corresponde al origen o identificador consultado.',
        );
      if (
        (intention &&
          data.inconnectLeadPoolOperation.intentionId !==
            intention.intentionId) ||
        (pendingOperationId &&
          data.inconnectLeadPoolOperation.id !== pendingOperationId)
      )
        throw new Error(
          'Primero recupera la intención pendiente; esta operación corresponde a otra intención.',
        );
      // A read attempt never creates write uncertainty or replaces confirmed progress.
      setKnownOperationId(data.inconnectLeadPoolOperation.id);
      setIntention(null);
      setPendingOperationId(null);
      setPage(null);
      setOperation(data.inconnectLeadPoolOperation);
    }, false);
  const cancel = async () =>
    guard(async () => {
      if (!operation || pendingOperationId) return;
      setPendingOperationId(operation.id);
      const { data } = await client.mutate({
        mutation: LEAD_POOL_CANCEL,
        variables: {
          input: {
            operationId: operation.id,
            expectedVersion: operation.version,
          },
        },
      });
      if (!data)
        throw new Error(
          'No se confirmó la cancelación. Consulta la operación.',
        );
      setOperation(data.cancelInconnectLeadPool);
      setPendingOperationId(null);
    });
  const reset = () => {
    if (
      inFlight.current ||
      intention ||
      pendingOperationId ||
      operation?.status === 'PREVIEW' ||
      operation?.status === 'RUNNING'
    )
      return;
    setOperation(null);
    setIntention(null);
    setSelection([]);
    setPage(null);
    setError(null);
    setKnownOperationId(null);
  };
  return {
    page,
    filter,
    selection,
    operation,
    busy,
    error,
    hasIntention: intention !== null,
    unresolved: intention !== null || pendingOperationId !== null,
    knownOperationId,
    load,
    preview,
    advance,
    recover,
    cancel,
    reset,
    select: (ids: string[]) => {
      if (inFlight.current || intention || pendingOperationId || operation)
        return;
      setSelection(ids);
      setIntention(null);
    },
    invalidatePreviewInput: () => {
      if (!inFlight.current && !intention && !pendingOperationId && !operation)
        setIntention(null);
    },
  };
};
