import { BadRequestException } from '@nestjs/common';

import { validate as isUuid } from 'uuid';
import { z } from 'zod';

const uuid = z
  .string()
  .refine(isUuid)
  .transform((value) => value.toLowerCase());
const quantity = z.number().int().min(0).max(1000);
const uniqueIds = (maximum: number) =>
  z
    .array(uuid)
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length);

export const poolFilterSchema = z.strictObject({
  ownerId: uuid.optional(),
  search: z.string().trim().max(200).optional(),
  conditions: z
    .array(
      z.strictObject({
        fieldId: uuid,
        operator: z.enum(['EQ', 'NEQ', 'BEFORE', 'AFTER']),
        value: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
  orderFieldId: uuid.optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
});

export const poolPreviewIdentitySchema = z.object({
  intentionId: uuid,
  objectId: uuid,
});

export const poolPreviewSchema = z
  .strictObject({
    intentionId: uuid,
    objectId: uuid,
    recordIds: uniqueIds(1000).transform((ids) => ids.sort()),
    recipientIds: uniqueIds(50)
      .min(1)
      .transform((ids) => ids.sort()),
    mode: z.enum(['SINGLE', 'EVEN', 'MANUAL_QUOTAS']),
    quotas: z
      .array(z.strictObject({ recipientId: uuid, quantity }))
      .max(50)
      .optional(),
    filter: poolFilterSchema,
    batchSize: z.number().int().min(1).max(100).default(50),
  })
  .superRefine((input, context) => {
    if (input.mode === 'SINGLE' && input.recipientIds.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'SINGLE requires one recipient',
      });
    }
    if (input.mode === 'MANUAL_QUOTAS') {
      const ids = input.quotas?.map((quota) => quota.recipientId) ?? [];
      if (
        ids.length !== input.recipientIds.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !input.recipientIds.includes(id)) ||
        (input.quotas ?? []).reduce(
          (total, quota) => total + quota.quantity,
          0,
        ) > input.recordIds.length
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Invalid uncategorized quotas',
        });
      }
    } else if (input.quotas !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Quotas require MANUAL_QUOTAS',
      });
    }
  });

export const poolListSchema = z.strictObject({
  objectId: uuid,
  filter: poolFilterSchema,
  offset: z.number().int().min(0).max(1000000).default(0),
  first: z.number().int().min(1).max(100).default(50),
});
export const poolOperationSchema = z.strictObject({ operationId: uuid });
export const poolExecuteSchema = poolOperationSchema.extend({
  expectedVersion: z.number().int().min(0).max(5000),
});

export const parsePoolInput = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
): TValue => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestException('Invalid Lead Management request');
  return parsed.data;
};

export const poolItemSchema = z.strictObject({
  recordId: uuid,
  expectedOwnerId: uuid.nullable(),
  expectedUpdatedAt: z.string().min(1),
  recipientId: uuid.nullable(),
  status: z.enum([
    'PENDING',
    'CHANGED',
    'UNCHANGED',
    'CONFLICT',
    'REJECTED',
    'FAILED',
    'REMAINING',
  ]),
});
export const storedPoolSchema = z
  .strictObject({
    input: poolPreviewSchema,
    authorityHash: z.string().length(64),
    found: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    items: z.array(poolItemSchema).max(1000),
    status: z.enum(['PREVIEW', 'RUNNING', 'COMPLETED', 'CANCELLED']),
    version: z.number().int().min(0).max(5000),
    expiresAt: z.string().datetime(),
    lastBatchError: z.string().nullable(),
    consecutiveFailures: z.number().int().min(0).max(3),
    batches: z
      .array(
        z.strictObject({
          version: z.number().int().nonnegative(),
          attempted: z.number().int().min(0).max(100),
          outcome: z.enum(['COMMITTED', 'ROLLED_BACK']),
        }),
      )
      .max(4000),
  })
  .superRefine((state, context) => {
    const identities = state.items.map((item) => item.recordId).sort();
    const valid =
      JSON.stringify(identities) === JSON.stringify(state.input.recordIds) &&
      state.found >= state.items.length &&
      state.version ===
        state.batches.length + Number(state.status === 'CANCELLED') &&
      state.batches.every((batch, index) => batch.version === index) &&
      state.items.every(
        (item) =>
          (item.recipientId === null
            ? item.status === 'REMAINING'
            : state.input.recipientIds.includes(item.recipientId)) &&
          (item.status !== 'CHANGED' ||
            item.recipientId !== item.expectedOwnerId) &&
          (item.status !== 'UNCHANGED' ||
            item.recipientId === item.expectedOwnerId),
      );
    if (!valid)
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent durable operation',
      });
  });
export type StoredLeadPool = z.infer<typeof storedPoolSchema>;
export type LeadPoolItem = z.infer<typeof poolItemSchema>;
