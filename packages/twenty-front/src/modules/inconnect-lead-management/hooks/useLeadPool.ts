import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient } from '@apollo/client/react';
import { t } from '@lingui/core/macro';
import { atom, createStore, useAtomValue } from 'jotai';
import { useLayoutEffect, useState } from 'react';
import {
  type LeadPoolFilter,
  type LeadPoolMode,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolPreviewInput,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import {
  leadPoolAdmissionContext,
  LeadPoolDispatchBlockedError,
  type LeadPoolSession,
} from '@/apollo/utils/leadPoolDispatch';
import {
  LEAD_POOL_CANCEL,
  LEAD_POOL_EXECUTE,
  LEAD_POOL_OPERATION,
  LEAD_POOL_PREVIEW,
  LEAD_POOL_RECORDS,
} from '@/inconnect-lead-management/graphql/leadPoolOperations';
import {
  getOperationCheckpoint,
  matchesOperationCheckpoint,
  matchesPreviewInput,
  mergeLeadPoolRecordHistory,
  type OperationCheckpoint,
} from '@/inconnect-lead-management/utils/leadPoolCheckpoint';
import {
  isTerminalLeadPoolStatus,
  leadPoolOperationSchema,
  leadPoolRecipientPlanSchema,
} from '@/inconnect-lead-management/utils/leadPoolOperationSchema';

const MAX_OPERATION_CHECKPOINTS = 100;
// A lost mutation response requires explicit recovery of the intention or operation.
const mutationOptions = {
  context: { disableAutomaticRetry: true },
  errorPolicy: 'none',
  fetchPolicy: 'no-cache',
} as const;

// Apollo's in-flight key omits authentication and origin.
export const LEAD_POOL_READ_OPTIONS = {
  context: { queryDeduplication: false },
  errorPolicy: 'none',
  fetchPolicy: 'no-cache',
} as const;

type Request = {
  kind: 'load' | 'write' | 'recover';
  session?: LeadPoolSession;
};
type OperationProjection = {
  operation: LeadPoolOperation;
  session: LeadPoolSession | undefined;
};
type PoolState = {
  objectId: string;
  originRevision: number;
  request: Request | null;
  error: string | null;
  page: LeadPoolPage | null;
  recordsSession: LeadPoolSession | undefined;
  filter: LeadPoolFilter;
  selection: string[];
  projection: OperationProjection | null;
  intention: LeadPoolPreviewInput | null;
  knownOperationId: string | null;
  pendingOperationId: string | null;
  requiresOperationRecovery: boolean;
};

const initialState = (
  objectId: string,
  recordsSession: LeadPoolSession | undefined,
  originRevision = 0,
): PoolState => ({
  objectId,
  originRevision,
  request: null,
  error: null,
  page: null,
  recordsSession,
  filter: {},
  selection: [],
  projection: null,
  intention: null,
  knownOperationId: null,
  pendingOperationId: null,
  requiresOperationRecovery: false,
});

const hasActiveOperation = (operation?: Pick<LeadPoolOperation, 'status'>) =>
  operation !== undefined && !isTerminalLeadPoolStatus(operation.status);

const writesBlocked = (
  state: Pick<PoolState, 'requiresOperationRecovery' | 'pendingOperationId'>,
) => state.requiresOperationRecovery || state.pendingOperationId !== null;

// An old transport can finish later without holding the current generation's mutex.
const activeRequest = ({ request }: PoolState) =>
  (request?.session?.isCurrent() ?? true) ? request : null;

const checkpointKey = (objectId: string, operationId: string) =>
  `${objectId}:${operationId}`;

const isDefinitivelyRejected = (failure: unknown, intentionId: string) => {
  const rejection =
    CombinedGraphQLErrors.is(failure) &&
    failure.errors.length === 1 &&
    !isDefined(failure.data?.previewInconnectLeadPool)
      ? failure.errors[0].extensions?.leadPoolPreview
      : undefined;

  if (
    rejection &&
    typeof rejection === 'object' &&
    'outcome' in rejection &&
    rejection.outcome === 'REJECTED' &&
    'intentionId' in rejection &&
    rejection.intentionId === intentionId.toLowerCase() &&
    'reason' in rejection &&
    (rejection.reason === 'VALIDATION' || rejection.reason === 'PERMISSION')
  )
    return rejection.reason;
};

export const useLeadPool = (
  initialObjectId: string,
  session?: LeadPoolSession,
) => {
  const client = useApolloClient();
  // Request handlers read the same snapshot React subscribes to, even before rendering.
  const [authority] = useState(() => ({
    store: createStore(),
    view: atom(initialState(initialObjectId.toLowerCase(), session)),
    checkpoints: new Map<string, OperationCheckpoint>(),
    mount: null as object | null,
  }));
  const { store, view, checkpoints } = authority;
  const rendered = useAtomValue(view, { store });
  const read = () => store.get(view);
  const update = (patch: Partial<PoolState>) =>
    store.set(view, (current) => ({ ...current, ...patch }));

  useLayoutEffect(() => {
    authority.mount = {};
    return () => {
      authority.mount = null;
    };
  }, [authority]);

  const isLive = () =>
    authority.mount !== null && (session?.isCurrent() ?? true);
  const currentProjection = (state: PoolState) =>
    state.projection?.session === session && (session?.isCurrent() ?? true)
      ? state.projection
      : null;
  const knownCheckpoint = ({ objectId, knownOperationId }: PoolState) =>
    knownOperationId === null
      ? undefined
      : checkpoints.get(checkpointKey(objectId, knownOperationId));
  const originLocked = (state: PoolState) =>
    state.intention !== null ||
    writesBlocked(state) ||
    hasActiveOperation(knownCheckpoint(state));
  const isCurrentOrigin = (state: PoolState) =>
    isLive() && state.originRevision === rendered.originRevision;
  const canChangeOrigin = () => {
    const state = read();
    return (
      isCurrentOrigin(state) &&
      !originLocked(state) &&
      activeRequest(state)?.kind !== 'write'
    );
  };

  const hasCheckpointCapacity = (previous?: OperationCheckpoint) => {
    // The pending intention owns the last free slot until reconciled or rejected.
    // A different read cannot consume it: recover must match the exact intention.
    if (previous || checkpoints.size < MAX_OPERATION_CHECKPOINTS) return true;
    update({
      error: t`El panel alcanzó el límite de ${MAX_OPERATION_CHECKPOINTS} operaciones verificadas. Puedes volver a consultar las operaciones ya verificadas.`,
    });
    return false;
  };

  const rejectCheckpointConflict = (
    checkpoint: OperationCheckpoint,
    error: string,
  ) => {
    const { knownOperationId, requiresOperationRecovery } = read();
    update({
      error,
      requiresOperationRecovery:
        requiresOperationRecovery ||
        (checkpoint.id === knownOperationId && hasActiveOperation(checkpoint)),
    });
  };

  const rejectRecipientPlanChange = (
    candidate: LeadPoolOperation | null | undefined,
    checkpoint: OperationCheckpoint,
  ) => {
    if (
      typeof candidate?.id !== 'string' ||
      candidate.id.toLowerCase() !== checkpoint.id ||
      typeof candidate.objectId !== 'string' ||
      candidate.objectId.toLowerCase() !== checkpoint.objectId ||
      typeof candidate.intentionId !== 'string' ||
      candidate.intentionId.toLowerCase() !== checkpoint.intentionId
    )
      return false;

    const recipients = leadPoolRecipientPlanSchema.safeParse(
      candidate.recipients,
    );
    if (
      recipients.success &&
      recipients.data.length === checkpoint.recipientQuantities.size &&
      recipients.data.every(
        ({ id, quantity }) =>
          checkpoint.recipientQuantities.get(id.toLowerCase()) === quantity,
      )
    )
      return false;

    rejectCheckpointConflict(
      checkpoint,
      t`Los destinatarios o cantidades no coinciden con el plan confirmado. Consulta la misma operación antes de continuar.`,
    );
    return true;
  };

  const confirmOperation = (
    result: LeadPoolOperation,
    previous: OperationCheckpoint | undefined,
    patch: Partial<PoolState>,
  ) => {
    if (!hasCheckpointCapacity(previous)) return;
    const history = mergeLeadPoolRecordHistory(result, previous);
    if (
      !history ||
      (previous && !matchesOperationCheckpoint(result, previous))
    ) {
      const error = t`La respuesta no coincide con el progreso confirmado de la operación.`;
      if (previous) rejectCheckpointConflict(previous, error);
      else update({ error });
      return;
    }

    checkpoints.set(
      checkpointKey(result.objectId, result.id),
      getOperationCheckpoint(result, history),
    );
    update({
      ...patch,
      projection: { operation: result, session },
      knownOperationId: result.id,
    });
  };

  const guard = async (
    kind: Request['kind'],
    allowed: (state: PoolState) => boolean,
    callback: (state: PoolState, isCurrent: () => boolean) => Promise<void>,
  ) => {
    const state = read();
    if (
      !isCurrentOrigin(state) ||
      !state.objectId ||
      activeRequest(state) ||
      !allowed(state)
    )
      return;

    const request = { kind, session };
    const mount = authority.mount;
    const ownsRequest = () =>
      authority.mount === mount && read().request === request;
    const isCurrent = () => isLive() && ownsRequest();
    update({ request, error: null });
    try {
      if (isCurrent()) await callback(state, isCurrent);
    } catch (failure) {
      if (!ownsRequest()) return;
      if (
        failure instanceof LeadPoolDispatchBlockedError &&
        failure.beforeFirstDispatch
      ) {
        update({
          intention: state.intention,
          pendingOperationId: state.pendingOperationId,
          error: t`La solicitud no se envió porque no se pudo vincular con la sesión actual.`,
        });
        return;
      }
      if (!isCurrent()) return;
      update({
        error:
          failure instanceof Error
            ? failure.message
            : 'La solicitud no pudo completarse.',
        // A transport error can follow a commit. Preserve the intention or operation ID.
        ...(kind === 'recover' ? {} : { page: null, projection: null }),
      });
    } finally {
      if (ownsRequest()) update({ request: null });
    }
  };

  const load = (
    filter: LeadPoolFilter,
    offset = 0,
    keepSelection = false,
    selectFirst = false,
  ) =>
    guard(
      'load',
      (state) =>
        !state.intention &&
        !state.pendingOperationId &&
        !state.knownOperationId,
      async ({ objectId, recordsSession }, isCurrent) => {
        update({
          page: null,
          ...(keepSelection && recordsSession === session
            ? {}
            : { selection: [] }),
        });
        const { data } = await client.query({
          query: LEAD_POOL_RECORDS,
          variables: { input: { objectId, filter, offset, first: 50 } },
          ...LEAD_POOL_READ_OPTIONS,
          context: {
            ...LEAD_POOL_READ_OPTIONS.context,
            ...leadPoolAdmissionContext(session, isCurrent),
          },
        });
        if (!isCurrent()) return;
        if (!isDefined(data))
          throw new Error('No se recibió una selección autorizada.');
        const page = data.inconnectLeadPoolRecords;
        update({
          filter,
          page,
          recordsSession: session,
          ...(selectFirst
            ? { selection: page.records.map(({ id }) => id) }
            : {}),
        });
      },
    );

  const preview = (
    mode: LeadPoolMode,
    recipientIds: string[],
    quotas: LeadPoolPreviewInput['quotas'],
    batchSize: number,
  ) =>
    guard(
      'write',
      (state) =>
        !state.pendingOperationId &&
        !state.knownOperationId &&
        (state.intention !== null || state.recordsSession === session) &&
        state.intention === rendered.intention,
      async (state, isCurrent) => {
        if (!state.intention && !hasCheckpointCapacity()) return;
        const input = state.intention ?? {
          intentionId: crypto.randomUUID(),
          objectId: state.objectId,
          recordIds: state.selection,
          recipientIds,
          mode,
          quotas,
          batchSize,
          filter: state.filter,
        };
        update({ intention: input });
        let response;
        try {
          response = await client.mutate({
            mutation: LEAD_POOL_PREVIEW,
            ...mutationOptions,
            context: {
              ...mutationOptions.context,
              ...leadPoolAdmissionContext(session, isCurrent),
            },
            variables: { input },
          });
        } catch (failure) {
          if (!isCurrent()) throw failure;
          const rejection = isDefinitivelyRejected(failure, input.intentionId);
          if (!rejection) throw failure;
          update({
            intention: null,
            error:
              rejection === 'PERMISSION'
                ? 'El backend rechazó los permisos sin crear una operación. Consulta de nuevo o cambia la selección autorizada.'
                : 'El backend rechazó el preview sin crear una operación. Corrige el formulario o consulta de nuevo.',
          });
          return;
        }
        if (!isCurrent()) return;
        const result = leadPoolOperationSchema.safeParse(
          response.data?.previewInconnectLeadPool,
        );
        if (!result.success || !matchesPreviewInput(result.data, input))
          throw new Error(
            t`No se recibió una vista previa válida para la intención enviada.`,
          );

        const previous = checkpoints.get(
          checkpointKey(input.objectId, result.data.id),
        );
        if (previous && rejectRecipientPlanChange(result.data, previous))
          return;
        confirmOperation(result.data, previous, { intention: null });
      },
    );

  const recover = (operationId: string) =>
    guard(
      'recover',
      () => true,
      async (state, isCurrent) => {
        const requestedId = operationId.toLowerCase();
        if (
          state.requiresOperationRecovery &&
          requestedId !== state.knownOperationId
        )
          throw new Error(
            t`Consulta la operación con el plan pendiente de verificar.`,
          );

        const previous = checkpoints.get(
          checkpointKey(state.objectId, requestedId),
        );
        if (!hasCheckpointCapacity(previous)) return;
        const { data } = await client.query({
          query: LEAD_POOL_OPERATION,
          variables: { input: { operationId: requestedId } },
          ...LEAD_POOL_READ_OPTIONS,
          context: {
            ...LEAD_POOL_READ_OPTIONS.context,
            ...leadPoolAdmissionContext(session, isCurrent),
          },
        });
        if (!isCurrent()) return;

        const candidate = data?.inconnectLeadPoolOperation;
        if (previous && rejectRecipientPlanChange(candidate, previous)) return;
        const result = leadPoolOperationSchema.safeParse(candidate);
        if (!result.success)
          throw new Error(
            t`No se recibió un resultado completo de la operación.`,
          );

        const recovered = result.data;
        if (
          recovered.objectId !== state.objectId ||
          recovered.id !== requestedId
        )
          throw new Error(
            'La operación no corresponde al origen o identificador consultado.',
          );

        if (
          (state.intention &&
            !matchesPreviewInput(recovered, state.intention)) ||
          (hasActiveOperation(knownCheckpoint(state)) &&
            recovered.id !== state.knownOperationId) ||
          (state.pendingOperationId &&
            recovered.id !== state.pendingOperationId)
        )
          throw new Error(
            'Primero recupera la intención pendiente; esta operación corresponde a otra intención.',
          );

        confirmOperation(recovered, previous, {
          intention: null,
          pendingOperationId: null,
          requiresOperationRecovery: false,
          page: null,
        });
      },
    );

  const write = (action: 'execute' | 'cancel') =>
    guard(
      'write',
      (state) => {
        const projection = currentProjection(state);
        const operation = projection?.operation;
        return (
          operation !== undefined &&
          projection === rendered.projection &&
          hasActiveOperation(operation) &&
          !state.intention &&
          !writesBlocked(state) &&
          (action === 'cancel' ||
            (operation.canExecute &&
              operation.recipients.every(
                ({ label, assignable }) =>
                  assignable && isDefined(label) && label.trim().length > 0,
              )))
        );
      },
      async (state, isCurrent) => {
        const operation = currentProjection(state)?.operation;
        if (!operation) return;
        const checkpoint = checkpoints.get(
          checkpointKey(state.objectId, operation.id),
        );
        if (!checkpoint || checkpoint.version !== operation.version) return;

        update({ pendingOperationId: checkpoint.id });
        const variables = {
          input: {
            operationId: checkpoint.id,
            expectedVersion: checkpoint.version,
          },
        };
        const context = {
          ...mutationOptions.context,
          ...leadPoolAdmissionContext(session, isCurrent),
        };
        const candidate =
          action === 'execute'
            ? (
                await client.mutate({
                  mutation: LEAD_POOL_EXECUTE,
                  ...mutationOptions,
                  context,
                  variables,
                })
              ).data?.executeInconnectLeadPool
            : (
                await client.mutate({
                  mutation: LEAD_POOL_CANCEL,
                  ...mutationOptions,
                  context,
                  variables,
                })
              ).data?.cancelInconnectLeadPool;
        if (!isCurrent() || rejectRecipientPlanChange(candidate, checkpoint))
          return;
        const result = leadPoolOperationSchema.safeParse(candidate);
        // A consumed version can return the later state written by another request.
        if (
          !result.success ||
          result.data.version <= checkpoint.version ||
          !matchesOperationCheckpoint(result.data, checkpoint)
        )
          throw new Error(
            action === 'execute'
              ? 'Resultado incierto. Consulta la operación antes de continuar.'
              : 'No se confirmó la cancelación. Consulta la operación.',
          );

        confirmOperation(result.data, checkpoint, {
          pendingOperationId: null,
          ...(action === 'execute' ? { page: null } : {}),
        });
      },
    );

  // A transport round trip preserves checkpoints and pending writes. Only a
  // response accepted in the current session can restore the visible projection.
  const operation = currentProjection(rendered)?.operation ?? null;
  const needsProjectionRefresh =
    rendered.knownOperationId !== null && operation === null;
  const recordsCurrent =
    rendered.recordsSession === session && (session?.isCurrent() ?? true);

  return {
    objectId: rendered.objectId,
    page: recordsCurrent ? rendered.page : null,
    filter: recordsCurrent ? rendered.filter : {},
    selection: recordsCurrent ? rendered.selection : [],
    operation,
    needsProjectionRefresh,
    busy: activeRequest(rendered) !== null,
    writesBlocked: writesBlocked(rendered) || needsProjectionRefresh,
    error: rendered.error,
    hasIntention: rendered.intention !== null,
    unresolved:
      rendered.intention !== null || rendered.pendingOperationId !== null,
    originLocked: originLocked(rendered),
    knownOperationId: rendered.knownOperationId,
    changeOrigin: (objectId: string) => {
      if (!canChangeOrigin()) return;
      const state = read();
      const normalized = objectId.toLowerCase();
      if (normalized !== state.objectId)
        store.set(
          view,
          initialState(normalized, session, state.originRevision + 1),
        );
    },
    load,
    preview,
    advance: () => write('execute'),
    recover,
    cancel: () => write('cancel'),
    reset: () => {
      const state = read();
      if (
        !isCurrentOrigin(state) ||
        activeRequest(state) ||
        originLocked(state)
      )
        return;
      update({
        projection: null,
        selection: [],
        page: null,
        recordsSession: session,
        ...(state.recordsSession === session ? {} : { filter: {} }),
        error: null,
        knownOperationId: null,
      });
    },
    select: (selection: string[]) => {
      const state = read();
      if (
        !isCurrentOrigin(state) ||
        activeRequest(state) ||
        state.intention ||
        state.pendingOperationId ||
        state.knownOperationId ||
        state.recordsSession !== session
      )
        return;
      update({ selection });
    },
  };
};
