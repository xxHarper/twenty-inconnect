import { planExplicitLeadPool } from '#demo-a4-lead-pool-planner';
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { delay, of } from 'rxjs';
import {
  type LeadPoolCatalog,
  type LeadPoolFilter,
  type LeadPoolOperation,
  type LeadPoolPage,
  type LeadPoolRecord,
} from 'twenty-shared/types';
import { z } from 'zod';

const label = 'Etiqueta comercial';
const uuid = z.uuid().transform((value) => value.toLowerCase());
const uniqueIds = (max: number) =>
  z
    .array(uuid)
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length);

// This fixture exposes one TEXT field; date conditions have no matching metadata.
const filterSchema = z.strictObject({
  search: z.string().trim().max(200).optional(),
  ownerId: uuid.optional(),
  conditions: z
    .array(
      z.strictObject({
        fieldId: uuid,
        operator: z.enum(['EQ', 'NEQ']),
        value: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
  orderFieldId: uuid.optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
}) satisfies z.ZodType<LeadPoolFilter>;

const previewSchema = z.strictObject({
  intentionId: uuid,
  objectId: uuid,
  recordIds: uniqueIds(1000),
  recipientIds: uniqueIds(50),
  mode: z.enum(['SINGLE', 'EVEN', 'MANUAL_QUOTAS']),
  quotas: z
    .array(
      z.strictObject({
        recipientId: uuid,
        quantity: z.number().int().min(0).max(1000),
      }),
    )
    .max(50)
    .optional(),
  filter: filterSchema,
  batchSize: z.number().int().min(1).max(100).default(50),
});

const recordsSchema = z.strictObject({
  objectId: uuid,
  filter: filterSchema,
  offset: z.number().int().min(0).max(1000000).default(0),
  first: z.number().int().min(1).max(100).default(50),
});

const operationSchema = z.strictObject({ operationId: uuid });
const cancelSchema = operationSchema.extend({
  expectedVersion: z.number().int().min(0).max(5000),
});

const reject = (message: string, extensions?: Record<string, unknown>) =>
  of({ errors: [new GraphQLError(message, { extensions })] });

export const createLeadPoolStoryClient = (storageReady: boolean) => {
  const objectId = crypto.randomUUID();
  const fieldId = crypto.randomUUID();
  const recipients = [
    'Ejecutivo A · Equipo Demo',
    'Ejecutivo B · Equipo Demo',
  ].map((label) => ({ id: crypto.randomUUID(), label }));
  const recordIdPrefix = crypto.randomUUID().slice(0, 24);
  const records = Array.from({ length: 50 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      id: recordIdPrefix + number.padStart(12, '0'),
      label: 'Comercio ficticio ' + number,
      ownerId: recipients[index < 35 ? 0 : 1].id,
    } satisfies LeadPoolRecord;
  });
  const catalog: LeadPoolCatalog = {
    objects: [{ id: objectId, label: 'Leads · Equipo Demo' }],
    storageReady,
    blockedReason: storageReady
      ? null
      : 'El almacenamiento durable de operaciones no está instalado o disponible.',
    allMatchingReady: false,
    messagingClassification: 'NOT_READY',
  };
  const operations = new Map<string, LeadPoolOperation>();

  const filterRecords = (filter: LeadPoolFilter) => {
    if (
      (filter.ownerId && !recipients.some(({ id }) => id === filter.ownerId)) ||
      (filter.orderFieldId && filter.orderFieldId !== fieldId) ||
      filter.conditions?.some((condition) => condition.fieldId !== fieldId)
    ) {
      return null;
    }
    const search = filter.search?.toLowerCase() ?? '';
    const matches = records.filter(
      (record) =>
        (!filter.ownerId || record.ownerId === filter.ownerId) &&
        record.label.toLowerCase().includes(search) &&
        (filter.conditions ?? []).every(({ operator, value }) =>
          operator === 'EQ' ? record.label === value : record.label !== value,
        ),
    );
    // Fixture labels and IDs share a stable ascending sequence.
    return filter.orderFieldId && filter.direction === 'DESC'
      ? matches.reverse()
      : matches;
  };

  // The terminating link has no transport that could reach the real metadata API.
  const link = new ApolloLink(({ operationName, variables }) => {
    switch (operationName) {
      case 'InconnectLeadPoolCatalog':
        return of({ data: { inconnectLeadPoolCatalog: catalog } });
      case 'InconnectLeadPoolRecords': {
        const request = recordsSchema.safeParse(variables.input);
        if (!request.success || request.data.objectId !== objectId) {
          return reject('Consulta fuera del catálogo ficticio.');
        }
        const { filter, offset, first } = request.data;
        const matches = filterRecords(filter);
        if (!matches) return reject('Filtro fuera del catálogo ficticio.');
        const result: LeadPoolPage = {
          records: matches.slice(offset, offset + first),
          total: matches.length,
          offset,
          fields: [{ id: fieldId, label, type: 'TEXT', options: [] }],
          recipients,
        };
        return of({ data: { inconnectLeadPoolRecords: result } });
      }
      case 'PreviewInconnectLeadPool': {
        if (!storageReady) return reject(catalog.blockedReason!);
        const request = previewSchema.safeParse(variables.input);
        const identity = uuid.safeParse(variables.input?.intentionId);
        const rejected = () =>
          reject('Selección, destinatarios o cuotas inválidos en la demo.', {
            leadPoolPreview: {
              outcome: 'REJECTED',
              reason: 'VALIDATION',
              intentionId: identity.data,
            },
          });
        if (!request.success || request.data.objectId !== objectId)
          return rejected();

        const input = request.data;
        const matches = filterRecords(input.filter);
        const selected = matches?.filter(({ id }) =>
          input.recordIds.includes(id),
        );
        const targets = recipients.filter(({ id }) =>
          input.recipientIds.includes(id),
        );
        if (
          !matches ||
          !selected ||
          selected.length !== input.recordIds.length ||
          targets.length !== input.recipientIds.length ||
          (input.mode === 'SINGLE' && targets.length !== 1)
        ) {
          return rejected();
        }
        if (input.mode === 'MANUAL_QUOTAS') {
          const quotas = input.quotas ?? [];
          if (
            quotas.length !== targets.length ||
            targets.some(
              ({ id }) => !quotas.some(({ recipientId }) => recipientId === id),
            ) ||
            quotas.reduce((sum, { quantity }) => sum + quantity, 0) >
              selected.length
          ) {
            return rejected();
          }
        } else if (input.quotas !== undefined) {
          return rejected();
        }

        const plan = planExplicitLeadPool(
          input,
          selected.map((record) => ({
            ...record,
            updatedAt: '2026-09-14T16:00:00.000000Z',
          })),
        );
        const assigned = plan.filter(({ recipientId }) => recipientId !== null);
        const unchanged = assigned.filter(
          ({ recipientId, expectedOwnerId }) => recipientId === expectedOwnerId,
        ).length;
        const remaining = selected.length - assigned.length;
        const operation: LeadPoolOperation = {
          id: crypto.randomUUID(),
          intentionId: input.intentionId,
          objectId,
          mode: input.mode,
          status: 'PREVIEW',
          version: 0,
          found: matches.length,
          selected: selected.length,
          authorized: selected.length,
          plannedChanges: assigned.length - unchanged,
          plannedUnchanged: unchanged,
          plannedRemaining: remaining,
          processed: 0,
          lastBatchError: null,
          batchFailures: 0,
          counts: {
            CHANGED: 0,
            UNCHANGED: 0,
            CONFLICT: 0,
            REJECTED: 0,
            FAILED: 0,
            REMAINING: remaining,
            PENDING: assigned.length,
          },
          recipients: targets.map((recipient) => ({
            ...recipient,
            assignable: true,
            quantity: assigned.filter(
              ({ recipientId }) => recipientId === recipient.id,
            ).length,
          })),
          canExecute: false,
          items: plan.map(({ recordId, status }) => ({ recordId, status })),
          hiddenItems: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
        operations.set(operation.id, operation);
        return of({ data: { previewInconnectLeadPool: operation } });
      }
      case 'InconnectLeadPoolOperation': {
        const request = operationSchema.safeParse(variables.input);
        const operation = request.success
          ? operations.get(request.data.operationId)
          : undefined;
        return operation
          ? of({ data: { inconnectLeadPoolOperation: operation } })
          : reject('Vista previa local no disponible.');
      }
      case 'CancelInconnectLeadPool': {
        const request = cancelSchema.safeParse(variables.input);
        if (!request.success) return reject('Cancelación local inválida.');
        const { operationId, expectedVersion } = request.data;
        const operation = operations.get(operationId);
        if (!operation || expectedVersion > operation.version) {
          return reject('Versión local de la vista previa no disponible.');
        }
        if (operation.status === 'CANCELLED') {
          return of({ data: { cancelInconnectLeadPool: operation } });
        }
        const cancelled: LeadPoolOperation = {
          ...operation,
          status: 'CANCELLED',
          version: operation.version + 1,
          items: operation.items.map(({ recordId }) => ({
            recordId,
            status: 'REMAINING',
          })),
          counts: {
            ...operation.counts,
            PENDING: 0,
            REMAINING: operation.selected,
          },
        };
        operations.set(operationId, cancelled);
        return of({ data: { cancelInconnectLeadPool: cancelled } });
      }
      case 'ExecuteInconnectLeadPool':
        return reject(
          'La confirmación está deshabilitada en esta demostración.',
        );
      default:
        return reject('Operación GraphQL fuera de la demostración.');
    }
  });

  const transport = new ApolloLink((operation, forward) =>
    forward(operation).pipe(delay(0)),
  );
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: transport.concat(link),
  });
};
